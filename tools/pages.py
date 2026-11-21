# Generates the sub pages (launch, coin, coins, admin) with the same head, header and footer as the home page.
import os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="Launch a coin for any GitHub repo. Every push to its default branch buys the coin back and burns it.">
<meta name="theme-color" content="#08090b">
<link rel="icon" type="image/png" href="/favicon.png?v=2">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<meta property="og:title" content="{title}">
<meta property="og:image" content="https://commitdot.fun/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://commitdot.fun/og.png">
<link rel="stylesheet" href="/style.css?v=7">
</head>
<body data-page="{page}">
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="/" aria-label="Commit home"><img src="/img/logo.png?v=2" alt="" width="30" height="30"><span>commit</span></a>
    <nav class="nav" aria-label="Main">
      <a href="/#how">How it works</a>
      <a href="/#rule">The rule</a>
      <a href="/coins"{coins_on}>Coins</a>
      <a href="/launch"{launch_on}>Launch</a>
    </nav>
    <div class="top-right">
      <a class="icon-btn" id="x-link" href="https://x.com/commitdotfun" target="_blank" rel="noopener" aria-label="Commit on X">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43Z"/></svg>
      </a>
      <a class="icon-btn" id="gh-link" href="https://github.com/commitdotfun/commit" target="_blank" rel="noopener" aria-label="Commit on GitHub">
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M12 1.5a10.5 10.5 0 0 0-3.32 20.46c.53.1.72-.23.72-.5v-1.86c-2.92.64-3.54-1.24-3.54-1.24-.48-1.21-1.17-1.54-1.17-1.54-.95-.65.07-.64.07-.64 1.06.07 1.61 1.09 1.61 1.09.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.66-1.4-2.33-.27-4.78-1.17-4.78-5.18 0-1.15.41-2.08 1.08-2.82-.11-.26-.47-1.33.1-2.77 0 0 .88-.28 2.89 1.08a10 10 0 0 1 5.26 0c2-1.36 2.89-1.08 2.89-1.08.57 1.44.21 2.51.1 2.77.67.74 1.08 1.67 1.08 2.82 0 4.02-2.46 4.9-4.8 5.16.38.33.72.97.72 1.96v2.9c0 .28.19.61.73.5A10.5 10.5 0 0 0 12 1.5Z"/></svg>
      </a>
      <button class="btn btn-ghost btn-sm" id="wallet" type="button">Connect</button>
    </div>
  </div>
</header>
<main id="main">
"""
FOOT = """
</main>
<footer class="foot">
  <div class="wrap foot-in">
    <a class="brand" href="/"><img src="/img/logo.png?v=2" alt="" width="24" height="24"><span>commit</span></a>
    <p>Every commit is a buyback. Built on Robinhood Chain with Pons.</p>
    <div class="foot-links"><a href="https://x.com/commitdotfun" target="_blank" rel="noopener">X</a><a href="https://github.com/commitdotfun/commit" target="_blank" rel="noopener">GitHub</a><a href="https://ponsfamily.com/launchpad" target="_blank" rel="noopener">Pons</a></div>
  </div>
</footer>
<div class="toast" id="toast" role="status"></div>
<script src="/config.js?v=5"></script>
<script type="module" src="/assets/pages.js?v=4"></script>
</body>
</html>
"""
PAGES = {}

PAGES["launch"] = ("Launch a coin · Commit", """
<section class="phead"><div class="wrap">
  <p class="kicker"><i class="dot"></i><span>Robinhood Chain · via Pons</span></p>
  <h1>Launch a coin for a <em>repo.</em></h1>
  <p class="lead">Pick a public GitHub repo. Every commit on its default branch spends everything in the coin's vault buying it back, then burns it.</p>
