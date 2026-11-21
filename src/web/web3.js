// Browser side of Commit: wallet connection, contract reads and writes on Robinhood Chain.
import { createPublicClient, createWalletClient, custom, http, defineChain, parseEther, formatEther, getAddress, toHex, isAddress, decodeEventLog, encodeDeployData, encodeAbiParameters } from "viem";
import { CHAIN, PONS, PONS_FACTORY_ABI, ESCROW_ABI, RULE } from "../chain.js";
import C from "../../build/contracts.json";

export { parseEther, formatEther, getAddress, isAddress, CHAIN, PONS, PONS_FACTORY_ABI, RULE };
export const ABI = { factory: C.CommitFactory.abi, vault: C.CommitVault.abi, router: C.CommitSwapRouter.abi };
export const BYTECODE = { factory: C.CommitFactory.bytecode, router: C.CommitSwapRouter.bytecode };

export const robinhood = defineChain({
  id: CHAIN.id, name: CHAIN.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [CHAIN.rpc] } },
  blockExplorers: { default: { name: "Blockscout", url: CHAIN.explorer } }
});
export const pub = createPublicClient({ chain: robinhood, transport: http(CHAIN.rpc, { batch: { wait: 16 } }) });

/* ── wallets (EIP-6963, window.ethereum as fallback) ── */
const announced = new Map();
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e) => { const d = e.detail; if (d?.info?.uuid) announced.set(d.info.uuid, d); });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}
export function wallets() {
  const list = [...announced.values()].map(d => ({ id: d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider }));
  if (!list.some(w => /phantom/i.test(w.name)) && window.phantom?.ethereum) list.push({ id: "phantom", name: "Phantom", icon: "", provider: window.phantom.ethereum });
  if (!list.length && window.ethereum) list.push({ id: "injected", name: window.ethereum.isPhantom ? "Phantom" : window.ethereum.isRabby ? "Rabby" : window.ethereum.isMetaMask ? "MetaMask" : "Browser wallet", icon: "", provider: window.ethereum });
  return list;
}
let session = null;
const listeners = new Set();
export const onAccount = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(session?.address || null); } catch {} });
export const account = () => session?.address || null;

async function ensureChain(provider) {
  const want = "0x" + CHAIN.id.toString(16);
  const cur = await provider.request({ method: "eth_chainId" });
  if (cur?.toLowerCase() === want) return;
  try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] }); }
  catch (e) {
    if (e?.code === 4902 || /unrecognized|not added|unknown chain/i.test(e?.message || "")) {
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: want, chainName: CHAIN.name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [CHAIN.rpc], blockExplorerUrls: [CHAIN.explorer] }] });
    } else throw e;
  }
}
export async function connect(provider) {
  if (!provider) { const w = wallets(); if (!w.length) throw new Error("No wallet found. Install MetaMask, Rabby or Phantom."); provider = w[0].provider; }
  const [addr] = await provider.request({ method: "eth_requestAccounts" });
  await ensureChain(provider);
  const address = getAddress(addr);
  session = { provider, address, wallet: createWalletClient({ chain: robinhood, transport: custom(provider), account: address }) };
  provider.on?.("accountsChanged", (a) => { if (!a?.length) session = null; else if (session) { session.address = getAddress(a[0]); session.wallet = createWalletClient({ chain: robinhood, transport: custom(provider), account: session.address }); } emit(); });
  try { localStorage.setItem("commit-wallet", "1"); } catch {}
  emit();
  return address;
}
export async function resume() {
  try { if (localStorage.getItem("commit-wallet") !== "1") return null; } catch { return null; }
  await new Promise(r => setTimeout(r, 120));
  for (const w of wallets()) { try { const a = await w.provider.request({ method: "eth_accounts" }); if (a?.length) return await connect(w.provider); } catch {} }
  return null;
}
function need() { if (!session) throw new Error("Connect your wallet first."); return session; }
async function onChain(provider) {
  await ensureChain(provider);
  if (Number(await provider.request({ method: "eth_chainId" })) !== CHAIN.id) throw new Error("Switch your wallet to Robinhood Chain (chain 4663) and try again.");
}
async function fees() {
  const b = await pub.getBlock({ blockTag: "latest" });
  const base = b.baseFeePerGas ?? await pub.getGasPrice();
  return { maxFeePerGas: base * 3n + 10_000_000n, maxPriorityFeePerGas: 0n };
}
const pad = (g) => g * 13n / 10n + 30_000n;

