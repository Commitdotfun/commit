// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// Pons V2 fee escrow (creator fees are credited here, then claimed by the recipient).
interface IPonsFeeEscrow {
    function claim() external returns (uint256 amount);
    function balanceOf(address recipient) external view returns (uint256);
}

/// Pons V2 launch factory: the part Commit reads.
interface IPonsV2 {
    struct LaunchedToken {
        address token;
        address curve;
        address deployer;
        address creatorFeeRecipient;
        address pairToken;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        uint8 phase;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 sweptAt;
        bool exists;
    }
    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
}

/// Pons V2 bonding curve (native ETH launches).
interface IPonsCurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut);
    function graduated() external view returns (bool);
}

/// Pons launch tokens are ERC20Burnable.
interface IBurnableToken {
    function balanceOf(address a) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function burn(uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
}

/// Buys a graduated launch token on its Uniswap v4 pool.
interface ICommitSwapRouter {
    function buy(address token, uint256 minOut, address recipient) external payable returns (uint256 out);
}

interface ICommitFactory {
    function treasury() external view returns (address);
    function treasuryBps() external view returns (uint16);
    function keeper() external view returns (address);
    function owner() external view returns (address);
    function escrow() external view returns (address);
    function pons() external view returns (address);
    function swapRouter() external view returns (address);
}

/// @title CommitVault — one per launched coin, tied to one GitHub repo.
/// @notice Receives the coin's Pons creator fees. Each claim sends the treasury share on at once; everything the
/// vault keeps is the buyback budget. When a commit lands on the repo's default branch, the keeper spends a slice
/// of the budget buying the coin and burns every token bought. Nobody can withdraw from a vault.
contract CommitVault {
    address public factory;
    string public repo;            // "owner/name", lowercase
    address public creator;        // the wallet that launched through Commit
    address public token;          // bound once by setToken
    address public curve;          // its Pons bonding curve
    address public dev;            // the wallet that launched the token on Pons
    bool private _initialized;
    uint256 private _lock;

    uint256 public claimed;
    uint256 public sentToTreasury;
    uint256 public boughtBack;     // ETH spent buying the coin back
    uint256 public tokensBurned;
    uint256 public buybacks;
    uint256 public commitsCounted;

    event Init(string repo, address indexed creator);
    event TokenBound(address indexed token, address curve, address dev);
    event FeesClaimed(uint256 amount, uint256 toTreasury, uint256 toBuyback);
    event BoughtBack(uint256 ethSpent, uint256 tokensBurned, bool viaCurve, bytes20 commit, uint32 commits);
    event DevBuyback(address indexed dev, uint256 ethSpent, uint256 tokensBurned);

    error AlreadyInit();
    error NotKeeper();
    error Locked();
    error PayFailed();
    error TokenAlreadySet();
    error NotThisVault();
    error NoToken();
    error NoBudget();
    error NoRouter();
    error Slippage();

    modifier nonReentrant() { if (_lock == 2) revert Locked(); _lock = 2; _; _lock = 1; }

    constructor() { _initialized = true; } // the implementation itself can never be initialised

    function init(string calldata repo_, address creator_) external {
        if (_initialized) revert AlreadyInit();
        _initialized = true;
        _lock = 1;
        factory = msg.sender;
        repo = repo_;
        creator = creator_;
        emit Init(repo_, creator_);
    }

    receive() external payable {}

    /// @notice Binds the launch token. Anyone can call it once: Pons must confirm this vault is the token's
    /// creator-fee recipient and that it trades against native ETH.
    function setToken(address token_) external {
        if (token != address(0)) revert TokenAlreadySet();
        IPonsV2.LaunchedToken memory lt = IPonsV2(ICommitFactory(factory).pons()).getLaunchedToken(token_);
        if (!lt.exists || lt.creatorFeeRecipient != address(this) || lt.pairToken != address(0)) revert NotThisVault();
        token = token_;
        curve = lt.curve;
        dev = lt.deployer;
        emit TokenBound(token_, lt.curve, lt.deployer);
    }

    function claimable() public view returns (uint256) {
        return IPonsFeeEscrow(ICommitFactory(factory).escrow()).balanceOf(address(this));
    }

    /// @notice ETH waiting for commits: everything the vault holds.
    function budget() public view returns (uint256) { return address(this).balance; }

    /// @notice Pulls this vault's creator fees out of the Pons escrow and sends the treasury share on.
    /// Anyone can call it.
    function claimFees() public nonReentrant returns (uint256 got) {
        IPonsFeeEscrow e = IPonsFeeEscrow(ICommitFactory(factory).escrow());
        if (e.balanceOf(address(this)) == 0) return 0;
        uint256 before = address(this).balance;
        e.claim();
        got = address(this).balance - before;
        claimed += got;
        uint256 cut = got * ICommitFactory(factory).treasuryBps() / 10_000;
        if (cut > 0) {
            sentToTreasury += cut;
            (bool ok,) = ICommitFactory(factory).treasury().call{value: cut}("");
            if (!ok) revert PayFailed();
        }
        emit FeesClaimed(got, cut, got - cut);
    }

    /// @notice Spends up to `amount` of the budget on the coin and burns every token bought. Before graduation it
    /// buys on the Pons curve, after it through the factory's swap router. Only the keeper (or the owner) calls it,
    /// with `minOut` from a fresh quote and the commit that triggered it.
    /// If the dev wallet has given this vault an unlimited allowance, the tokens are bought for the dev wallet and
    /// burned from it in the same transaction, so charts show a dev buy followed by a dev burn. The ETH still comes
    /// from the vault and the dev wallet never keeps a token.
    function buyback(uint256 amount, uint256 minOut, bytes20 commit, uint32 commits) external nonReentrant returns (uint256 burned) {
        ICommitFactory f = ICommitFactory(factory);
        if (msg.sender != f.keeper() && msg.sender != f.owner()) revert NotKeeper();
        address t = token;
        if (t == address(0)) revert NoToken();
        uint256 amt = amount > address(this).balance ? address(this).balance : amount;
        if (amt == 0) revert NoBudget();
        address d = dev;
        bool asDev = d != address(0) && IBurnableToken(t).allowance(d, address(this)) >= type(uint256).max / 2;
        address to = asDev ? d : address(this);
        uint256 ethBefore = address(this).balance;
        uint256 tokBefore = IBurnableToken(t).balanceOf(to);
        bool viaCurve = _buy(f, t, amt, minOut, to);
        uint256 used = ethBefore - address(this).balance; // unspent ETH comes back to the vault
        burned = IBurnableToken(t).balanceOf(to) - tokBefore;
        if (burned == 0 || burned < minOut) revert Slippage();
        if (asDev) IBurnableToken(t).burnFrom(d, burned);
        else IBurnableToken(t).burn(burned);
        boughtBack += used;
        tokensBurned += burned;
        buybacks += 1;
        commitsCounted += commits;
        emit BoughtBack(used, burned, viaCurve, commit, commits);
        if (asDev) emit DevBuyback(d, used, burned);
    }

    function _buy(ICommitFactory f, address t, uint256 amt, uint256 minOut, address to) private returns (bool viaCurve) {
        viaCurve = !IPonsCurve(curve).graduated();
        if (viaCurve) {
            IPonsCurve(curve).buy{value: amt}(amt, minOut, to);
        } else {
            address r = f.swapRouter();
            if (r == address(0)) revert NoRouter();
            ICommitSwapRouter(r).buy{value: amt}(t, minOut, to);
        }
    }

    function stats() external view returns (
        address token_, uint256 budget_, uint256 claimable_, uint256 claimed_, uint256 boughtBack_, uint256 tokensBurned_,
        uint256 buybacks_, uint256 commits_, bool graduated
    ) {
        graduated = curve != address(0) && IPonsCurve(curve).graduated();
        return (token, address(this).balance, claimable(), claimed, boughtBack, tokensBurned, buybacks, commitsCounted, graduated);
    }
}

/// @title CommitFactory — deterministic vaults for Commit launches.
/// @notice A launch on Commit sets its Pons creator-fee recipient to `predictVault(...)` before the vault exists.
/// The address commits to the repo and the launcher, so nobody can deploy it with other terms.
contract CommitFactory {
    address public owner;
    address public treasury;
    address public keeper;
    address public swapRouter;     // buys graduated tokens on their v4 pool
    address public immutable escrow;
    address public immutable pons;
    address public immutable implementation;
    uint16 public treasuryBps;     // share of each claim sent to the treasury; the vault keeps the rest for buybacks

    mapping(address => bool) public isVault;
    address[] public vaults;

    event VaultCreated(address indexed vault, string repo, address indexed creator, bytes32 nonce);
    event OwnershipTransferred(address indexed from, address indexed to);
    event SplitSet(uint16 treasuryBps);
    event SwapRouterSet(address router);

    error NotOwner();
    error ZeroAddress();
    error BadBps();
    error BadRepo();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor(address escrow_, address pons_, address treasury_, address keeper_, uint16 treasuryBps_) {
        if (escrow_ == address(0) || pons_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (treasuryBps_ > 9000) revert BadBps();
        owner = msg.sender;
        escrow = escrow_;
        pons = pons_;
        treasury = treasury_;
        keeper = keeper_ == address(0) ? msg.sender : keeper_;
        treasuryBps = treasuryBps_;
        implementation = address(new CommitVault());
        emit OwnershipTransferred(address(0), msg.sender);
        emit SplitSet(treasuryBps_);
    }

    function saltOf(string calldata repo, address creator, bytes32 nonce) public pure returns (bytes32) {
        return keccak256(abi.encode(keccak256(bytes(repo)), creator, nonce));
    }

    function _cloneCode() internal view returns (bytes memory) {
        return abi.encodePacked(hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3");
    }

    function predictVault(string calldata repo, address creator, bytes32 nonce) public view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), saltOf(repo, creator, nonce), keccak256(_cloneCode())));
        return address(uint160(uint256(h)));
    }

    /// @notice Deploys the vault for these terms if it does not exist yet. Anyone can call it.
    function createVault(string calldata repo, address creator, bytes32 nonce) public returns (address v) {
        uint256 n = bytes(repo).length;
        if (n < 3 || n > 140) revert BadRepo();
        v = predictVault(repo, creator, nonce);
        if (v.code.length != 0) return v;
        bytes memory code = _cloneCode();
        bytes32 salt = saltOf(repo, creator, nonce);
        address deployed;
        assembly { deployed := create2(0, add(code, 0x20), mload(code), salt) }
        if (deployed == address(0)) revert ZeroAddress();
        CommitVault(payable(deployed)).init(repo, creator);
        isVault[deployed] = true;
        vaults.push(deployed);
        emit VaultCreated(deployed, repo, creator, nonce);
    }

    /// @notice One call for keepers and holders: create the vault if needed and claim its fees.
    function harvest(string calldata repo, address creator, bytes32 nonce) external returns (address v, uint256 got) {
        v = createVault(repo, creator, nonce);
        got = CommitVault(payable(v)).claimFees();
    }

    function vaultCount() external view returns (uint256) { return vaults.length; }

    /* ── admin ───────────────────────────────────────────── */

    function setTreasury(address v) external onlyOwner { if (v == address(0)) revert ZeroAddress(); treasury = v; }
    function setKeeper(address v) external onlyOwner { if (v == address(0)) revert ZeroAddress(); keeper = v; }
    function setSplit(uint16 treasuryBps_) external onlyOwner { if (treasuryBps_ > 9000) revert BadBps(); treasuryBps = treasuryBps_; emit SplitSet(treasuryBps_); }
    function setSwapRouter(address r) external onlyOwner { swapRouter = r; emit SwapRouterSet(r); }
    function transferOwnership(address v) external onlyOwner { if (v == address(0)) revert ZeroAddress(); emit OwnershipTransferred(owner, v); owner = v; }
}
