// Commit app pages: launch, coin, coins, admin, plus the live parts of the home page.
const $ = (s, r = document) => r.querySelector(s);
const C = window.COMMIT || {};
const page = document.body.dataset.page || "home";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
const eth = (wei, d = 4) => { const n = Number(BigInt(wei || 0)) / 1e18; return n === 0 ? "0" : n < 10 ** -d ? n.toExponential(1) : n.toFixed(d); };
const big = (wei) => { const n = Number(BigInt(wei || 0) / 10n ** 15n) / 1000; return n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : n.toFixed(0); };
const ago = (ts) => { const s = Math.max(1, (Date.now() - ts) / 1000); for (const [n, l] of [[86400, "d"], [3600, "h"], [60, "m"]]) if (s >= n) return Math.floor(s / n) + l + " ago"; return Math.floor(s) + "s ago"; };
const toast = (m) => { const t = $("#toast"); if (!t) return; t.textContent = m; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2200); };
async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}
let w3m = null;
const w3 = () => (w3m ||= import("/assets/web3.js?v=1"));
const cfgP = api("/api/config").catch(() => ({ configured: false }));
const splitTxt = (c) => `${(c.treasuryBps ?? 8000) / 100}% to Commit · ${100 - (c.treasuryBps ?? 8000) / 100}% to the repo's vault`;

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]"); if (!b) return;
  navigator.clipboard.writeText(b.dataset.copy).then(() => toast("Copied"), () => toast(b.dataset.copy));
});

/* ── wallet button (sub pages) ── */
const wbtn = $("#wallet");
async function ensureWallet() {
  const m = await w3();
  if (m.account()) return m.account();
  try { const a = await m.connect(); return a; } catch (e) { toast(m.errorText(e)); return null; }
}
if (wbtn) {
  const paint = (a) => { wbtn.textContent = a ? short(a) : "Connect"; };
  wbtn.onclick = async () => { const m = await w3(); if (m.account()) return; paint(await ensureWallet()); };
  w3().then(m => { m.onAccount(paint); m.resume().then(paint).catch(() => {}); });
}

/* ── activity rows (home + coin page) ── */
function buyRow(a, withCoin = true) {
  const sha = a.sha ? a.sha.slice(0, 7) : "commit";
  const commitUrl = a.sha ? `https://github.com/${a.repo}/commit/${a.sha}` : `https://github.com/${a.repo}`;
  return `<li><a class="sha" href="${commitUrl}" target="_blank" rel="noopener">${esc(sha)}</a>
    <a class="msg" href="${commitUrl}" target="_blank" rel="noopener">${esc(a.msg || "new commits")}</a>
    <a class="buy" href="${EXPLORER}/tx/${a.tx}" target="_blank" rel="noopener">buy ${eth(a.eth)} ETH ↗</a>
    <span class="meta">${withCoin ? `<a href="/coin?ca=${a.token}" style="color:inherit">${esc(a.symbol)}</a> · ` : ""}${esc(a.repo)} · ${a.commits || 1} commit${(a.commits || 1) > 1 ? "s" : ""} · ${big(a.tokens)} burned${a.dev ? '<span class="badge">dev buy + burn</span>' : ""} · ${ago(a.ts)}</span></li>`;
}

/* ── HOME: launch button + live buybacks ── */
if (page === "home") {
  cfgP.then(c => {
    const b = $("#launch-btn");
    if (c.configured && b) { b.className = "btn btn-main btn-sm"; b.innerHTML = "Launch"; }
  });
  api("/api/activity").then(list => {
    const buys = list.filter(a => a.type === "buyback");
    if (!buys.length) return;
    $("#live").hidden = false;
    $("#live-feed").innerHTML = buys.slice(0, 20).map(a => buyRow(a)).join("");
  }).catch(() => {});
}