</div></section>
<section class="band band-tight"><div class="wrap launch-grid">
  <form class="panel form" id="lf" autocomplete="off" novalidate>
    <div class="field" id="repo-field">
      <label for="f-repo">GitHub repo</label>
      <div class="repo-form"><span class="gh-prefix">github.com/</span><input id="f-repo" spellcheck="false" placeholder="owner/repo"><button class="btn btn-ghost btn-sm" type="button" id="repo-check">Check</button></div>
      <div class="repo-card" id="repo-card" hidden></div>
      <div class="err"></div>
    </div>
    <div class="field" id="img-field">
      <label>Coin image</label>
      <div class="img-pick"><div class="img-prev" id="img-prev"><span>PNG, JPG, WEBP or GIF<br>under 1.5 MB</span></div><label class="btn btn-ghost btn-sm" for="f-img">Choose image</label><input id="f-img" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></div>
      <div class="err"></div>
    </div>
    <div class="row2">
      <div class="field" id="name-field"><label for="f-name">Name</label><input id="f-name" maxlength="40" placeholder="Linux Coin"><div class="err"></div></div>
      <div class="field" id="sym-field"><label for="f-sym">Ticker</label><input id="f-sym" maxlength="10" placeholder="LINUX"><div class="err"></div></div>
    </div>
    <div class="field" id="desc-field"><label for="f-desc">Description <span class="faint">optional</span></label><textarea id="f-desc" rows="3" maxlength="280" placeholder="What this coin backs."></textarea><div class="err"></div></div>
    <div class="row2">
      <div class="field" id="x-field"><label for="f-x">X link <span class="faint">optional</span></label><input id="f-x" placeholder="https://x.com/…"><div class="err"></div></div>
      <div class="field" id="web-field"><label for="f-web">Website <span class="faint">optional</span></label><input id="f-web" placeholder="https://…"><div class="err"></div></div>
    </div>
    <div class="field" id="buy-field"><label for="f-buy">First buy <span class="faint">optional, in ETH</span></label><input id="f-buy" inputmode="decimal" placeholder="0"><div class="err"></div></div>
    <button class="btn btn-main btn-lg" type="submit" id="fire">Launch on Pons</button>
    <p class="status" id="l-status" role="status"></p>
  </form>
  <aside class="side-col">
    <div class="panel coin-prev">
      <div class="cp-top"><div class="cp-img" id="pv-img"></div><div><div class="cp-name" id="pv-name">Your coin</div><div class="cp-sym" id="pv-sym">TICKER</div></div></div>
      <div class="cp-repo" id="pv-repo">no repo yet</div>
    </div>
    <div class="panel kv" id="sum">
      <div><span>Trigger</span><b>every commit on the default branch</b></div>
      <div><span>Per commit</span><b>the whole vault buys the coin</b></div>
      <div><span>Bought tokens</span><b>burned, same transaction</b></div>
      <div><span>Creator fees</span><b><span data-cfg-split></span></b></div>
      <div><span>You pay</span><b id="fee-cell">Pons launch fee + gas</b></div>
    </div>
    <p class="note-s">The coin is tied to the repo for good. Maintainers don't need to do anything, and a coin doesn't mean they endorse it.</p>
  </aside>
  <div class="panel done" id="done" hidden></div>
</div></section>
""")

PAGES["coin"] = ("Coin · Commit", """
<section class="band band-tight"><div class="wrap">
  <div id="c-head" class="c-head"><div class="empty">Loading…</div></div>
  <div class="stats-grid" id="c-stats"></div>
  <div class="two">
    <div class="panel"><div class="panel-top"><span class="ptitle">buybacks</span><span class="pill" id="c-wait"></span></div><ol class="feed live-feed" id="c-feed"></ol></div>
    <div class="panel"><div class="panel-top"><span class="ptitle">latest commits on the repo</span><span class="pill" id="c-branch"></span></div><ol class="feed live-feed" id="c-commits"></ol></div>
  </div>
</div></section>
""")

PAGES["coins"] = ("Coins · Commit", """
<section class="phead"><div class="wrap">
  <h1>Coins on <em>Commit.</em></h1>
  <p class="lead">Every coin here is tied to a GitHub repo. When the repo ships, the coin gets bought and burned.</p>
</div></section>
<section class="band band-tight"><div class="wrap">
  <div class="coin-grid" id="coins"><div class="empty">Loading…</div></div>
</div></section>
""")

PAGES["admin"] = ("Admin · Commit", """
<section class="phead"><div class="wrap">
  <h1>Set up <em>Commit.</em></h1>
  <p class="lead">Deploy the contracts from the admin wallet, then sign to save the addresses. Each step is one transaction.</p>
</div></section>
<section class="band band-tight"><div class="wrap admin">
  <div class="panel kv" id="a-status"></div>
  <div class="panel form"><p class="eyebrow">1 · Swap router</p><h3>Buys coins after they graduate</h3>
    <div class="field"><label for="a-router">Router address</label><input id="a-router" placeholder="Filled after deployment"></div>
    <button class="btn btn-main" id="a-deploy-router" type="button">Deploy swap router</button></div>
  <div class="panel form"><p class="eyebrow">2 · Factory</p><h3>One vault per coin</h3>
    <div class="row2"><div class="field"><label for="a-treasury">Treasury (your share)</label><input id="a-treasury"></div><div class="field"><label for="a-keeper">Keeper (buybacks)</label><input id="a-keeper"></div></div>
    <div class="row2"><div class="field"><label for="a-bps">Your share of creator fees (%)</label><input id="a-bps" value="80"></div><div class="field"><label for="a-factory">Factory address</label><input id="a-factory" placeholder="Filled after deployment"></div></div>
    <div class="btn-row"><button class="btn btn-main" id="a-deploy-factory" type="button">Deploy factory</button><button class="btn btn-ghost" id="a-set-router" type="button">Set router on factory</button></div></div>
  <div class="panel form"><p class="eyebrow">3 · Save</p><h3>Publish the configuration</h3><p class="note-s">Signs a message (no transaction). The site and the keeper read these addresses.</p>
    <div class="btn-row"><button class="btn btn-main" id="a-save" type="button">Sign and save</button><button class="btn btn-ghost" id="a-run" type="button">Run the keeper now</button></div></div>
  <div class="panel"><div class="panel-top"><span class="ptitle">log</span></div><pre class="log" id="a-log"></pre></div>
</div></section>
""")

for slug, (title, body) in PAGES.items():
    html = HEAD.format(title=title, page=slug, coins_on=' aria-current="page"' if slug in ("coins", "coin") else "", launch_on=' aria-current="page"' if slug == "launch" else "") + body + FOOT
    open(os.path.join(ROOT, slug + ".html"), "w").write(html)
    print("wrote", slug + ".html")