export async function write({ address, abi, functionName, args = [], value }) {
  const s = need(); await onChain(s.provider);
  const { request } = await pub.simulateContract({ address, abi, functionName, args, value, account: s.address });
  const gas = await pub.estimateContractGas({ address, abi, functionName, args, value, account: s.address });
  return s.wallet.writeContract({ ...request, account: s.address, gas: pad(gas), ...(await fees()) });
}
export async function deploy({ abi, bytecode, args = [] }) {
  const s = need(); await onChain(s.provider);
  const data = encodeDeployData({ abi, bytecode, args });
  const gas = await pub.estimateGas({ account: s.address, data });
  const hash = await s.wallet.deployContract({ abi, bytecode, args, account: s.address, gas: pad(gas), ...(await fees()) });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (rc.status !== "success" || !rc.contractAddress) throw new Error("Deployment failed.");
  return { hash, address: getAddress(rc.contractAddress) };
}
export async function sign(message) { const s = need(); return s.wallet.signMessage({ account: s.address, message }); }
export const wait = (hash) => pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
export const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });

export function errorText(e) {
  const m = e?.shortMessage || e?.details || e?.message || String(e);
  const all = [m, e?.details, e?.cause?.details, e?.cause?.message].filter(Boolean).join(" | ");
  if (/User rejected|denied|rejected the request/i.test(all)) return "You cancelled the transaction in your wallet.";
  if (/insufficient funds/i.test(all)) return "Not enough ETH on Robinhood Chain for this transaction.";
  const custom = /reverted with the following reason:\s*\n?(.+)|error (\w+)\(/i.exec(m);
  return (custom ? (custom[1] || custom[2]) : m).split("\n")[0].slice(0, 320);
}

/* ── vaults ── */
export async function vaultStats(vault) {
  const code = await pub.getCode({ address: vault });
  if (!code || code === "0x") {
    const claimable = await read(PONS.escrow, ESCROW_ABI, "balanceOf", [vault]);
    return { live: false, budget: 0n, claimable, claimed: 0n, boughtBack: 0n, tokensBurned: 0n, buybacks: 0, commits: 0, graduated: false };
  }
  const s = await read(vault, ABI.vault, "stats");
  return { live: true, budget: s[1], claimable: s[2], claimed: s[3], boughtBack: s[4], tokensBurned: s[5], buybacks: Number(s[6]), commits: Number(s[7]), graduated: s[8] };
}

/* ── Pons launch ── */
export async function launchWithBuy(params, quoteIn, recipient, fee) {
  const s = need(); await onChain(s.provider);
  const tp = PONS_FACTORY_ABI[0].inputs[0];
  const data = "0xf85f8e41" + encodeAbiParameters([tp, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "address[]" }],
    [params, PONS.launchConfigId, PONS.pairToken, quoteIn, 0n, recipient, []]).slice(2);
  const value = fee + quoteIn;
  await pub.call({ account: s.address, to: PONS.launchRouter, data, value });
  const gas = await pub.estimateGas({ account: s.address, to: PONS.launchRouter, data, value });
  return s.wallet.sendTransaction({ account: s.address, to: PONS.launchRouter, data, value, gas: pad(gas), ...(await fees()) });
}
export async function launchPlain(params, fee) {
  return write({ address: PONS.factory, abi: PONS_FACTORY_ABI, functionName: "launchToken", args: [params, PONS.launchConfigId, PONS.pairToken], value: fee });
}
export const launchFee = () => read(PONS.factory, PONS_FACTORY_ABI, "launchFee");
export const predictVault = (factory, repo, creator, nonce) => read(factory, ABI.factory, "predictVault", [repo, creator, nonce]);
export function randomNonce() { const b = new Uint8Array(32); crypto.getRandomValues(b); return toHex(b); }
export function launchedToken(receipt) {
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== PONS.factory.toLowerCase()) continue;
    try { const ev = decodeEventLog({ abi: PONS_FACTORY_ABI, data: l.data, topics: l.topics }); if (ev.eventName === "TokenLaunched") return ev.args; } catch {}
  }
  return null;
}
