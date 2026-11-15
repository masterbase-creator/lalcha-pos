#!/bin/sh
# Puts this folder's code on the server, then proves the site is healthy. If the API doesn't come
# back up, the previous version is restored automatically.
#
#   ops/deploy.sh               check, deploy, health check
#   ops/deploy.sh --skip-checks deploy without running typecheck and tests first
#
# Where to deploy comes from ops/deploy.env (not kept in git; see ops/deploy.env.example):
#   LALCHA_HOST=root@your-server   LALCHA_SSH_KEY=~/.ssh/your_key   LALCHA_DOMAIN=lalcha.com
set -eu
cd "$(dirname "$0")/.."
[ -f ops/deploy.env ] && . ops/deploy.env
: "${LALCHA_HOST:?Set LALCHA_HOST in ops/deploy.env (see ops/deploy.env.example)}"
DOMAIN="${LALCHA_DOMAIN:-lalcha.com}"
KEY="${LALCHA_SSH_KEY:-}"
SSH="ssh -o ConnectTimeout=15 ${KEY:+-i $KEY}"
say() { printf '\n== %s\n' "$1"; }

if [ "${1:-}" != "--skip-checks" ]; then
  say "Checking the code before it leaves this computer"
  pnpm typecheck
  pnpm test
fi

say "Copying files"
rsync -az --delete -e "$SSH" \
  --exclude node_modules --exclude dist --exclude .git --exclude '.env*' --exclude ops/deploy.env \
  --exclude apps/api/public/products --exclude apps/api/public/products.local-copy \
  ./ "$LALCHA_HOST:/srv/lalcha/incoming/"

say "Building and switching over on the server"
$SSH "$LALCHA_HOST" DOMAIN="$DOMAIN" sh -s <<'REMOTE'
set -eu
APP=/srv/lalcha/app
PREV=/srv/lalcha/previous
export PATH=/opt/node/bin:$PATH
healthy() { for i in $(seq 1 30); do curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:8787/health && return 0; sleep 1; done; return 1; }

# Keep the running version, so a bad deploy can be undone in seconds.
rsync -a --delete --exclude node_modules --exclude apps/api/public/products --exclude apps/api/public/products.local-copy "$APP/" "$PREV/"
rsync -a --delete --exclude node_modules --exclude dist --exclude apps/api/public/products --exclude apps/api/public/products.local-copy /srv/lalcha/incoming/ "$APP/"
install -d -o lalcha -g lalcha "$APP/apps/api/public/products"
chown -R lalcha:lalcha "$APP"

build() {
  runuser -u lalcha -- sh -c "cd $APP && export PATH=/opt/node/bin:\$PATH && pnpm install --frozen-lockfile && pnpm --filter @lalcha/pos build && pnpm --filter @lalcha/web build"
}
rollback() {
  echo "!! $1. Putting the previous version back."
  rsync -a --delete --exclude node_modules --exclude apps/api/public/products --exclude apps/api/public/products.local-copy "$PREV/" "$APP/"
  chown -R lalcha:lalcha "$APP"
  runuser -u lalcha -- sh -c "cd $APP && export PATH=/opt/node/bin:\$PATH && pnpm install --frozen-lockfile" || true
  systemctl restart lalcha-api
  healthy && echo "The previous version is running again." || echo "!! The previous version is not answering either. Look at: journalctl -u lalcha-api -n 50"
  exit 1
}
build || rollback "The build failed"

# Server scripts, schedules and the web server's settings travel with the code.
install -m 755 "$APP/ops/lalcha-watch" "$APP/ops/lalcha-maint" "$APP/ops/lalcha-db" /usr/local/bin/
install -m 644 "$APP/ops/lalcha.cron" /etc/cron.d/lalcha
rm -f /etc/cron.d/lalcha-demo /etc/cron.d/lalcha-maint
install -d /etc/nginx/snippets
for ip in $(hostname -I); do echo "$ip 1;"; done > /etc/nginx/snippets/lalcha-own-ips.conf
cp -a /etc/nginx/sites-available/lalcha /etc/nginx/lalcha.conf.before 2>/dev/null || true
for f in lalcha-cloudflare lalcha-proxy lalcha-site-headers lalcha-store-headers; do install -m 644 "$APP/ops/nginx/$f.conf" /etc/nginx/snippets/; done
sed "s/lalcha\.com/$DOMAIN/g" "$APP/ops/nginx/lalcha.conf" > /etc/nginx/sites-available/lalcha
if nginx -t 2>/dev/null; then systemctl reload nginx
else
  echo "!! The new web server settings don't pass nginx's own check; keeping the old ones."
  nginx -t || true
  cp -a /etc/nginx/lalcha.conf.before /etc/nginx/sites-available/lalcha
  nginx -t && systemctl reload nginx
fi

/usr/local/bin/lalcha-db migrate || rollback "The database update failed"
systemctl restart lalcha-api
healthy || rollback "The API did not come back up"
echo "API is up: $(curl -fsS http://127.0.0.1:8787/health)"
REMOTE

say "Health check from outside, through Cloudflare"
fail=0
check() { # what, url, text the reply must contain
  if out=$(curl -fsS --max-time 30 "$2" 2>&1) && printf '%s' "$out" | grep -q "$3"; then echo "  ok   $1"; else echo "  FAIL $1 ($2)"; fail=1; fi
}
check "website"            "https://$DOMAIN/"                                    "Lalcha"
check "API"                "https://$DOMAIN/health"                              '"ok":true'
check "signup address check" "https://$DOMAIN/v1/public/subdomain?name=demo"     '"available":false'
check "demo store"         "https://demo.$DOMAIN/v1/demo"                        '"demo":true'
check "till app"           "https://demo.$DOMAIN/"                               "<div id=\"root\">"
check "onboarding guide"   "https://$DOMAIN/guide/lalcha-pos-guide-bn.pdf"       "%PDF"
[ $fail -eq 0 ] || { echo; echo "Deployed, but something above does not answer. The server kept the new version; check it now."; exit 1; }

say "Outsider security checks against the live site"
E2E_SCHEME=https E2E_DOMAIN="$DOMAIN" node tests/e2e/security.mjs

say "Deployed and healthy: https://$DOMAIN"