/* ── LAUNCH ── */
if (page === "launch") {
  const st = { repo: null, img: null, imgBlob: null };
  const f = (id) => $("#f-" + id);
  const setErr = (fid, m) => { const fl = $("#" + fid); fl.classList.toggle("bad", !!m); $(".err", fl).textContent = m || ""; };
  const status = (m, err) => { const s = $("#l-status"); s.textContent = m || ""; s.classList.toggle("err", !!err); };
  const preview = () => {
    $("#pv-name").textContent = f("name").value.trim() || "Your coin";
    $("#pv-sym").textContent = (f("sym").value.trim() || "TICKER").toUpperCase();
    $("#pv-img").innerHTML = st.img ? `<img src="${st.img}" alt="">` : "";
    $("#pv-repo").textContent = st.repo ? "github.com/" + st.repo.full_name.toLowerCase() : "no repo yet";
  };
  ["name", "sym"].forEach(k => f(k).addEventListener("input", () => { if (k === "sym") f("sym").value = f("sym").value.toUpperCase().replace(/[^A-Z0-9]/g, ""); preview(); }));
  const parseRepo = (raw) => {
    const s = (raw || "").trim().replace(/^https?:\/\//, "").replace(/^(www\.)?github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
    const m = s.match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/);
    return m ? (m[1] + "/" + m[2]) : null;
  };
  async function checkRepo() {
    const r = parseRepo(f("repo").value);
    st.repo = null; $("#repo-card").hidden = true; preview();
    if (!r) { setErr("repo-field", "Use owner/repo, like torvalds/linux."); return false; }
    setErr("repo-field", "");
    let j = null;
    try {
      let res = await fetch("https://api.github.com/repos/" + r).catch(() => null);
      if (!res || res.status === 403 || res.status === 429) res = await fetch("/api/gh?p=" + encodeURIComponent("repos/" + r));
      if (res.status === 404) { setErr("repo-field", "This repo doesn't exist or isn't public."); return false; }
      j = await res.json();
    } catch { setErr("repo-field", "GitHub didn't answer. Try again."); return false; }
    if (!j || !j.full_name) { setErr("repo-field", "GitHub didn't answer. Try again."); return false; }
    if (j.private) { setErr("repo-field", "The repo must be public."); return false; }
    st.repo = j;
    f("repo").value = j.full_name;
    $("#repo-card").hidden = false;
    $("#repo-card").innerHTML = `<b>${esc(j.full_name)}</b>${j.description ? `<p>${esc(j.description)}</p>` : ""}<div class="meta"><span class="br">branch ${esc(j.default_branch)}</span><span>★ ${Number(j.stargazers_count || 0).toLocaleString("en-US")}</span><span>last push ${j.pushed_at ? ago(Date.parse(j.pushed_at)) : "—"}</span>${j.archived ? "<span>archived: no new commits will come</span>" : ""}</div>`;
    preview();
    return true;
  }
  $("#repo-check").onclick = checkRepo;
  f("repo").addEventListener("change", checkRepo);
  f("repo").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); checkRepo(); } });
  const q = new URLSearchParams(location.search).get("repo"); if (q) { f("repo").value = q; checkRepo(); }
  f("img").addEventListener("change", () => {
    const file = f("img").files[0]; if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return setErr("img-field", "Use a PNG, JPG, WEBP or GIF.");
    if (file.size > 1_500_000) return setErr("img-field", "The image must be under 1.5 MB.");
    setErr("img-field", ""); st.imgBlob = file; st.img = URL.createObjectURL(file);
    $("#img-prev").innerHTML = `<img src="${st.img}" alt="">`; preview();
  });
  let CFG = null;
  cfgP.then(async c => {
    $("[data-cfg-split]").textContent = splitTxt(c);
    if (!c.configured) { $("#fire").textContent = "Launches open soon"; $("#fire").disabled = true; return; }
    CFG = c;
    try { const m = await w3(); const fee = await m.launchFee(); $("#fee-cell").textContent = `${eth(fee, 6)} ETH Pons fee + gas`; } catch {}
  });
  const validate = () => {
    let ok = true;
    const bad = (id, m) => { ok = false; setErr(id, m); };
    ["img-field", "name-field", "sym-field", "desc-field", "x-field", "web-field", "buy-field"].forEach(id => setErr(id, ""));
    if (!st.repo) bad("repo-field", "Check a public repo first.");
    if (!st.imgBlob) bad("img-field", "Add your coin image.");
    if (!f("name").value.trim()) bad("name-field", "Name your coin.");
    if (!/^[A-Z0-9]{2,10}$/.test(f("sym").value)) bad("sym-field", "2–10 characters, A–Z and 0–9.");
    for (const k of ["x", "web"]) { const v = f(k).value.trim(); if (v && !/^https?:\/\/\S+\.\S+/.test(v)) bad(k + "-field", "Use a full https:// link."); }
    if (!/^\d*[.,]?\d*$/.test(f("buy").value.trim())) bad("buy-field", "An amount in ETH, like 0.01");
    return ok;
  };
  async function register(p) {
    for (let k = 0; k < 10; k++) {
      try { return await api("/api/launches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) }); }
      catch (e) { if (!/not found yet|404/i.test(e.message) || k === 9) throw e; await new Promise(r => setTimeout(r, 2500)); }
    }
  }
  function done(L) {
    try { localStorage.removeItem("commit-pending"); } catch {}
    $("#lf").hidden = true; $(".side-col").hidden = true;
    const d = $("#done"); d.hidden = false;
    const text = `I just launched ${L.name} on Commit. Every commit on ${L.repo} buys it back and burns it.\n\nCA: ${L.token}`;
    d.innerHTML = `<p class="eyebrow">Launched</p><h2>${esc(L.name)} is live.</h2>
      <div class="kv" style="padding:0;margin:14px 0 20px">
        <div><span>Coin</span><b><a class="v" href="${EXPLORER}/token/${L.token}" target="_blank" rel="noopener">${short(L.token)} ↗</a> <button class="chip" data-copy="${L.token}">copy</button></b></div>
        <div><span>Vault</span><b><a href="${EXPLORER}/address/${L.vault}" target="_blank" rel="noopener">${short(L.vault)} ↗</a></b></div>
        <div><span>Repo</span><b>${esc(L.repo)}</b></div>
        <div><span>Buybacks</span><b>start with the next commit after fees come in</b></div>
      </div>
      <div class="btn-row"><a class="btn btn-main" href="/coin?ca=${L.token}">Open the coin page</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="https://x.com/intent/tweet?${new URLSearchParams({ text })}">Share on X</a></div>`;
  }
  $("#lf").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!CFG) { toast("Launches open soon"); return; }
    if (!st.repo && f("repo").value) await checkRepo();
    if (!validate()) { toast("Check the highlighted fields"); return; }
    const a = await ensureWallet(); if (!a) return;
    const m = await w3(); const btn = $("#fire"); btn.disabled = true;
    try {
      status("Uploading your image…");
      const { url: logo } = await api("/api/upload", { method: "POST", headers: { "content-type": st.imgBlob.type }, body: st.imgBlob });
      status("Preparing the repo's vault…");
      const repo = st.repo.full_name.toLowerCase();
      const nonce = m.randomNonce();
      const vault = await m.predictVault(CFG.factory, repo, a, nonce);
      const fee = await m.launchFee();
      const params = {
        name: f("name").value.trim(), symbol: f("sym").value, logo,
        description: (f("desc").value.trim() || `Every commit on github.com/${repo} buys this coin back and burns it.`).slice(0, 280),
        socials: { twitter: f("x").value.trim(), telegram: "", discord: "", website: f("web").value.trim() || `${location.origin}/coin`, farcaster: "" },
        creatorFeeRecipient: vault, creatorTaxBps: 0, buybackEnabled: false, expectedEconomics: "0x" + "0".repeat(64), salt: m.randomNonce()
      };
      const buyStr = (f("buy").value.trim() || "0").replace(",", ".");
      const buy = m.parseEther(buyStr === "." ? "0" : buyStr);
      status("Confirm the launch in your wallet…"); btn.textContent = "Confirm in wallet…";
      const hash = buy > 0n ? await m.launchWithBuy(params, buy, a, fee) : await m.launchPlain(params, fee);
      const pending = { tx: hash, nonce, repo };
      try { localStorage.setItem("commit-pending", JSON.stringify(pending)); } catch {}
      status("Launching on Robinhood Chain…"); btn.textContent = "Launching…";
      const rc = await m.wait(hash);
      if (rc.status !== "success") throw new Error("The launch transaction failed.");
      status("Registering the coin with Commit…");
      done(await register(pending));
    } catch (err) {
      status(m.errorText ? m.errorText(err) : err.message, true);
    }
    btn.disabled = false; btn.textContent = "Launch on Pons";
  });
  // finish a registration interrupted by a closed tab
  (async () => {
    let p = null; try { p = JSON.parse(localStorage.getItem("commit-pending") || "null"); } catch {}
    if (!p) return;
    try { const L = await register(p); toast(`${L.name} registered with Commit`); localStorage.removeItem("commit-pending"); }
    catch (e) { if (/failed on-chain|not a Pons/i.test(e.message)) localStorage.removeItem("commit-pending"); }
  })();
  preview();
}

