// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
// Test helpers only.
contract MockEscrow {
    mapping(address => uint256) public balanceOf;
    function credit(address r) external payable { balanceOf[r] += msg.value; }
    function claim() external returns (uint256 a) {
        a = balanceOf[msg.sender]; require(a > 0, "NoBalance"); balanceOf[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: a}(""); require(ok, "TransferFailed");
    }
}
contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    function mint(address to, uint256 a) external { balanceOf[to] += a; totalSupply += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function burn(uint256 a) external { balanceOf[msg.sender] -= a; totalSupply -= a; }
    function burnFrom(address f, uint256 a) external {
        uint256 al = allowance[f][msg.sender]; require(al >= a, "allowance");
        if (al != type(uint256).max) allowance[f][msg.sender] = al - a;
        balanceOf[f] -= a; totalSupply -= a;
    }
}
contract MockCurve {
    MockToken public t; bool public graduated;
    constructor(MockToken t_) { t = t_; }
    function setGraduated(bool g) external { graduated = g; }
    // spends 90% of what it gets, refunds the rest, mints 1000 tokens per wei spent
    function buy(uint256 quoteIn, uint256 minOut, address to) external payable returns (uint256 out) {
        require(msg.value == quoteIn, "value");
        uint256 spend = quoteIn * 9 / 10; out = spend * 1000; require(out >= minOut, "slip");
        t.mint(to, out);
        (bool ok,) = msg.sender.call{value: quoteIn - spend}(""); require(ok, "refund");
    }
}
contract MockRouter {
    MockToken public t; constructor(MockToken t_) { t = t_; }
    function buy(address, uint256 minOut, address to) external payable returns (uint256 out) { out = msg.value * 500; require(out >= minOut, "slip"); t.mint(to, out); }
}
contract MockPons {
    struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken;
        uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled;
        uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }
    mapping(address => LaunchedToken) internal l;
    function set(address token, address curve, address deployer, address recipient) external {
        LaunchedToken storage x = l[token]; x.token = token; x.curve = curve; x.deployer = deployer; x.creatorFeeRecipient = recipient; x.exists = true;
    }
    function getLaunchedToken(address token) external view returns (LaunchedToken memory) { return l[token]; }
}
