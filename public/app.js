(() => {
  "use strict";
  const C = window.COMMIT || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- config into the page ---------- */
  $$("[data-cfg]").forEach(el => { el.textContent = C[el.dataset.cfg]; });
  ["#x-link", "#faq-x", "#end-x", "#foot-x"].forEach(s => { const a = $(s); if (a) a.href = C.X_URL; });
  const pons = $("#foot-pons"); if (pons) pons.href = C.PONS_URL;
  $("#ca-ticker").textContent = "$" + C.TICKER;

  const toast = msg => {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 1800);
  };

  const caBtn = $("#ca");
  if (C.CA && /^0x[0-9a-fA-F]{40}$/.test(C.CA)) {
    caBtn.classList.add("live");
    $("#ca-text").textContent = C.CA.slice(0, 6) + "…" + C.CA.slice(-4);
    caBtn.title = "Copy contract address";
    caBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(C.CA); toast("Contract address copied"); }
      catch { toast(C.CA); }
    });
    $("#kicker").textContent = "Live on Robinhood Chain, powered by Pons";
    $(".kicker .dot").classList.add("live-dot");
  } else {
    caBtn.title = "Contract address coming soon";
    caBtn.addEventListener("click", () => toast("$" + C.TICKER + " is coming soon"));
  }

  /* ---------- 3D skyline (point cloud) ---------- */
  const sky = (() => {
    const cv = $("#sky"), ctx = cv.getContext("2d");
    const N = 5, CELL = 0.34, GAP = 0.07, BASE = -0.62, STEP = 0.056, MAXH = 1.55;
    const OFF = (N * CELL + (N - 1) * GAP) / 2;
    const cols = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const s = (N - 1 - i) + (N - 1 - j);
      const h = 0.07 + 0.15 * s + ((i * 7 + j * 3) % 5 === 0 ? 0.06 : 0);
      cols.push({ i, j, s, h, target: h, flash: 0, accent: s >= 6 });
    }
    const parts = [];
    let W = 0, H = 0, dpr = 1, t0 = performance.now(), running = true, mx = 0, my = 0, project = null;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = cv.getBoundingClientRect(); W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    // box faces: normal + two axes; emit lattice points
    function emitBox(x0, y0, z0, x1, y1, z1, cb) {
      const faces = [
        [1, [0, 1, 0], y1], [1, [0, -1, 0], y0],
        [0, [1, 0, 0], x1], [0, [-1, 0, 0], x0],
        [2, [0, 0, 1], z1], [2, [0, 0, -1], z0]
      ];
      for (const [ax, n, val] of faces) {
        const o = [0, 1, 2].filter(a => a !== ax);
        const lo = [x0, y0, z0], hi = [x1, y1, z1];
        for (let u = lo[o[0]] + STEP / 2; u < hi[o[0]]; u += STEP)
          for (let v = lo[o[1]] + STEP / 2; v < hi[o[1]]; v += STEP) {
            const p = [0, 0, 0]; p[o[0]] = u; p[o[1]] = v; p[ax] = val;
            cb(p, n);
          }
      }
    }
    const buckets = new Map();
    function put(key, x, y, s) { let b = buckets.get(key); if (!b) { b = []; buckets.set(key, b); } b.push(x, y, s); }

    function frame(now) {
      if (!running) return;
      const t = (now - t0) / 1000;
      const yaw = -0.78 + Math.sin(t * 0.16) * 0.32 + mx * 0.18;
      const pitch = 0.5 + my * 0.06 + Math.sin(t * 0.11) * 0.03;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const rotate = (x, y, z) => {
        const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
        return [x1, cp * y - sp * z1, sp * y + cp * z1];
      };
      const L = [-0.45, -0.65, 0.62], ln = Math.hypot(...L);
      const dist = 6, scale = 1.08 * Math.min(W, H) * 0.25, cxp = W / 2, cyp = H / 2 + 0.12 * Math.min(W, H) * 0.25;
      project = (x, y, z) => { const rp = rotate(x, y, z); const f = dist / (dist - rp[2]); return [cxp + rp[0] * f * scale, cyp - rp[1] * f * scale]; };
      buckets.clear();
      for (const c of cols) {
        c.h += (c.target - c.h) * 0.08;
        c.flash = Math.max(0, c.flash - 0.012);
        const x0 = -OFF + c.i * (CELL + GAP), z0 = -OFF + c.j * (CELL + GAP);
        const acc = c.accent || c.flash > 0.02;
        emitBox(x0, BASE, z0, x0 + CELL, BASE + c.h, z0 + CELL, (p, n) => {
          const rn = rotate(n[0], n[1], n[2]);
          if (rn[2] < -0.02) return;
          const rp = rotate(p[0], p[1], p[2]);
          const f = dist / (dist - rp[2]);
          const x = cxp + rp[0] * f * scale, y = cyp - rp[1] * f * scale;
          const lam = (rn[0] * L[0] + rn[1] * L[1] + rn[2] * L[2]) / ln;
          const lvl = Math.max(0, Math.min(4, Math.round((lam * 0.6 + 0.5) * 4)));
          const key = (acc ? (c.flash > 0.35 ? "f" : "a") : "m") + lvl;
          put(key, x, y, f);
        });
      }
      for (const p of parts) { p.y += p.vy; p.life -= 0.014; }
      for (let k = parts.length - 1; k >= 0; k--) if (parts[k].life <= 0) parts.splice(k, 1);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const base = Math.max(1.1, Math.min(W, H) / 330);
      const mono = ["#5f646d", "#7d838c", "#a3a8b0", "#cfd2d7", "#ffffff"];
      const viol = ["#4e2c99", "#6a42c4", "#8957e5", "#a87ff5", "#cdb2ff"];
      const flash = ["#7f5ae0", "#9b74f0", "#b693ff", "#d3bcff", "#f1e8ff"];
      ctx.globalCompositeOperation = "lighter";
      for (const [key, arr] of buckets) {
        const kind = key[0], lvl = +key[1];
        ctx.fillStyle = kind === "m" ? mono[lvl] : kind === "a" ? viol[lvl] : flash[lvl];
        ctx.globalAlpha = kind === "m" ? 0.78 : 0.92;
        ctx.beginPath();
        for (let q = 0; q < arr.length; q += 3) {
          const s = base * arr[q + 2] * (kind === "m" ? 1 : 1.12);
          ctx.rect(arr[q] - s / 2, arr[q + 1] - s / 2, s, s);
        }
        ctx.fill();
      }
      ctx.fillStyle = "#c4a5ff";
      for (const p of parts) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillRect(p.x, p.y, p.s, p.s);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      if (!reduce) requestAnimationFrame(frame);
    }

    function pulse(seed) {
      const c = cols[Math.abs(seed) % cols.length];
      c.target = Math.min(MAXH, c.target + 0.09);
      c.flash = 1;
      if (cols.every(k => k.target >= MAXH - 0.01)) cols.forEach(k => { k.target = k.h * 0.55; });
      // burn sparks rising from the top of the column
      if (project) {
        const x0 = -OFF + c.i * (CELL + GAP) + CELL / 2, z0 = -OFF + c.j * (CELL + GAP) + CELL / 2;
        const [x, y] = project(x0, BASE + c.target, z0);
        for (let k = 0; k < 22; k++) parts.push({ x: x + (Math.random() - 0.5) * W * 0.06, y: y - Math.random() * H * 0.03, vy: -(0.35 + Math.random() * 1.0), life: 0.6 + Math.random() * 0.5, s: 1.2 + Math.random() * 1.6 });
      }
      if (reduce) requestAnimationFrame(frame);
    }

    resize();
    addEventListener("resize", () => { resize(); if (reduce) requestAnimationFrame(frame); });
    cv.closest(".hero").addEventListener("pointermove", e => {
      const r = cv.getBoundingClientRect();
      mx = ((e.clientX - r.left) / r.width - 0.5); my = ((e.clientY - r.top) / r.height - 0.5);
    });
    new IntersectionObserver(es => {
      const vis = es[0].isIntersecting;
      if (vis && !running) { running = true; requestAnimationFrame(frame); }
      else if (!vis) running = false;
    }).observe(cv);
    requestAnimationFrame(frame);
    return { pulse };
  })();

  /* ---------- helpers ---------- */
  const hashNum = s => { let h = 0; for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) | 0; return h; };
  const ago = d => {
    const s = Math.max(1, (Date.now() - d.getTime()) / 1000);
    const u = [[31536000, "y"], [2592000, "mo"], [86400, "d"], [3600, "h"], [60, "m"]];
    for (const [n, l] of u) if (s >= n) return Math.floor(s / n) + l + " ago";
    return Math.floor(s) + "s ago";
  };
  const fmtEth = v => v.toFixed(4) + " ETH";
  const fmtBig = v => v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : Math.round(v).toString();
  const parseRepo = raw => {
    let s = (raw || "").trim().replace(/^https?:\/\//, "").replace(/^(www\.)?github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
    const m = s.match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})/);
    return m ? m[1] + "/" + m[2] : null;
  };

  const DEMO = [
    "fix: off-by-one in page cache eviction", "docs: clarify install steps", "perf: avoid double alloc in parser",
    "feat: add --json flag to status", "refactor: split scheduler into modules", "test: cover empty input case",
    "chore: bump deps", "fix: race when closing sockets", "feat: streaming responses", "ci: cache build artifacts",
    "fix: handle unicode paths on windows", "feat: dark mode for the dashboard"
  ];
  const demoCommits = repo => DEMO.map((m, k) => {
    const sha = Math.abs(hashNum(repo + m + k)).toString(16).padStart(8, "0") + "a1c3e5";
    return { sha, msg: m, author: "dev" + (k % 4 + 1), date: new Date(Date.now() - (DEMO.length - k) * 3600e3 * 5), url: "https://github.com/" + repo };
  });

  const cache = new Map();
  // try GitHub from the visitor's own connection, fall back to our cached proxy
  async function gh(path) {
    try {
      const r = await fetch("https://api.github.com/" + path, { headers: { Accept: "application/vnd.github+json" } });
      if (r.status !== 403 && r.status !== 429) return r;
    } catch (e) { /* network or CORS issue: use the proxy */ }
    return fetch("/api/gh?p=" + encodeURIComponent(path));
  }
  async function loadCommits(repo) {
    if (cache.has("c:" + repo)) return cache.get("c:" + repo);
    const r = await gh(`repos/${repo}/commits?per_page=40`);
    if (r.status === 404) throw new Error("notfound");
    if (!r.ok) throw new Error("limit");
    const js = await r.json();
    if (!Array.isArray(js) || !js.length) throw new Error("empty");
    const out = js.map(c => ({
      sha: c.sha, msg: (c.commit && c.commit.message || "").split("\n")[0] || "(no message)",
      author: (c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name) || "unknown",
      date: new Date((c.commit && c.commit.committer && c.commit.committer.date) || Date.now()),
      url: c.html_url
    })).reverse(); // oldest first
    cache.set("c:" + repo, out);
    return out;
  }
  async function loadYear(repo) {
    if (cache.has("y:" + repo)) return cache.get("y:" + repo);
    for (let k = 0; k < 4; k++) {
      const r = await gh(`repos/${repo}/stats/commit_activity`);
      if (r.status === 202) { await new Promise(res => setTimeout(res, 1800)); continue; }
      if (!r.ok) throw new Error("limit");
      const js = await r.json();
      if (Array.isArray(js) && js.length) { cache.set("y:" + repo, js); return js; }
      throw new Error("empty");
    }
    throw new Error("pending");
  }

  /* ---------- heatmap ---------- */
  const heat = $("#heat");
  let heatWeeks = null;
  function drawHeat(weeks, repo) {
    heat.innerHTML = "";
    heatWeeks = weeks;
    const vals = weeks ? weeks.flatMap(w => w.days) : Array(364).fill(0);
    const nz = vals.filter(v => v > 0).sort((a, b) => a - b);
    const q = p => nz.length ? nz[Math.min(nz.length - 1, Math.floor(nz.length * p))] : 1;
    const t1 = q(0.25), t2 = q(0.5), t3 = q(0.8);
    const frag = document.createDocumentFragment();
    vals.forEach(v => {
      const i = document.createElement("i");
      i.className = v === 0 ? "" : v <= t1 ? "l1" : v <= t2 ? "l2" : v <= t3 ? "l3" : "l4";
      i.title = v + (v === 1 ? " commit" : " commits");
      frag.appendChild(i);
    });
    heat.appendChild(frag);
    if (weeks) {
      const total = weeks.reduce((a, w) => a + w.total, 0);
      $("#heat-total").textContent = `${total.toLocaleString("en-US")} commits in 12 months on ${repo} → ${total.toLocaleString("en-US")} buybacks`;
      $("#year-cap").textContent = `A year of commits on ${repo}. On Commit, each one is a buyback.`;
    }
  }
  function popHeat(date) {
    if (!heatWeeks) return;
    const ts = date.getTime() / 1000;
    const idx = heatWeeks.findIndex(w => ts >= w.week && ts < w.week + 7 * 86400);
    if (idx < 0) return;
    const day = Math.floor((ts - heatWeeks[idx].week) / 86400);
    const cell = heat.children[idx * 7 + day];
    if (cell) { cell.classList.remove("pop"); void cell.offsetWidth; cell.classList.add("pop"); }
  }
  drawHeat(null);

  /* ---------- simulated chart ---------- */
  const chart = (() => {
    const cv = $("#chart"), ctx = cv.getContext("2d");
    let pts = [], buys = [];
    function draw() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), r = cv.getBoundingClientRect();
      if (!r.width) return;
      cv.width = r.width * dpr; cv.height = r.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = r.width, H = r.height, pad = 8;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "#1e2227"; ctx.lineWidth = 1;
      for (let k = 1; k < 4; k++) { const y = Math.round(H * k / 4) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      if (pts.length < 2) return;
      const mn = Math.min(...pts), mxv = Math.max(...pts), span = (mxv - mn) || mxv * 0.01 || 1;
      const X = k => pad + (W - pad * 2) * k / (pts.length - 1);
      const Y = v => H - pad - (H - pad * 2) * (v - mn) / span;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "rgba(163,113,247,.32)"); g.addColorStop(1, "rgba(163,113,247,0)");
      ctx.beginPath(); ctx.moveTo(X(0), Y(pts[0]));
      pts.forEach((v, k) => ctx.lineTo(X(k), Y(v)));
      ctx.lineTo(X(pts.length - 1), H); ctx.lineTo(X(0), H); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); pts.forEach((v, k) => k ? ctx.lineTo(X(k), Y(v)) : ctx.moveTo(X(k), Y(v)));
      ctx.strokeStyle = "#a371f7"; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
      ctx.fillStyle = "#3fb950";
      buys.forEach(k => { if (k < pts.length) { ctx.beginPath(); ctx.arc(X(k), Y(pts[k]), 2.6, 0, Math.PI * 2); ctx.fill(); } });
      const lx = X(pts.length - 1), ly = Y(pts[pts.length - 1]);
      ctx.fillStyle = "#eceef1"; ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    addEventListener("resize", draw);
    return {
      reset(p0) { pts = [p0]; buys = []; draw(); },
      push(v, isBuy) { pts.push(v); if (isBuy) buys.push(pts.length - 1); if (pts.length > 90) { pts.shift(); buys = buys.map(b => b - 1).filter(b => b >= 0); } draw(); }
    };
  })();

  /* ---------- replay ---------- */
  const feed = $("#feed"), state = $("#feed-state");
  let timer = null, run = 0;
  function setState(txt, cls) { state.textContent = txt; state.className = "pill" + (cls ? " " + cls : ""); }

  function addRow(c, buy, ticker) {
    const li = document.createElement("li");
    const a = document.createElement("a"); a.className = "sha"; a.href = c.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = c.sha.slice(0, 7);
    const m = document.createElement("span"); m.className = "msg"; m.textContent = c.msg;
    const b = document.createElement("span"); b.className = "buy"; b.textContent = "buy " + buy.toFixed(4) + " ETH";
    const meta = document.createElement("span"); meta.className = "meta"; meta.textContent = `${c.author} · ${ago(c.date)} · ${ticker} bought and burned`;
    li.append(a, m, b, meta);
    feed.prepend(li);
    while (feed.children.length > 12) feed.lastChild.remove();
  }

  async function replay(repo) {
    const my = ++run;
    clearTimeout(timer);
    $("#repo-in").value = repo;
    $$("#chips button").forEach(b => b.classList.toggle("on", b.dataset.repo === repo));
    $("#sky-repo").textContent = repo;
    feed.innerHTML = ""; setState("loading");
    $("#heat-total").textContent = "Counting commits…";
    let commits, demo = false;
    try { commits = await loadCommits(repo); }
    catch (e) {
      if (my !== run) return;
      if (e.message === "notfound") {
        setState("not found", "err");
        feed.innerHTML = '<li class="empty">That repo doesn\'t exist or isn\'t public. Try owner/repo, like torvalds/linux.</li>';
        return;
      }
      commits = demoCommits(repo); demo = true;
    }
    if (my !== run) return;
    setState(demo ? "demo commits" : "live from GitHub", demo ? "" : "on");
    loadYear(repo).then(w => { if (my === run) drawHeat(w, repo); }).catch(e => {
      if (my !== run) return;
      drawHeat(null);
      $("#heat-total").textContent = e.message === "pending"
        ? "GitHub is still counting this repo. Replay it again in a minute."
        : "GitHub isn't answering right now. Replay it again in a minute.";
    });

    const ticker = "$" + repo.split("/")[1].replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toUpperCase();
    let vault = 0, bought = 0, burned = 0, price = 4.2e-9, k = 0, n = 0;
    chart.reset(price);
    const show = () => {
      $("#s-commits").textContent = n;
      $("#s-vault").textContent = fmtEth(vault);
      $("#s-bought").textContent = fmtEth(bought);
      $("#s-burned").textContent = fmtBig(burned) + " " + ticker.slice(1);
    };
    show();
    const step = (quiet) => {
      if (my !== run) return;
      // a little trading in between: price wiggles, fees trickle into the vault
      for (let w = 0; w < 2; w++) {
        price *= 1 + (Math.random() - 0.5) * 0.02;
        vault += 0.01 + Math.random() * 0.015;
        chart.push(price, false);
      }
      const c = commits[k % commits.length];
      const buy = vault * (C.PER_COMMIT / 100);
      vault -= buy; bought += buy;
      burned += buy / price;
      price *= 1 + buy * 0.9;
      n++; k++;
      chart.push(price, true);
      addRow(c, buy, ticker);
      show();
      if (quiet === true) return;
      sky.pulse(hashNum(c.sha));
      popHeat(c.date);
      $("#sky-last").textContent = c.sha.slice(0, 7) + " · buy " + buy.toFixed(4) + " ETH";
      timer = setTimeout(step, reduce ? 3500 : 2300);
    };
    // fill the feed with a few commits right away, then replay live
    for (let q = 0; q < Math.min(5, commits.length - 1); q++) step(true);
    step();
  }

  $("#repo-form").addEventListener("submit", e => {
    e.preventDefault();
    const repo = parseRepo($("#repo-in").value);
    if (!repo) { toast("Use owner/repo, like vercel/next.js"); return; }
    replay(repo);
  });
  $$("#chips button").forEach(b => b.addEventListener("click", () => replay(b.dataset.repo)));

  // start when the page loads (the hero skyline uses the same feed)
  replay(C.DEMO_REPO || "torvalds/linux");
})();
