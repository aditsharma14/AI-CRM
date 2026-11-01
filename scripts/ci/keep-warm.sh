#!/usr/bin/env bash
# The keep-warm workflow's logic (docs/deploy.md, section 10): one ping keeps the free-tier API from sleeping, and if
# the API now reports main's head (GITHUB_SHA) and no deploy-smoke run exists for it yet, the smoke test is dispatched.
# Always exits 0: Render deploys only after every check on a commit passes, and a ping must never be the one that fails.
set -uo pipefail

: "${PROD_URL:?PROD_URL is not set}"

deployed=$(curl -sS --max-time 150 -H 'Accept: application/json' "$PROD_URL/api/v1/health" 2>/dev/null |
  node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{try{process.stdout.write(JSON.parse(s).data.commit??"")}catch{}})')
echo "API reports ${deployed:-nothing} (main is at ${GITHUB_SHA:-?})"

if [ -n "$deployed" ] && [ "$deployed" = "${GITHUB_SHA:-}" ]; then
  runs=$(gh run list --workflow deploy-smoke.yml --commit "$GITHUB_SHA" --json databaseId --jq length 2>/dev/null || echo error)
  if [ "$runs" = "0" ]; then
    gh workflow run deploy-smoke.yml --ref main && echo "dispatched deploy-smoke for ${GITHUB_SHA:0:7}"
  else
    echo "deploy-smoke already ran for ${GITHUB_SHA:0:7} (or the lookup failed: $runs)"
  fi
fi
exit 0
