// Serves the static site and a small cached proxy to the GitHub API,
// used only when a visitor's own GitHub rate limit is hit.
const ALLOWED = [
  /^repos\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/commits\?per_page=40$/,
  /^repos\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/stats\/commit_activity$/
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/gh") return gh(url, env, ctx);
    return env.ASSETS.fetch(request);
  }
};

async function gh(url, env, ctx) {
  const p = url.searchParams.get("p") || "";
  if (!ALLOWED.some(r => r.test(p))) return json({ error: "bad path" }, 400);
  const cache = caches.default;
  const key = new Request("https://gh-cache.commit/" + p.toLowerCase());
  const hit = await cache.match(key);
  if (hit) return hit;
  const headers = { "User-Agent": "commitdot.fun", Accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) headers.Authorization = "Bearer " + env.GITHUB_TOKEN;
  const r = await fetch("https://api.github.com/" + p, { headers });
  const body = await r.text();
  const res = new Response(body, {
    status: r.status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
  });
  if (r.status === 200) {
    const ttl = p.includes("/stats/") ? 21600 : 300;
    const cached = new Response(body, { status: 200, headers: { "content-type": "application/json", "cache-control": "public, max-age=" + ttl } });
    ctx.waitUntil(cache.put(key, cached));
  }
  return res;
}

function json(o, s) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
}
