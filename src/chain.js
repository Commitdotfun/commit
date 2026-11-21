// Robinhood Chain + Pons V2 constants shared by the site, the Worker and the keeper (same as Sweep, verified 2026-11-13).
export const CHAIN = {
  id: 4663,
  name: "Robinhood Chain",
  rpc: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com"
};

export const PONS = {
  factory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  escrow: "0xd3afeb2a57f70ef218aa82451c51b2fb0416ac9e",
  launchRouter: "0xe33e9e479df8802cb0866d5d05258bec4cf62948",
  launchConfigId: 0n,
  pairToken: "0x0000000000000000000000000000000000000000" // native ETH
};

const socials = { type: "tuple", name: "socials", components: ["twitter", "telegram", "discord", "website", "farcaster"].map(name => ({ type: "string", name })) };
const tokenParams = {
  type: "tuple", name: "params", components: [
    { type: "string", name: "name" }, { type: "string", name: "symbol" }, { type: "string", name: "logo" }, { type: "string", name: "description" },
    socials,
    { type: "address", name: "creatorFeeRecipient" }, { type: "uint16", name: "creatorTaxBps" }, { type: "bool", name: "buybackEnabled" },
    { type: "bytes32", name: "expectedEconomics" }, { type: "bytes32", name: "salt" }
  ]
};

export const PONS_FACTORY_ABI = [
  { type: "function", name: "launchToken", stateMutability: "payable", inputs: [tokenParams, { type: "uint256", name: "launchConfigId" }, { type: "address", name: "pairToken" }], outputs: [{ type: "address", name: "token" }, { type: "address", name: "curve" }] },
  { type: "function", name: "launchToken", stateMutability: "payable", inputs: [tokenParams, { type: "uint256", name: "launchConfigId" }, { type: "address", name: "pairToken" }, { type: "address[]", name: "snipeTaxExemptions" }], outputs: [{ type: "address", name: "token" }, { type: "address", name: "curve" }] },
  { type: "function", name: "launchFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxCreatorTaxBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "launchEnabled", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "event", name: "TokenLaunched", inputs: [
    { type: "address", name: "token", indexed: true }, { type: "address", name: "curve", indexed: true }, { type: "address", name: "deployer", indexed: true },
    { type: "address", name: "pairToken", indexed: false }, { type: "uint256", name: "launchConfigId", indexed: false }, { type: "uint256", name: "graduationThreshold", indexed: false }
  ] }
];

export const ESCROW_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }
];

export const DEAD = "0x000000000000000000000000000000000000dead";

// Buyback rule (the site shows the same numbers)
export const RULE = { perCommitBps: 10000, cooldownMs: 10 * 60 * 1000, maxBatch: 50 };
export const REPO_RE = /^[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9._-]{1,100}$/;
