#!/usr/bin/env bash
# Commit — mise en ligne sur Cloudflare (Ubuntu/WSL, ou double-clic sur « Deployer Commit.bat »)
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

command -v node >/dev/null || { echo "Node.js n'est pas installé dans Ubuntu (WSL). Installe-le (nvm ou apt) puis relance."; exit 1; }

if [ ! -d node_modules/wrangler ]; then
  say "Installation des dépendances (une seule fois)…"
  npm install --no-audit --no-fund
fi
WR="npx wrangler"

say "Connexion Cloudflare"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && ! $WR whoami 2>/dev/null | grep -qi "associated with the email\|account id\|logged in"; then
  $WR login
fi
ok "Connecté"

say "Déploiement du Worker"
$WR deploy

CA="$(sed -n 's/^ *CA: *"\(.*\)".*/\1/p' public/config.js | head -1)"
echo
ok "Commit est en ligne : https://commitdot.fun (et https://commit.nael-mrt45.workers.dev)"
echo "   Domaine : enlève le # de la ligne routes dans wrangler.toml (une fois commitdot.fun acheté), puis relance."
if [ -z "$CA" ]; then
  warn "Pas encore de CA : le site affiche « coming soon »."
  echo "   Au lancement : colle la CA dans public/config.js (CA: \"0x…\") puis relance ce .bat."
else
  ok "CA en ligne : $CA"
fi
