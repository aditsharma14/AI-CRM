#!/usr/bin/env bash
# Smoke test for the running compose stack (CI docker job; also runnable locally after `docker compose up -d`).
# Proves: the API is healthy, mongo is a PRIMARY replica-set member, nginx proxies /api, and a lead
# conversion (which runs in a transaction) works end to end.
set -euo pipefail

API=${API:-http://localhost:5000}
CLIENT=${CLIENT:-http://localhost:8080}

echo "== waiting for $API/health"
for _ in $(seq 1 60); do
  if curl -fsS "$API/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "$API/health"
echo

echo "== replica set"
state=$(docker compose exec -T mongo mongosh --quiet --eval 'rs.status().members[0].stateStr')
echo "member 0: $state"
[ "$state" = "PRIMARY" ] || { echo "expected PRIMARY"; exit 1; }

echo "== nginx proxies /api to the API"
proxied=$(curl -sS "$CLIENT/api/v1/nope" | jq -r '.error.code')
echo "GET $CLIENT/api/v1/nope -> $proxied"
[ "$proxied" = "NOT_FOUND" ] || { echo "expected the API's NOT_FOUND envelope through nginx"; exit 1; }

json() { curl -fsS -H 'content-type: application/json' "$@"; }

echo "== register an org"
email="ci.$(date +%s).$RANDOM@smoke.test"
token=$(json -X POST "$API/api/v1/auth/register-org" \
  -d "{\"orgName\":\"Smoke Org\",\"name\":\"Smoke\",\"email\":\"$email\",\"password\":\"password123\"}" |
  jq -r '.data.accessToken')
[ -n "$token" ] && [ "$token" != "null" ] || { echo "no access token"; exit 1; }
auth=(-H "authorization: Bearer $token")

echo "== create a lead"
lead=$(json "${auth[@]}" -X POST "$API/api/v1/leads" -d '{"name":"Smoke lead"}' | jq -r '.data._id')
echo "lead $lead"

echo "== convert it (a transaction)"
response=$(curl -sS -w '\n%{http_code}' -H 'content-type: application/json' "${auth[@]}" \
  -X POST "$API/api/v1/leads/$lead/convert" -d '{}')
status=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')
echo "POST /leads/$lead/convert -> $status"
[ "$status" = "201" ] || { echo "$body"; exit 1; }
deal=$(echo "$body" | jq -r '.data._id')

fromLead=$(json "${auth[@]}" "$API/api/v1/deals/$deal" | jq -r '.data.convertedFromLeadId')
leadStatus=$(json "${auth[@]}" "$API/api/v1/leads/$lead" | jq -r '.data.status')
echo "deal $deal convertedFromLeadId=$fromLead; lead status=$leadStatus"
[ "$fromLead" = "$lead" ] && [ "$leadStatus" = "converted" ] || { echo "conversion not recorded"; exit 1; }

echo "== smoke test passed"
