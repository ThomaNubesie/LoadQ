#!/usr/bin/env bash
# One-command production deploy for the LoadQ admin console (admin.loadq.ca).
# The Netlify site (loadq-admin) is NOT connected to GitHub, so pushes do not
# auto-deploy — run this to build admin-web and publish to production.
#
#   ./deploy-admin-web.sh
#
# Auth: uses $NETLIFY_AUTH_TOKEN if set, else the token saved by `netlify login`
# in the local Netlify CLI config. Never hardcodes the token.
set -euo pipefail
cd "$(dirname "$0")"

SITE_ID="74c65dc0-8ee8-4884-a688-eb42d5eb3ea5"   # loadq-admin

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

echo "Building + deploying admin-web to production (admin.loadq.ca)…"
npx --yes netlify-cli@17 deploy --prod --build --site "$SITE_ID"
