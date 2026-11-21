// Commit keeper: watches each coin's GitHub repo; claims creator fees into the vault (80% straight to the treasury),
// and when new commits land on the default branch, spends 30% of the vault per commit buying the coin and burns it.
// Used by the Worker cron.
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, PONS, ESCROW_ABI, RULE } from "../chain.js";

export const robinhood = defineChain({
  id: CHAIN.id, name: CHAIN.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [CHAIN.rpc] } },
  blockExplorers: { default: { name: "Blockscout", url: CHAIN.explorer } }
});

export const FACTORY_ABI = parseAbi([
  "function harvest(string repo, address creator, bytes32 nonce) returns (address v, uint256 got)",
  "function predictVault(string repo, address creator, bytes32 nonce) view returns (address)",
  "function keeper() view returns (address)",
  "function treasury() view returns (address)",
  "function treasuryBps() view returns (uint16)",
  "function swapRouter() view returns (address)",
  "function owner() view returns (address)"
]);
export const VAULT_ABI = parseAbi([
  "function token() view returns (address)",
  "function dev() view returns (address)",
  "function budget() view returns (uint256)",
  "function setToken(address token)",
  "function buyback(uint256 amount, uint256 minOut, bytes20 commit, uint32 commits) returns (uint256 burned)",
  "function stats() view returns (address token, uint256 budget, uint256 claimable, uint256 claimed, uint256 boughtBack, uint256 tokensBurned, uint256 buybacks, uint256 commits, bool graduated)",
  "event FeesClaimed(uint256 amount, uint256 toTreasury, uint256 toBuyback)",
  "event BoughtBack(uint256 ethSpent, uint256 tokensBurned, bool viaCurve, bytes20 commit, uint32 commits)",
  "event DevBuyback(address indexed dev, uint256 ethSpent, uint256 tokensBurned)"
]);
const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
]);
const MAX = 2n ** 256n - 1n;
const ZERO = "0x0000000000000000000000000000000000000000";

export function clients(key, rpcUrl) {
  const account = privateKeyToAccount(key.startsWith("0x") ? key : "0x" + key);
  const rpc = rpcUrl || CHAIN.rpc;
  const pub = createPublicClient({ chain: robinhood, transport: http(rpc) });
  const wallet = createWalletClient({ chain: robinhood, transport: http(rpc), account });
  return { account, pub, wallet };
}

