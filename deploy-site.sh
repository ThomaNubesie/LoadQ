#!/usr/bin/env bash
# One-command production deploy for the loadq.ca marketing site.
# The Netlify site (comfy-melomakarona-e176a0 / loadq.ca) is a manual-deploy
# site — pushing to GitHub does NOT auto-deploy it on its own. Run this to
# build nothing (static HTML) and publish site/ to production.
#
#   ./deploy-site.sh
#
# Auth: uses $NETLIFY_AUTH_TOKEN if set, else the token saved by `netlify login`
# in the local Netlify CLI config. Never hardcodes the token.
set -euo pipefail
cd "$(dirname "$0")"

SITE_ID="f54300ce-683f-4110-9d05-adc9db177189"   # loadq.ca (comfy-melomakarona-e176a0)

if [ -z "${NETLIFY_AUTH_TOKEN:-}" ]; then
  NETLIFY_AUTH_TOKEN="$(python3 - <<'PY'
import json, os
cfg = os.path.expanduser('~/Library/Preferences/netlify/config.json')
try:
    d = json.load(open(cfg))
    print(next((i['auth']['token'] for i in d.get('users', {}).values()
                if (i.get('auth') or {}).get('token')), ''))
except Exception:
    print('')
PY
)"
fi
if [ -z "$NETLIFY_AUTH_TOKEN" ]; then
  echo "No Netlify token. Run 'netlify login' or set NETLIFY_AUTH_TOKEN." >&2
  exit 1
fi
export NETLIFY_AUTH_TOKEN

echo "Deploying site/ to production (loadq.ca)…"
npx --yes netlify-cli@17 deploy --prod --dir=site --site "$SITE_ID"
