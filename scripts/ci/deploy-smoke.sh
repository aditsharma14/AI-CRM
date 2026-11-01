#!/usr/bin/env bash
# The deploy-smoke workflow's logic (docs/deploy.md, section 10), runnable locally:
#   PROD_URL=https://nimbus-crm.vercel.app GITHUB_SHA=$(git rev-parse HEAD) bash scripts/ci/deploy-smoke.sh
# Runs scripts/smoke.mjs only if the API reports GITHUB_SHA as deployed. Otherwise it passes with a notice, so it can
# never block a Render deploy that waits for CI checks, and fails only when that commit is over STALE_AFTER_S old and
# still isn't live (a deploy that never happened).
set -euo pipefail

: "${PROD_URL:?PROD_URL is not set}"
: "${GITHUB_SHA:?GITHUB_SHA is not set}"
STALE_AFTER_S=${STALE_AFTER_S:-1200}
WAKE_BUDGET_S=${WAKE_BUDGET_S:-150}

# The deployed commit, waiting out a cold start (the API sleeps 23:00–08:00 IST).
deployed=""
deadline=$(($(date +%s) + WAKE_BUDGET_S))
while :; do
  deployed=$(curl -sS --max-time 30 -H 'Accept: application/json' "$PROD_URL/api/v1/health" 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{try{process.stdout.write(JSON.parse(s).data.commit??"")}catch{}})' ||
    true)
  [ -n "$deployed" ] || [ "$(date +%s)" -ge "$deadline" ] && break
  sleep 5
done
echo "API reports ${deployed:-nothing}; this run is for $GITHUB_SHA"

if [ "$deployed" = "$GITHUB_SHA" ]; then
  node scripts/smoke.mjs "$PROD_URL"
  exit 0
fi

age=$(($(date +%s) - $(git log -1 --format=%ct "$GITHUB_SHA")))
if [ "$age" -gt "$STALE_AFTER_S" ]; then
  echo "::error::${GITHUB_SHA:0:7} is $((age / 60)) min old and still isn't live (the API reports ${deployed:-nothing}). The deploy failed, CI failed, or auto-deploy is off."
  exit 1
fi
echo "::notice::${GITHUB_SHA:0:7} isn't live yet ($((age / 60)) min old). keep-warm starts the smoke test once it is."
