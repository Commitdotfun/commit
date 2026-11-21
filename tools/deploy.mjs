// Deployer Commit — run by "Deployer Commit.bat" inside WSL. No npm install needed.
// Writes everything it prints to deploy-log.txt as well.
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import readline from "readline";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const TOML = join(root, "wrangler.toml"), LOG = join(root, "deploy-log.txt");
writeFileSync(LOG, `Deployer Commit — ${new Date().toISOString()}\n`);
const say = (m = "") => { console.log(m); appendFileSync(LOG, m + "\n"); };
const ask = (q, hidden = false) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = (s) => rl.output.write(s.includes(q) ? s : s.replace(/[^\r\n]/g, "*"));
  rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); res(a.trim()); });
});
const wr = (args, { capture = false, input } = {}) => {
  const env = capture || input !== undefined ? { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" } : process.env;
  const r = spawnSync("npx", ["--yes", "wrangler@4", ...args], { stdio: [input !== undefined ? "pipe" : "inherit", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"], encoding: "utf8", env, input });
  const out = (r.stdout || "") + (r.stderr || "");
  if (capture) appendFileSync(LOG, out.replace(/[0-9a-fA-F]{64}/g, "…").replace(/(github_pat_|ghp_)\w+/g, "…") + "\n");
  return { code: r.status, out };
};
const fail = (m) => { say("\n✗ " + m); say("Copie-colle deploy-log.txt (dossier commit) à Claude."); process.exit(1); };
const yes = (a) => ["o", "oui", "y", "yes"].includes(a.toLowerCase());

say("════════════════════════════════════════════");
say("  COMMIT · déploiement sur Cloudflare");
say("════════════════════════════════════════════\n");
if (+process.versions.node.split(".")[0] < 18) fail(`Node ${process.versions.node} est trop ancien dans WSL (il faut 18 ou plus).`);
if (!existsSync(join(root, "dist/worker.js"))) fail("dist/worker.js est introuvable : le dossier commit est incomplet.");

say("1/6 Connexion Cloudflare…");
const who = wr(["whoami"], { capture: true });
if (!/associated with the email|logged in/i.test(who.out)) {
  say("   Pas connecté : une page Cloudflare va s'ouvrir pour te connecter.");
  if (wr(["login"]).code !== 0) fail("Connexion Cloudflare impossible.");
}
say("   ✓ connecté\n");

let toml = readFileSync(TOML, "utf8");
say("2/6 Stockage (KV)…");
if (toml.includes('id = "COMMIT_KV_ID"')) {
  const find = () => { const l = wr(["kv", "namespace", "list"], { capture: true }); try { const arr = JSON.parse(l.out.slice(l.out.indexOf("["), l.out.lastIndexOf("]") + 1)); return arr.find(n => /(^|-)commit-data$/.test(n.title))?.id || null; } catch { return null; } };
  let id = find();
  if (!id) { const c = wr(["kv", "namespace", "create", "commit-data"], { capture: true }); id = (/[0-9a-f]{32}/.exec(c.out) || [])[0] || find(); }
  if (!id) fail("Impossible de créer le stockage KV.");
  toml = toml.replace('id = "COMMIT_KV_ID"', `id = "${id}"`);
  writeFileSync(TOML, toml);
}
say("   ✓ prêt\n");

say("3/6 Déploiement (1 à 2 minutes)…");
const d = wr(["deploy"], { capture: true });
console.log(d.out.split("\n").filter(l => l.trim()).slice(-12).join("\n"));
if (d.code !== 0) fail("Le déploiement a échoué (voir ci-dessus).");
say("   ✓ en ligne : https://commitdot.fun\n");

say("4/6 RPC privé…");
let rpc = "";
for (const f of [join(root, ".env"), join(root, "../summon/.env"), join(root, "../sweep/.env")]) if (!rpc && existsSync(f)) rpc = (/^RPC_URL=(.+)$/m.exec(readFileSync(f, "utf8")) || [])[1]?.trim() || "";
if (existsSync(join(root, ".rpc-set"))) say("   ✓ déjà réglé");
else if (rpc) { const r = wr(["secret", "put", "RPC_URL"], { capture: true, input: rpc }); if (r.code === 0) { writeFileSync(join(root, ".rpc-set"), "1"); say("   ✓ RPC_URL réglé (copié depuis summon/.env)"); } else say("   ⚠️  RPC_URL non réglé"); }
else say("   ⚠️  Aucun RPC_URL trouvé (summon/.env) : l'enregistrement des lancements peut échouer.");

say("\n5/6 Keeper et GitHub…");
const keyDone = existsSync(join(root, ".keeper-set")), ghDone = existsSync(join(root, ".github-set"));
if (!keyDone || yes(await ask("   Remplacer la clé du keeper ? (o/N) : "))) {
  say("   Clé privée du wallet keeper/dev (0xBdAa…b1Fb). Elle reste dans Cloudflare, jamais sur le site.");
  const key = await ask("   Clé privée (elle ne s'affiche pas, Entrée pour passer) : ", true);
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(key)) { const r = wr(["secret", "put", "KEEPER_KEY"], { capture: true, input: key }); if (r.code === 0) { writeFileSync(join(root, ".keeper-set"), "1"); say("   ✓ keeper activé"); } else say("   ⚠️  la clé n'a pas pu être enregistrée"); }
  else say("   Pas de clé : relance ce .bat plus tard pour activer le keeper.");
} else say("   ✓ keeper déjà réglé");
if (!ghDone || yes(await ask("   Remplacer le token GitHub ? (o/N) : "))) {
  say("   Token GitHub (fine-grained, lecture des repos publics) pour suivre les commits.");
  const tok = await ask("   Token GitHub (il ne s'affiche pas, Entrée pour passer) : ", true);
  if (/^(github_pat_|ghp_)\w{20,}$/.test(tok)) { const r = wr(["secret", "put", "GITHUB_TOKEN"], { capture: true, input: tok }); if (r.code === 0) { writeFileSync(join(root, ".github-set"), "1"); say("   ✓ token GitHub réglé"); } else say("   ⚠️  le token n'a pas pu être enregistré"); }
  else say("   Pas de token : relance ce .bat plus tard pour l'ajouter.");
} else say("   ✓ token GitHub déjà réglé");

// 6. Publish the code on github.com/commitdotfun/commit: each deploy with changes = 1 real commit = 1 buyback
say("\n6/6 Code sur GitHub (commitdotfun/commit)…");
const git = (args, opts = {}) => spawnSync("git", ["-c", "user.name=commitdotfun", "-c", "user.email=commitdotfun@users.noreply.github.com", ...args], { encoding: "utf8", ...opts });
const TOKF = join(root, ".deploy-token");
if (git(["--version"]).status !== 0) say("   ⚠️  git n'est pas installé dans Ubuntu (sudo apt install git), code non publié.");
else {
  let tok = existsSync(TOKF) ? readFileSync(TOKF, "utf8").trim() : "";
  if (!tok) {
    say("   Token GitHub d'ÉCRITURE (commit-deploy, Contents: Read and write sur commitdotfun/commit).");
    tok = await ask("   Token (il ne s'affiche pas, Entrée pour passer) : ", true);
    if (/^(github_pat_|ghp_)\w{20,}$/.test(tok)) writeFileSync(TOKF, tok, { mode: 0o600 }); else tok = "";
  }
  if (!tok) say("   Pas de token d'écriture : le code n'est pas publié (relance le .bat pour l'ajouter).");
  else {
    const url = `https://commitdotfun:${tok}@github.com/commitdotfun/commit.git`;
    if (!existsSync(join(root, ".git"))) {
      git(["init", "-q", "-b", "main"]);
      git(["config", "core.fileMode", "false"]);
      const f = git(["fetch", "-q", url, "main"]);
      if (f.status === 0) { git(["reset", "-q", "FETCH_HEAD"]); git(["checkout", "-q", "FETCH_HEAD", "--", "."]); }
    }
    git(["add", "-A"]);
    const changed = (git(["status", "--porcelain"]).stdout || "").trim();
    const MSGF = join(root, ".commit-msg");
    let msg = "";
    if (changed) {
      msg = existsSync(MSGF) ? readFileSync(MSGF, "utf8").trim() : "";
      if (!msg) msg = (await ask("   Message du commit (Entrée = « update site ») : ")) || "update site";
      git(["commit", "-q", "-m", msg]);
    }
    // push every local commit not on GitHub yet (also the ones a failed run left behind)
    const p = git(["push", url, "HEAD:main"]);
    const out = ((p.stdout || "") + (p.stderr || "")).replaceAll(tok, "…");
    appendFileSync(LOG, out + "\n");
    if (p.status === 0) {
      say(changed || /->/.test(out) ? `   ✓ code publié sur GitHub${msg ? " : « " + msg + " »" : ""} → rachat + burn au prochain passage du keeper` : "   ✓ rien de nouveau depuis le dernier envoi (pas de commit)");
      try { writeFileSync(MSGF, ""); } catch {}
    } else {
      say("   ⚠️  envoi sur GitHub refusé : " + out.split("\n").filter(Boolean).slice(-2).join(" "));
      if (/403|denied|Authentication failed|401/i.test(out)) {
        writeFileSync(TOKF, "");
        say("   Le token n'a pas le droit d'écrire sur commitdotfun/commit (Contents: Read and write). Il te sera redemandé au prochain lancement.");
      }
    }
  }
}

say("\n════════════════════════════════════════════");
say("  ✓ Commit est en ligne : https://commitdot.fun");
say("  Étape suivante : ouvre https://commitdot.fun/admin avec le wallet 0xBdAa…b1Fb");
say("════════════════════════════════════════════");
