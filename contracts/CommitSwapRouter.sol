// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// Uniswap v4 PoolManager: the calls this router makes.
interface IV4PoolManager {
    struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
    struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256 delta);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

interface IPonsV2Launches {
    struct LaunchedToken {
        address token; address curve; address deployer; address creatorFeeRecipient; address pairToken;
        uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled;
        uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists;
    }
    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
    function poolManager() external view returns (address);
    function memeHook() external view returns (address);
}

/// @title CommitSwapRouter — buys a graduated Pons launch token with ETH on its Uniswap v4 pool.
/// @notice Exact input, ETH → token, tokens sent to `recipient`, unspent ETH refunded to the caller.
contract CommitSwapRouter {
    uint160 internal constant MIN_SQRT_PRICE_PLUS_ONE = 4295128740;

    IPonsV2Launches public immutable pons;
    IV4PoolManager public immutable poolManager;
    address public immutable hook;
    uint256 private _lock = 1;

    error NotNativeLaunch();
    error NotPoolManager();
    error Slippage(uint256 out, uint256 minOut);
    error Locked();
    error RefundFailed();

    constructor(address pons_) {
        pons = IPonsV2Launches(pons_);
        poolManager = IV4PoolManager(IPonsV2Launches(pons_).poolManager());
        hook = IPonsV2Launches(pons_).memeHook();
    }

    receive() external payable {}

    function buy(address token, uint256 minOut, address recipient) external payable returns (uint256 out) {
        if (_lock == 2) revert Locked();
        _lock = 2;
        IPonsV2Launches.LaunchedToken memory lt = pons.getLaunchedToken(token);
        if (!lt.exists || lt.pairToken != address(0)) revert NotNativeLaunch();
        bytes memory r = poolManager.unlock(abi.encode(token, lt.poolFee, lt.tickSpacing, msg.value, recipient));
        uint256 paid;
        (out, paid) = abi.decode(r, (uint256, uint256));
        if (out < minOut) revert Slippage(out, minOut);
        if (msg.value > paid) {
            (bool ok,) = msg.sender.call{value: msg.value - paid}("");
            if (!ok) revert RefundFailed();
        }
        _lock = 1;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (address token, uint24 fee, int24 tickSpacing, uint256 amountIn, address recipient) =
            abi.decode(data, (address, uint24, int24, uint256, address));
        IV4PoolManager.PoolKey memory key = IV4PoolManager.PoolKey(address(0), token, fee, tickSpacing, hook);
        int256 delta = poolManager.swap(key, IV4PoolManager.SwapParams(true, -int256(amountIn), MIN_SQRT_PRICE_PLUS_ONE), "");
        int128 a0 = int128(delta >> 128);
        int128 a1 = int128(delta);
        uint256 paid = a0 < 0 ? uint256(uint128(-a0)) : 0;
        uint256 out = a1 > 0 ? uint256(uint128(a1)) : 0;
        if (paid > 0) { poolManager.sync(address(0)); poolManager.settle{value: paid}(); }
        if (out > 0) poolManager.take(token, recipient, out);
        return abi.encode(out, paid);
    }
}
