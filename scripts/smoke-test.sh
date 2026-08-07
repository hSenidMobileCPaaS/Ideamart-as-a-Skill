#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Ideamart smoke tests
#
# Verifies credentials, IP whitelisting, and every provisioned endpoint.
#
# Usage:
#   cp templates/.env.example .env && $EDITOR .env
#   ./scripts/smoke-test.sh                 # safe tests only
#   ./scripts/smoke-test.sh --with-sms      # also sends a real SMS
#   ./scripts/smoke-test.sh --with-charge   # also charges REAL MONEY
#
# RUN THIS FROM THE SERVER THAT WILL CALL IDEAMART. Running it from a laptop
# tests the laptop's IP, which is not what you whitelisted, and you will get
# E1303 that tells you nothing useful.
#
# Credentials come from the environment. Never paste them into this file.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

[ -f .env ] && set -a && . ./.env && set +a

: "${IDEAMART_APP_ID:?Set IDEAMART_APP_ID (see templates/.env.example)}"
: "${IDEAMART_PASSWORD:?Set IDEAMART_PASSWORD (see templates/.env.example)}"
BASE_URL="${IDEAMART_BASE_URL:-https://api.ideamart.io}"
LBS_URL="${IDEAMART_LBS_URL:-https://api.dialog.lk/lbs/locate}"

# A number in your app's Whitelisted Numbers list.
TEST_MSISDN="${TEST_MSISDN:-94771234567}"

WITH_SMS=false; WITH_CHARGE=false; WITH_LBS=false
for arg in "$@"; do
  case "$arg" in
    --with-sms) WITH_SMS=true ;;
    --with-charge) WITH_CHARGE=true ;;
    --with-lbs) WITH_LBS=true ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[0;33m'; DIM=$'\033[2m'; NC=$'\033[0m'
PASS=0; FAIL=0

# call <name> <url> <json-body>
call() {
  local name="$1" url="$2" body="$3"
  printf '%-28s' "$name"
  local response
  response=$(curl -sS --max-time 20 -X POST "$url" \
    -H 'Content-Type: application/json' \
    --data "$body" 2>&1)

  if [ -z "$response" ]; then
    echo "${RED}NO RESPONSE${NC}  (network, firewall, or TLS chain problem)"
    FAIL=$((FAIL+1)); return
  fi

  local code
  code=$(printf '%s' "$response" | grep -o '"statusCode"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([SE][0-9]*\)"/\1/')

  case "$code" in
    S1000) echo "${GREEN}S1000 OK${NC}"; PASS=$((PASS+1)) ;;
    E1303) echo "${RED}E1303${NC}  This IP is not whitelisted. Run: curl -4 https://myip.ideamart.io"; FAIL=$((FAIL+1)) ;;
    E1313) echo "${RED}E1313${NC}  Auth failure — check IDEAMART_APP_ID / IDEAMART_PASSWORD"; FAIL=$((FAIL+1)) ;;
    E1309) echo "${YELLOW}E1309${NC}  Service not provisioned for this app"; FAIL=$((FAIL+1)) ;;
    E1351) echo "${GREEN}E1351${NC}  Already registered (benign)"; PASS=$((PASS+1)) ;;
    E1356) echo "${GREEN}E1356${NC}  Not registered (benign for unregister)"; PASS=$((PASS+1)) ;;
    "")    echo "${RED}NO statusCode${NC}"; echo "${DIM}  $response${NC}"; FAIL=$((FAIL+1)) ;;
    *)     echo "${RED}${code}${NC}"; echo "${DIM}  $response${NC}"; FAIL=$((FAIL+1)) ;;
  esac
}

creds="\"applicationId\":\"$IDEAMART_APP_ID\",\"password\":\"$IDEAMART_PASSWORD\""

echo
echo "Ideamart smoke test"
echo "  base URL   $BASE_URL"
echo "  app id     $IDEAMART_APP_ID"
echo "  password   ***redacted***"
echo "  egress IP  $(curl -4 -sS --max-time 10 https://myip.ideamart.io 2>/dev/null || echo '(could not determine)')"
echo "             ^ this must be in your app's Allowed Host Addresses"
echo

# ── Connectivity + credentials ──────────────────────────────────────────────
echo "── Subscription ────────────────────────────────"
call "Query Base (base size)" "$BASE_URL/subscription/query-base" \
  "{$creds}"

call "Get Status" "$BASE_URL/subscription/getStatus" \
  "{$creds,\"subscriberId\":\"tel:$TEST_MSISDN\"}"

call "Register (opt-in)" "$BASE_URL/subscription/send" \
  "{$creds,\"version\":\"1.0\",\"action\":\"1\",\"subscriberId\":\"tel:$TEST_MSISDN\"}"

call "Unregister (opt-out)" "$BASE_URL/subscription/send" \
  "{$creds,\"version\":\"1.0\",\"action\":\"0\",\"subscriberId\":\"tel:$TEST_MSISDN\"}"

# ── CaaS ────────────────────────────────────────────────────────────────────
echo
echo "── CaaS ────────────────────────────────────────"
if [ "${IDEAMART_BALANCE_QUERY_ENABLED:-true}" = "true" ]; then
  call "Query Balance" "$BASE_URL/caas/balance/query" \
    "{$creds,\"subscriberId\":\"tel:$TEST_MSISDN\",\"currency\":\"LKR\"}"
else
  printf '%-28s%s\n' "Query Balance" "${DIM}skipped (IDEAMART_BALANCE_QUERY_ENABLED=false)${NC}"
fi

if [ "$WITH_CHARGE" = true ]; then
  echo "${YELLOW}  ⚠  This charges REAL MONEY from $TEST_MSISDN${NC}"
  TRX_ID=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
  echo "${DIM}  externalTrxId: $TRX_ID  (persist this before charging, in real code)${NC}"
  call "Direct Debit (LKR 1)" "$BASE_URL/caas/direct/debit" \
    "{$creds,\"externalTrxId\":\"$TRX_ID\",\"subscriberId\":\"tel:$TEST_MSISDN\",\"amount\":\"1\",\"currency\":\"LKR\"}"
else
  printf '%-28s%s\n' "Direct Debit" "${DIM}skipped (--with-charge to run — charges real money)${NC}"
fi

# ── SMS ─────────────────────────────────────────────────────────────────────
echo
echo "── SMS ─────────────────────────────────────────"
if [ "$WITH_SMS" = true ]; then
  call "SMS Send" "$BASE_URL/sms/send" \
    "{$creds,\"destinationAddresses\":[\"tel:$TEST_MSISDN\"],\"message\":\"Ideamart smoke test\"}"
else
  printf '%-28s%s\n' "SMS Send" "${DIM}skipped (--with-sms to run — sends a real SMS)${NC}"
fi

# ── LBS ─────────────────────────────────────────────────────────────────────
echo
echo "── LBS ─────────────────────────────────────────"
if [ "$WITH_LBS" = true ]; then
  call "Locate" "$LBS_URL" \
    "{$creds,\"subscriberId\":\"tel:$TEST_MSISDN\",\"serviceType\":\"IMMEDIATE\"}"
else
  printf '%-28s%s\n' "Locate" "${DIM}skipped (--with-lbs to run — requires consent)${NC}"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo
echo "───────────────────────────────────────────────"
echo "  ${GREEN}passed ${PASS}${NC}   ${RED}failed ${FAIL}${NC}"
echo
[ "$FAIL" -eq 0 ] || exit 1