/** Latest commits on a repo's default branch, newest first. */
export async function repoCommits(repo, token, fetchImpl = fetch, perPage = 30) {
  const headers = { "User-Agent": "commitdot.fun", Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetchImpl(`https://api.github.com/repos/${repo}/commits?per_page=${perPage}`, { headers });
  if (r.status === 404 || r.status === 409) return { missing: true, commits: [] }; // 409 = empty repo
  if (!r.ok) throw new Error(`GitHub ${r.status} for ${repo}`);
  const js = await r.json();
  return {
    commits: (Array.isArray(js) ? js : []).map(c => ({
      sha: c.sha,
      msg: ((c.commit && c.commit.message) || "").split("\n")[0].slice(0, 140),
      author: (c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name) || "unknown",
      date: (c.commit && c.commit.committer && c.commit.committer.date) || null
    }))
  };
}

/** Pure: how many commits are new since the last one we saw. */
export function newCommits(commits, last) {
  if (!commits.length) return [];
  if (!last || !last.sha) return [];                       // first look: start counting from here
  const i = commits.findIndex(c => c.sha === last.sha);
  if (i >= 0) return commits.slice(0, i);
  // history rewritten or more than a page of commits: count the ones newer than the last date we saw
  const t = last.date ? Date.parse(last.date) : 0;
  return commits.filter(c => c.date && Date.parse(c.date) > t);
}

/** Pure: ETH to spend for `n` commits, each one 30% of what is left. */
export function buyAmount(budget, n, perCommitBps = RULE.perCommitBps) {
  let left = budget;
  for (let k = 0; k < n; k++) left = left * BigInt(10000 - perCommitBps) / 10000n;
  return budget - left;
}

/**
 * One keeper pass. `state` holds, per coin: last commit seen, commits waiting for a buyback, time of the last buyback.
 * Sends at most `maxTx` transactions. Returns { actions, state } (actions go to the public activity feed).
 */
export async function keeperTick({ key, config, launches, state, rpcUrl, githubToken, maxTx = 3, maxRepos = 12, now = Date.now(),
  minClaimWei = 100000000000000n, minBuyWei = 10000000000000n, fetchImpl = fetch, log = () => {} }) {
  const actions = [];
  if (!config?.factory || !launches?.length) return { actions, state };
  const { account, pub, wallet } = clients(key, rpcUrl);
  let sent = 0;
  const me = account.address.toLowerCase();
  // rotate through the coins so every repo gets looked at even when there are many
  const start = (state._cursor || 0) % launches.length;
  const order = [...launches.slice(start), ...launches.slice(0, start)].slice(0, maxRepos);
  state._cursor = (start + order.length) % launches.length;

  for (const L of order) {
    const k = L.token.toLowerCase();
    const S = state[k] || (state[k] = { last: null, pending: 0, head: null, lastBuyAt: 0 });
    // 1. GitHub: count new commits on the default branch
    try {
      const { commits, missing } = await repoCommits(L.repo, githubToken, fetchImpl);
      if (missing) S.missing = true;
      else {
        delete S.missing;
        const fresh = newCommits(commits, S.last);
        if (commits.length) S.last = { sha: commits[0].sha, date: commits[0].date };
        if (fresh.length) {
          S.pending = Math.min(RULE.maxBatch, (S.pending || 0) + fresh.length);
          S.head = fresh[0];
          log(`${L.symbol}: ${fresh.length} new commit(s) on ${L.repo}, ${S.pending} waiting`);
        }
      }
    } catch (e) { log(`github ${L.repo}: ${String(e.message || e).slice(0, 120)}`); }
    if (sent >= maxTx) continue; // still track commits, just no more transactions this pass

    // 2. chain: claim fees, bind the token, let the dev wallet's buys be burned, buy back
    try {
      const vcode = await pub.getCode({ address: L.vault });
      let exists = !!vcode && vcode !== "0x";
      const claimable = await pub.readContract({ address: PONS.escrow, abi: ESCROW_ABI, functionName: "balanceOf", args: [L.vault] });
      if (claimable >= minClaimWei || (claimable > 0n && !exists)) {
        log(`harvest ${L.symbol} claimable=${claimable}`);
        const hash = await wallet.writeContract({ address: config.factory, abi: FACTORY_ABI, functionName: "harvest", args: [L.repo, L.deployer, L.nonce], account });
        sent++;
        const rc = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
        for (const lg of rc.logs) {
          if (lg.address.toLowerCase() !== L.vault.toLowerCase()) continue;
          try { const ev = decodeEventLog({ abi: VAULT_ABI, data: lg.data, topics: lg.topics }); if (ev.eventName === "FeesClaimed") actions.push({ type: "claim", token: L.token, symbol: L.symbol, repo: L.repo, amount: ev.args.amount.toString(), toVault: ev.args.toBuyback.toString(), tx: hash, ts: Date.now() }); } catch {}
        }
        exists = true;
        if (sent >= maxTx) continue;
      }
      if (!exists) continue;
      let bound = await pub.readContract({ address: L.vault, abi: VAULT_ABI, functionName: "token" });
      if (bound === ZERO) {
        log(`bind ${L.symbol}`);
        const hash = await wallet.writeContract({ address: L.vault, abi: VAULT_ABI, functionName: "setToken", args: [L.token], account });
        sent++; await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
        bound = L.token;
        if (sent >= maxTx) continue;
      }
      const dev = (await pub.readContract({ address: L.vault, abi: VAULT_ABI, functionName: "dev" })).toLowerCase();
      if (dev === me) {
        const al = await pub.readContract({ address: bound, abi: ERC20_ABI, functionName: "allowance", args: [account.address, L.vault] });
        if (al < MAX / 2n) {
          log(`approve ${L.symbol}: the dev wallet lets its vault burn what it buys`);
          const hash = await wallet.writeContract({ address: bound, abi: ERC20_ABI, functionName: "approve", args: [L.vault, MAX], account });
          sent++; await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
          if (sent >= maxTx) continue;
        }
      }
      if (!S.pending || now - (S.lastBuyAt || 0) < RULE.cooldownMs) continue;
      const budget = await pub.getBalance({ address: L.vault });
      const amount = buyAmount(budget, S.pending);
      if (amount < minBuyWei) { log(`${L.symbol}: ${S.pending} commit(s) waiting, vault too small (${budget} wei)`); continue; }
      const sha = ("0x" + (S.head?.sha || "0".repeat(40)).slice(0, 40));
      const { result: quote } = await pub.simulateContract({ address: L.vault, abi: VAULT_ABI, functionName: "buyback", args: [amount, 0n, sha, S.pending], account });
      const minOut = quote * 95n / 100n;
      log(`buyback ${L.symbol} ${S.pending} commit(s) amount=${amount} quote=${quote}`);
      const hash = await wallet.writeContract({ address: L.vault, abi: VAULT_ABI, functionName: "buyback", args: [amount, minOut, sha, S.pending], account });
      sent++;
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
      let item = null, asDev = false;
      for (const lg of rc.logs) {
        if (lg.address.toLowerCase() !== L.vault.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: VAULT_ABI, data: lg.data, topics: lg.topics });
          if (ev.eventName === "BoughtBack") item = { type: "buyback", token: L.token, symbol: L.symbol, repo: L.repo, sha: S.head?.sha || null, msg: S.head?.msg || "", author: S.head?.author || "", commits: S.pending, eth: ev.args.ethSpent.toString(), tokens: ev.args.tokensBurned.toString(), tx: hash, ts: Date.now() };
          if (ev.eventName === "DevBuyback") asDev = true;
        } catch {}
      }
      if (rc.status === "success") {
        if (item) { item.dev = asDev; actions.push(item); }
        S.pending = 0; S.head = null; S.lastBuyAt = now;
      }
    } catch (e) {
      log(`skip ${L.symbol}: ${(e.shortMessage || e.message || String(e)).slice(0, 200)}`);
    }
  }
  return { actions, state };
}