/* ── COIN ── */
if (page === "coin") {
  const ca = (new URLSearchParams(location.search).get("ca") || "").trim();
  (async () => {
    const head = $("#c-head");
    if (!/^0x[0-9a-fA-F]{40}$/.test(ca)) { head.innerHTML = `<div class="empty">No coin in this link. <a class="v" href="/coins">See all coins →</a></div>`; return; }
    let L; try { L = await api("/api/launch/" + ca); } catch { head.innerHTML = `<div class="empty">This coin wasn't launched on Commit. <a class="v" href="/coins">See all coins →</a></div>`; return; }
    document.title = `${L.name} · Commit`;
    head.innerHTML = `<div class="logo">${L.logo ? `<img src="${esc(L.logo)}" alt="">` : ""}</div><div style="min-width:0"><h1>${esc(L.name)}</h1>
      <div class="sym">${esc(L.symbol)} · ROBINHOOD CHAIN · TIED TO <a class="v" href="https://github.com/${esc(L.repo)}" target="_blank" rel="noopener">${esc(L.repo)}</a></div>
      <div class="links"><button class="chip" data-copy="${L.token}">CA <b>${short(L.token)}</b> copy</button><a class="chip" href="https://dexscreener.com/robinhood/${L.token}" target="_blank" rel="noopener">Chart ↗</a><a class="chip" href="${EXPLORER}/token/${L.token}" target="_blank" rel="noopener">Token ↗</a><a class="chip" href="${EXPLORER}/address/${L.vault}" target="_blank" rel="noopener">Vault ↗</a><a class="chip" href="https://github.com/${esc(L.repo)}" target="_blank" rel="noopener">Repo ↗</a></div></div>`;
    const cell = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
    const drawStats = (v, s) => {
      $("#c-stats").innerHTML = cell("Vault", v ? eth(v.budget + v.claimable * BigInt(100 - (C.FEE_TEAM ?? 80)) / 100n) + " ETH" : "—") + cell("Next commit buys", v ? eth((v.budget + v.claimable * BigInt(100 - (C.FEE_TEAM ?? 80)) / 100n) * BigInt(C.PER_COMMIT ?? 30) / 100n, 5) + " ETH" : "—") + cell("Bought back", v ? eth(v.boughtBack) + " ETH" : "—") + cell("Burned", v ? big(v.tokensBurned) : "—");
      $("#c-wait").textContent = s && s.pending ? `${s.pending} commit${s.pending > 1 ? "s" : ""} waiting` : "keeper watching";
    };
    drawStats(null, null);
    const [acts, s] = await Promise.all([api("/api/activity").catch(() => []), api("/api/state/" + ca).catch(() => null)]);
    const buys = acts.filter(a => a.type === "buyback" && a.token.toLowerCase() === ca.toLowerCase());
    $("#c-feed").innerHTML = buys.length ? buys.map(a => buyRow(a, false)).join("") : `<li class="empty">No buyback yet. The next commit on ${esc(L.repo)} after fees come in triggers the first one.</li>`;
    try { const m = await w3(); drawStats(await m.vaultStats(L.vault), s); } catch { drawStats(null, s); }
    try {
      let res = await fetch(`https://api.github.com/repos/${L.repo}/commits?per_page=30`).catch(() => null);
      if (!res || !res.ok) res = await fetch("/api/gh?p=" + encodeURIComponent(`repos/${L.repo}/commits?per_page=30`));
      const cm = await res.json();
      $("#c-branch").textContent = "default branch";
      $("#c-commits").innerHTML = (Array.isArray(cm) ? cm : []).slice(0, 15).map(c => `<li><a class="sha" href="${esc(c.html_url)}" target="_blank" rel="noopener">${c.sha.slice(0, 7)}</a><a class="msg" href="${esc(c.html_url)}" target="_blank" rel="noopener">${esc((c.commit.message || "").split("\n")[0])}</a><span class="buy">${Date.parse(c.commit.committer.date) > L.ts ? "counts" : ""}</span><span class="meta">${esc((c.author && c.author.login) || c.commit.author.name)} · ${ago(Date.parse(c.commit.committer.date))}</span></li>`).join("") || `<li class="empty">No commits yet.</li>`;
    } catch { $("#c-commits").innerHTML = `<li class="empty">GitHub didn't answer.</li>`; }
  })();
}

