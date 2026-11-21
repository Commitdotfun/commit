// Commit Worker: static site, API (config, launches, activity, image uploads, GitHub proxy) and the keeper cron.
import { createPublicClient, http, fallback, decodeFunctionData, decodeAbiParameters, decodeEventLog, verifyMessage, getAddress, isAddress } from "viem";
import { CHAIN, PONS, PONS_FACTORY_ABI, REPO_RE } from "../chain.js";
import { keeperTick, robinhood, FACTORY_ABI, clients, repoCommits } from "../keeper/core.js";

// The public Robinhood RPC refuses Cloudflare: the Worker uses the private RPC_URL secret when it is set.
const pub = (env) => createPublicClient({ chain: robinhood, transport: env?.RPC_URL ? fallback([http(env.RPC_URL), http(CHAIN.rpc)]) : http(CHAIN.rpc) });
const J = (data, status = 200, extra = {}) => new Response(JSON.stringify(data, (k, v) => typeof v === "bigint" ? v.toString() : v), { status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", ...extra } });
const bad = (msg, status = 400) => J({ error: msg }, status);
const lc = (a) => (a || "").toLowerCase();

const getConfig = (env) => env.DATA.get("config", "json");
function publicConfig(c, env) {
  return { configured: !!(c && c.factory), chain: CHAIN, pons: { factory: PONS.factory, escrow: PONS.escrow }, admin: env.ADMIN_ADDRESS || null, ...(c || {}) };
}
async function getLaunches(env) {
  const out = [];
  let cursor;
  do {
    const r = await env.DATA.list({ prefix: "launch:", cursor });
    for (const k of r.keys) if (k.metadata) out.push(k.metadata);
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
async function addActivity(env, items) {
  if (!items?.length) return;
  const cur = (await env.DATA.get("activity", "json")) || [];
  const seen = new Set(cur.map(a => a.tx + ":" + a.type));
  const fresh = items.filter(a => !seen.has(a.tx + ":" + a.type));
  if (!fresh.length) return;
  await env.DATA.put("activity", JSON.stringify([...fresh, ...cur].slice(0, 300)));
}

/* ── GitHub (cached proxy, also used by the replay on the home page) ── */
const GH_ALLOWED = [
  /^repos\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/commits\?per_page=(40|30)$/,
  /^repos\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/stats\/commit_activity$/,
  /^repos\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/
];
async function gh(url, env, ctx) {
  const p = url.searchParams.get("p") || "";
  if (!GH_ALLOWED.some(r => r.test(p))) return bad("bad path");
  const cache = caches.default;
  const key = new Request("https://gh-cache.commit/" + p.toLowerCase());
  const hit = await cache.match(key);
  if (hit) return hit;
  const headers = { "User-Agent": "commitdot.fun", Accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) headers.Authorization = "Bearer " + env.GITHUB_TOKEN;
  const r = await fetch("https://api.github.com/" + p, { headers });
  const body = await r.text();
  const res = new Response(body, { status: r.status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
  if (r.status === 200) {
    const ttl = p.includes("/stats/") ? 21600 : 120;
    ctx.waitUntil(cache.put(key, new Response(body, { status: 200, headers: { "content-type": "application/json", "cache-control": "public, max-age=" + ttl } })));
  }
  return res;
}

/* ── images for Pons logos ── */
async function upload(req, env, url) {
  const type = (req.headers.get("content-type") || "").split(";")[0].trim();
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[type];
  if (!ext) return bad("Use a PNG, JPG, WEBP or GIF image.");
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > 1_500_000) return bad("The image must be under 1.5 MB.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
  if (!(await env.DATA.get("img:" + hash, "stream"))) await env.DATA.put("img:" + hash, buf, { metadata: { type } });
  return J({ url: `${url.origin}/i/${hash}.${ext}` });
}
async function image(path, env) {
  const m = /^\/i\/([0-9a-f]{40})\.(png|jpg|webp|gif)$/.exec(path);
  if (!m) return bad("Not found", 404);
  const r = await env.DATA.getWithMetadata("img:" + m[1], "arrayBuffer");
  if (!r.value) return bad("Not found", 404);
  return new Response(r.value, { headers: { "content-type": r.metadata?.type || "image/png", "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" } });
}

/* ── admin config (signed by the admin wallet) ── */
async function saveConfig(req, env) {
  if (!env.ADMIN_ADDRESS || !isAddress(env.ADMIN_ADDRESS)) return bad("ADMIN_ADDRESS is not set on the Worker.", 500);
  const { config, message, signature } = await req.json();
  if (!config || !message || !signature) return bad("Missing fields.");
  const ts = +String(message).split("\n").pop();
  if (message !== `Commit config\n${JSON.stringify(config)}\n${ts}` || Math.abs(Date.now() - ts) > 15 * 60 * 1000) return bad("Stale or malformed message.");
  if (!(await verifyMessage({ address: env.ADMIN_ADDRESS, message, signature }))) return bad("This wallet is not the Commit admin.", 403);
  if (!isAddress(config.factory || "")) return bad("Bad factory address.");
  const clean = {
    factory: getAddress(config.factory),
    treasuryBps: Number(config.treasuryBps ?? 8000),
    swapRouter: config.swapRouter && isAddress(config.swapRouter) ? getAddress(config.swapRouter) : null,
    updatedAt: Date.now()
  };
  await env.DATA.put("config", JSON.stringify(clean));
  return J(publicConfig(clean, env));
}

/* ── launch registry ── */
async function registerLaunch(req, env) {
  const body = await req.json();
  const { tx, nonce } = body;
  const repo = lc(body.repo || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx || "") || !/^0x[0-9a-fA-F]{64}$/.test(nonce || "") || !REPO_RE.test(repo)) return bad("Bad launch data.");
  const config = await getConfig(env);
  if (!config?.factory) return bad("Commit is not configured yet.", 503);
  // try the private RPC, then the public one (one of them may lag, refuse or be out of quota)
  const clients = [env.RPC_URL && createPublicClient({ chain: robinhood, transport: http(env.RPC_URL) }), createPublicClient({ chain: robinhood, transport: http(CHAIN.rpc) })].filter(Boolean);
  let receipt, txn, client, why = "";
  for (const c of clients) {
    try { [receipt, txn] = await Promise.all([c.getTransactionReceipt({ hash: tx }), c.getTransaction({ hash: tx })]); client = c; break; }
    catch (e) { why += (why ? " / " : "") + (e.shortMessage || e.message || "").split("\n")[0].slice(0, 120); }
  }
  if (!client) return bad(/not be found|not found/i.test(why) && !/HTTP|fetch|status|limit|unauthor/i.test(why) ? "Transaction not found yet. Try again in a few seconds." : "Could not read the launch transaction: " + why, 404);
  if (receipt.status !== "success") return bad("The launch transaction failed on-chain.");
  let p;
  if (lc(txn.to) === lc(PONS.factory)) p = decodeFunctionData({ abi: PONS_FACTORY_ABI, data: txn.input }).args[0];
  else if (lc(txn.to) === lc(PONS.launchRouter) && txn.input.slice(0, 10) === "0xf85f8e41") p = decodeAbiParameters([PONS_FACTORY_ABI[0].inputs[0]], "0x" + txn.input.slice(10))[0];
  else return bad("This is not a Pons launch.");
  const lg = receipt.logs.find(l => lc(l.address) === lc(PONS.factory) && (() => { try { return decodeEventLog({ abi: PONS_FACTORY_ABI, data: l.data, topics: l.topics }).eventName === "TokenLaunched"; } catch { return false; } })());
  if (!lg) return bad("No token was launched in this transaction.");
  const ev = decodeEventLog({ abi: PONS_FACTORY_ABI, data: lg.data, topics: lg.topics }).args;
  const vault = await client.readContract({ address: config.factory, abi: FACTORY_ABI, functionName: "predictVault", args: [repo, ev.deployer, nonce] });
  if (lc(vault) !== lc(p.creatorFeeRecipient)) return bad("The creator fees of this token do not go to its Commit vault.");
  const existing = await env.DATA.get("launch:" + lc(ev.token), "json");
  if (existing) return J(existing);
  const launch = {
    token: getAddress(ev.token), curve: getAddress(ev.curve), deployer: getAddress(ev.deployer), vault: getAddress(vault),
    repo, nonce, name: p.name.slice(0, 60), symbol: p.symbol.slice(0, 16), logo: p.logo.slice(0, 300), tax: Number(p.creatorTaxBps),
    tx, block: Number(receipt.blockNumber), ts: Date.now()
  };
  await env.DATA.put("launch:" + launch.token.toLowerCase(), JSON.stringify({ ...launch, description: p.description.slice(0, 500), socials: p.socials }), { metadata: launch });
  // commits count from the launch: remember the repo's head right now
  try {
    const { commits } = await repoCommits(repo, env.GITHUB_TOKEN, fetch, 1);
    const st = (await env.DATA.get("keeper:state", "json")) || {};
    st[launch.token.toLowerCase()] = { last: commits[0] ? { sha: commits[0].sha, date: commits[0].date } : null, pending: 0, head: null, lastBuyAt: 0 };
    await env.DATA.put("keeper:state", JSON.stringify(st));
  } catch {}
  await addActivity(env, [{ type: "launch", token: launch.token, symbol: launch.symbol, repo, tx, ts: launch.ts }]);
  return J(launch);
}

async function keeperStatus(env) {
  const last = await env.DATA.get("keeper:last", "json");
  let address = null;
  if (env.KEEPER_KEY) { try { address = clients(env.KEEPER_KEY).account.address; } catch {} }
  return J({ enabled: !!env.KEEPER_KEY, address, github: !!env.GITHUB_TOKEN, privateRpc: !!env.RPC_URL, last }, 200, { "cache-control": "no-store" });
}

async function coinState(token, env) {
  const st = (await env.DATA.get("keeper:state", "json")) || {};
  const s = st[lc(token)];
  return J(s ? { pending: s.pending || 0, last: s.last || null, lastBuyAt: s.lastBuyAt || 0, missing: !!s.missing } : { pending: 0 }, 200, { "cache-control": "no-store" });
}

async function runKeeper(env) {
  const started = Date.now();
  const config = await getConfig(env);
  const launches = await getLaunches(env);
  const state = (await env.DATA.get("keeper:state", "json")) || {};
  const before = JSON.stringify(state);
  let actions = [], error = null; const log = [];
  try { ({ actions } = await keeperTick({ key: env.KEEPER_KEY, config, launches, state, rpcUrl: env.RPC_URL, githubToken: env.GITHUB_TOKEN, log: (m) => log.push(String(m).slice(0, 240)) })); }
  catch (e) { error = (e.shortMessage || e.message || String(e)).slice(0, 300); }
  // KV free tier: 1,000 writes a day, so only write what changed
  const after = JSON.stringify(state);
  if (after !== before) await env.DATA.put("keeper:state", after);
  await addActivity(env, actions);
  const quiet = !actions.length && !error && after === before;
  const prev = quiet ? await env.DATA.get("keeper:last", "json") : null;
  if (!quiet || !prev || started - prev.at > 60 * 60 * 1000)
    await env.DATA.put("keeper:last", JSON.stringify({ at: started, ms: Date.now() - started, actions: actions.length, launches: launches.length, error, log: log.slice(-12) }));
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (req.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST", "access-control-allow-headers": "content-type" } });
      if (path === "/api/gh") return gh(url, env, ctx);
      if (path.startsWith("/i/")) return image(path, env);
      if (!env.DATA && path.startsWith("/api/")) return J({ configured: false }, 200);
      if (path === "/api/config" && req.method === "GET") return J(publicConfig(await getConfig(env), env), 200, { "cache-control": "no-store" });
      if (path === "/api/config" && req.method === "POST") return saveConfig(req, env);
      if (path === "/api/upload" && req.method === "POST") return upload(req, env, url);
      if (path === "/api/launches" && req.method === "GET") return J(await getLaunches(env), 200, { "cache-control": "no-store" });
      if (path === "/api/launches" && req.method === "POST") return registerLaunch(req, env);
      if (path.startsWith("/api/launch/")) { const t = path.split("/").pop(); const v = await env.DATA.get("launch:" + lc(t), "json"); return v ? J(v) : bad("Unknown token", 404); }
      if (path.startsWith("/api/state/")) return coinState(path.split("/").pop(), env);
      if (path === "/api/activity") return J((await env.DATA.get("activity", "json")) || [], 200, { "cache-control": "no-store" });
      if (path === "/api/keeper") return keeperStatus(env);
      if (path === "/api/keeper/run" && req.method === "POST") {
        // the admin can trigger a pass by hand (signed message, same as config)
        const { message, signature } = await req.json();
        const ts = +String(message || "").split("\n").pop();
        if (!message?.startsWith("Commit keeper run\n") || Math.abs(Date.now() - ts) > 10 * 60 * 1000) return bad("Stale message.");
        if (!(await verifyMessage({ address: env.ADMIN_ADDRESS, message, signature }))) return bad("Not the admin.", 403);
        if (!env.KEEPER_KEY) return bad("No keeper key on the Worker.");
        await runKeeper(env);
        return keeperStatus(env);
      }
      if (path.startsWith("/api/")) return bad("Not found", 404);
      return env.ASSETS.fetch(req);
    } catch (e) {
      return bad((e.shortMessage || e.message || "Server error").slice(0, 300), 500);
    }
  },
  async scheduled(event, env, ctx) {
    if (!env.KEEPER_KEY || !env.DATA) return;
    ctx.waitUntil(runKeeper(env));
  }
};
