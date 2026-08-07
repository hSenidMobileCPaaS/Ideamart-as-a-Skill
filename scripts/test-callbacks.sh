#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Ideamart callback handler tests
#
# Posts real Ideamart callback payloads at your own endpoints. No Ideamart
# account or connectivity needed — the payloads are fully specified, so you can
# build and test the inbound half of the integration before provisioning.
#
# Usage:
#   ./scripts/test-callbacks.sh [base-url]
#   ./scripts/test-callbacks.sh http://localhost:3000
#
# Every handler must answer HTTP 200 with:
#   {"statusCode":"S1000","statusDetail":"Success"}
# ...including for malformed and wrong-app payloads.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

BASE="${1:-http://localhost:3000}"
APP_ID="${IDEAMART_APP_ID:-APP_000001}"

GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; DIM=$'\033[2m'; NC=$'\033[0m'
PASS=0; FAIL=0

# check <name> <path> <body>
check() {
  local name="$1" path="$2" body="$3"
  printf '%-40s' "$name"
  local out status response
  out=$(curl -sS --max-time 10 -w '\n%{http_code}' -X POST "$BASE$path" \
    -H 'Content-Type: application/json' --data "$body" 2>&1)
  status=$(printf '%s' "$out" | tail -1)
  response=$(printf '%s' "$out" | sed '$d')

  if [ "$status" != "200" ]; then
    echo "${RED}HTTP $status${NC}  (must always be 200 — a non-2xx triggers redelivery)"
    FAIL=$((FAIL+1)); return
  fi
  if printf '%s' "$response" | grep -q '"S1000"'; then
    echo "${GREEN}200 S1000${NC}"; PASS=$((PASS+1))
  else
    echo "${RED}200 but no S1000${NC}"; echo "${DIM}  $response${NC}"; FAIL=$((FAIL+1))
  fi
}

echo
echo "Callback tests against $BASE"
echo

echo "── Valid payloads ──────────────────────────────────────"

check "MO SMS" /api/ideamart/sms/mo \
  "{\"message\":\"my testing message\",\"sourceAddress\":\"tel:94771234567\",\"requestId\":\"APP_000001\",\"encoding\":\"0\",\"version\":\"1.0\",\"applicationId\":\"$APP_ID\"}"

check "Delivery report (DELIVERED)" /api/ideamart/sms/dlr \
  '{"destinationAddress":"tel:94771234567","timeStamp":"20120113082110","requestId":"MSG_000111","deliveryStatus":"DELIVERED"}'

check "Delivery report (SMPP spelling)" /api/ideamart/sms/dlr \
  '{"destinationAddress":"tel:94771234567","timeStamp":"1201130821","requestId":"MSG_000112","deliveryStatus":"DELIVRD"}'

check "USSD mo-init" /api/ideamart/ussd \
  "{\"message\":\"*141#\",\"ussdOperation\":\"mo-init\",\"requestId\":\"1330933229901\",\"sessionId\":\"1330929317043\",\"encoding\":\"440\",\"sourceAddress\":\"tel:94771234567\",\"applicationId\":\"$APP_ID\",\"version\":\"1.0\"}"

check "USSD mo-cont" /api/ideamart/ussd \
  "{\"message\":\"1\",\"ussdOperation\":\"mo-cont\",\"requestId\":\"1330933229902\",\"sessionId\":\"1330929317043\",\"encoding\":\"440\",\"sourceAddress\":\"tel:94771234567\",\"applicationId\":\"$APP_ID\",\"version\":\"1.0\"}"

check "Subscription REGISTERED" /api/ideamart/subscription/notification \
  "{\"applicationId\":\"$APP_ID\",\"frequency\":\"Monthly\",\"status\":\"REGISTERED\",\"subscriberId\":\"tel:94771234567\",\"version\":\"1.0\",\"timeStamp\":\"20130402025896\"}"

check "Subscription UNREGISTERED" /api/ideamart/subscription/notification \
  "{\"applicationId\":\"$APP_ID\",\"frequency\":\"Monthly\",\"status\":\"UNREGISTERED\",\"subscriberId\":\"tel:94771234567\",\"version\":\"1.0\",\"timeStamp\":\"20130402025897\"}"

check "Charging notification" /api/ideamart/charging/notification \
  "{\"applicationId\":\"$APP_ID\",\"externalTrxId\":\"abc123\",\"internalTrxId\":\"321\",\"subscriberId\":\"tel:94771234567\",\"amount\":\"6\",\"currency\":\"LKR\",\"statusCode\":\"S1000\",\"statusDetail\":\"Success\",\"timeStamp\":\"2012-07-30T12:48:10-0400\"}"

echo
echo "── Hostile payloads (must still return 200 S1000) ───────"

check "Malformed JSON" /api/ideamart/ussd \
  '{not valid json'

check "Empty body" /api/ideamart/sms/mo \
  ''

check "Wrong applicationId" /api/ideamart/sms/mo \
  '{"message":"x","sourceAddress":"tel:94771234567","requestId":"r1","encoding":"0","version":"1.0","applicationId":"APP_999999"}'

check "Missing required fields" /api/ideamart/ussd \
  '{"applicationId":"'"$APP_ID"'"}'

check "Oversized message" /api/ideamart/sms/mo \
  "{\"message\":\"$(printf 'A%.0s' {1..5000})\",\"sourceAddress\":\"tel:94771234567\",\"requestId\":\"r2\",\"encoding\":\"0\",\"version\":\"1.0\",\"applicationId\":\"$APP_ID\"}"

echo
echo "── Idempotency (the test people skip) ───────────────────"
echo "${DIM}  Same payload twice. Both must return 200 S1000, and your handler${NC}"
echo "${DIM}  must process it ONCE. Verify in your logs / database.${NC}"

DUP="{\"applicationId\":\"$APP_ID\",\"externalTrxId\":\"dup-test-001\",\"internalTrxId\":\"999\",\"statusCode\":\"S1000\",\"statusDetail\":\"Success\"}"
check "Charging notification (1st)" /api/ideamart/charging/notification "$DUP"
check "Charging notification (2nd)" /api/ideamart/charging/notification "$DUP"

echo
echo "────────────────────────────────────────────────────────"
echo "  ${GREEN}passed ${PASS}${NC}   ${RED}failed ${FAIL}${NC}"
echo
[ "$FAIL" -eq 0 ] || exit 1