/* ── COINS ── */
if (page === "coins") {
  api("/api/launches").then(list => {
    $("#coins").innerHTML = list.length ? list.map(L => `<a class="coin-card" href="/coin?ca=${L.token}">${L.logo ? `<img src="${esc(L.logo)}" alt="">` : `<div class="ph"></div>`}<div style="min-width:0"><b>${esc(L.name)}</b><span class="s">${esc(L.symbol)}</span><span>${esc(L.repo)}</span></div></a>`).join("")
      : `<div class="empty">No coins yet. <a class="v" href="/launch">Launch the first one →</a></div>`;
  }).catch(() => { $("#coins").innerHTML = `<div class="empty">Coins show up here once Commit is live.</div>`; });
}

/* ── ADMIN ── */
if (page === "admin") {
  const AK = "commit-admin";
  const ids = ["router", "treasury", "keeper", "bps", "factory"];
  let d = {}; try { d = JSON.parse(localStorage.getItem(AK) || "{}"); } catch {}
  const DEFAULT = "0xBdAab26FeC78C768F559b32348Dbc8EE24d7b1Fb";
  ids.forEach(k => { const el = $("#a-" + k); if (d[k]) el.value = d[k]; el.oninput = () => { d[k] = el.value.trim(); localStorage.setItem(AK, JSON.stringify(d)); }; });
  if (!$("#a-treasury").value) $("#a-treasury").value = DEFAULT;
  if (!$("#a-keeper").value) $("#a-keeper").value = DEFAULT;
  const v = (k) => $("#a-" + k).value.trim();
  const set = (k, val) => { $("#a-" + k).value = val; d[k] = val; localStorage.setItem(AK, JSON.stringify(d)); };
  const log = (m) => { $("#a-log").textContent = `[${new Date().toLocaleTimeString()}] ${m}\n` + $("#a-log").textContent; };
  const drawStatus = async () => {
    const [c, k] = await Promise.all([api("/api/config").catch(() => ({})), api("/api/keeper").catch(() => ({}))]);
    if (c.factory) { if (!v("factory")) set("factory", c.factory); if (c.swapRouter && !v("router")) set("router", c.swapRouter); }
    const last = k.last;
    $("#a-status").innerHTML = [["Admin wallet", c.admin || "—"], ["Factory", c.factory || "not saved"], ["Swap router", c.swapRouter || "not saved"], ["Keeper", k.enabled ? short(k.address) : "no key on the Worker"], ["GitHub token", k.github ? "set" : "missing"], ["Private RPC", k.privateRpc ? "set" : "missing"], ["Last keeper pass", last ? `${ago(last.at)} · ${last.actions} action(s)${last.error ? " · " + esc(last.error) : ""}` : "never"]]
      .map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join("") + (last?.log?.length ? `<div><span>Keeper log</span><b style="font:400 11px var(--mono);white-space:pre-wrap">${esc(last.log.join("\n"))}</b></div>` : "");
  };
  drawStatus();
  const run = (fn) => async (e) => { const b = e.currentTarget; b.disabled = true; try { const a = await ensureWallet(); if (a) await fn(await w3(), a); } catch (err) { log("✗ " + ((await w3()).errorText(err))); } b.disabled = false; };
  $("#a-deploy-router").onclick = run(async (m) => {
    log("Deploying the swap router… confirm in your wallet");
    const r = await m.deploy({ abi: m.ABI.router, bytecode: m.BYTECODE.router, args: [m.PONS.factory] });
    set("router", r.address); log("✓ Swap router " + r.address);
  });
  $("#a-deploy-factory").onclick = run(async (m) => {
    const bps = Math.round(parseFloat(v("bps")) * 100);
    if (!m.isAddress(v("treasury")) || !m.isAddress(v("keeper")) || !(bps >= 0 && bps <= 9000)) throw new Error("Check the treasury, keeper and share (0 to 90%).");
    log("Deploying the factory… confirm in your wallet");
    const r = await m.deploy({ abi: m.ABI.factory, bytecode: m.BYTECODE.factory, args: [m.PONS.escrow, m.PONS.factory, v("treasury"), v("keeper"), bps] });
    set("factory", r.address); log("✓ Factory " + r.address + ` (your share ${bps / 100}%)`);
  });
  $("#a-set-router").onclick = run(async (m) => {
    if (!m.isAddress(v("factory")) || !m.isAddress(v("router"))) throw new Error("Deploy the router and the factory first.");
    const h = await m.write({ address: v("factory"), abi: m.ABI.factory, functionName: "setSwapRouter", args: [v("router")] });
    await m.wait(h); log("✓ Router set on the factory");
  });
  $("#a-save").onclick = run(async (m) => {
    if (!m.isAddress(v("factory"))) throw new Error("Deploy or paste the factory first.");
    const bps = Number(await m.read(v("factory"), m.ABI.factory, "treasuryBps"));
    const config = { factory: v("factory"), treasuryBps: bps, swapRouter: m.isAddress(v("router")) ? v("router") : null };
    const message = `Commit config\n${JSON.stringify(config)}\n${Date.now()}`;
    const signature = await m.sign(message);
    await api("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config, message, signature }) });
    log("✓ Configuration saved: launches are open"); drawStatus();
  });
  $("#a-run").onclick = run(async (m) => {
    const message = `Commit keeper run\n${Date.now()}`;
    const signature = await m.sign(message);
    log("Keeper pass running…");
    await api("/api/keeper/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) });
    log("✓ Keeper pass done"); drawStatus();
  });
}
