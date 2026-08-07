#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Ideamart smoke tests
#
# Verifies credentials, IP whitelisting, and every endpoint you have configured.
#
# Only the services with a URL set in your environment are tested — an unset
# endpoint means that API is not enabled on your application, so there is
# nothing to test. Configure them in .env; see templates/.env.example.
#
# Usage:
#   cp templates/.env.example .env && $EDITOR .env
#   ./scripts/smoke-test.sh                 # safe tests only
#   ./scripts/smoke-test.sh --with-sms      # also sends a real SMS
#   ./scripts/smoke-test.sh --with-charge   # also charges REAL MONEY
#   ./scripts/smoke-test.sh --with-lbs      # also locates a subscriber
#
# RUN THIS FROM THE SERVER THAT WILL CALL IDEAMART. Running it from a laptop
# tests the laptop's IP, which is not what you whitelisted, and E1303 will tell
# you nothing useful.
#
# Credentials come from the environment. Never paste them into this file.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

[ -f .env ] && set -a && . ./.env && set +a

: "${IDEAMART_APP_ID:?Set IDEAMART_APP_ID (see templates/.env.example)}"
: "${IDEAMART_PASSWORD:?Set IDEAMART_PASSWORD (see templates/.env.example)}"

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
PASS=0; FAIL=0; SKIP=0

skip() { printf '%-28s%s\n' "$1" "${DIM}$2${NC}"; SKIP=$((SKIP+1)); }

# call <name> <url> <json-body>
call() {
  local name="$1" url="$2" body="$3"
  printf '%-28s' "$name"
  local response
  response=$(curl -sS --max-time 20 -X POST "$url" \
    -H 'Content-Type: application/json' --data "$body" 2>&1)

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
    E1309) echo "${YELLOW}E1309${NC}  Service not provisioned — remove this URL from your .env"; FAIL=$((FAIL+1)) ;;
    E1343) echo "${YELLOW}E1343${NC}  $TEST_MSISDN is not in Whitelisted Numbers"; FAIL=$((FAIL+1)) ;;
    E1351) echo "${GREEN}E1351${NC}  Already registered (benign)"; PASS=$((PASS+1)) ;;
    E1356) echo "${GREEN}E1356${NC}  Not registered (benign for unregister)"; PASS=$((PASS+1)) ;;
    "")    echo "${RED}NO statusCode${NC}"; echo "${DIM}  $response${NC}"; FAIL=$((FAIL+1)) ;;
    *)     echo "${RED}${code}${NC}"; echo "${DIM}  $response${NC}"; FAIL=$((FAIL+1)) ;;
  esac
}

creds="\"applicationId\":\"$IDEAMART_APP_ID\",\"password\":\"$IDEAMART_PASSWORD\""

echo
echo "Ideamart smoke test"
echo "  app id     $IDEAMART_APP_ID"
echo "  password   ***redacted***"
echo "  egress IP  $(curl -4 -sS --max-time 10 https://myip.ideamart.io 2>/dev/null || echo '(could not determine)')"
echo "             ^ this must be in your app's Allowed Host Addresses"
echo

# ── Subscription ────────────────────────────────────────────────────────────
echo "── Subscription ────────────────────────────────"
if [ -n "${IDEAMART_SUBSCRIPTION_QUERY_BASE_URL:-}" ]; then
  call "Query Base (base size)" "$IDEAMART_SUBSCRIPTION_QUERY_BASE_URL" "{$creds}"
else
  skip "Query Base (base size)" "IDEAMART_SUBSCRIPTION_QUERY_BASE_URL not set"
fi

if [ -n "${IDEAMART_SUBSCRIPTION_STATUS_URL:-}" ]; then
  call "Get Status" "$IDEAMART_SUBSCRIPTION_STATUS_URL" \
    "{$creds,\"subscriberId\":\"tel:$TEST_MSISDN\"}"
else
  skip "Get Status" "IDEAMART_SUBSCRIPTION_STATUS_URL not set"
fi

if [ -n "${IDEAMART_SUBSCRIPTION_SEND_URL:-}" ]; then
  call "Register (opt-in)" "$IDEAMART_SUBSCRIPTION_SEND_URL" \
    "{$creds,\"version\":\"1.0\",\"action\":\"1\",\"subscriberId\":\"tel:$TEST_MSISDN\"}"
  call "Unregister (opt-out)" "$IDEAMART_SUBSCRIPTION_SEND_URL" \
    "{$creds,\"version\":\"1.0\",\"action\":\"0\",\"subscriberId\":\"tel:$TEST_MSISDN\"}"
else
  skip "Register / Unregister" "IDEAMART_SUBSCRIPTION_SEND_URL not set"
fi

# ── CaaS ────────────────────────────────────────────────────────────────────
echo
echo "── CaaS ────────────────────────────────────────"
if [ -n "${IDEAMART_CAAS_BALANCE_URL:-}" ]; then
  call "Query Balance" "$IDEAMART_CAAS_BALANCE_URL" \
    "{$creds,\"subscriberId\":\"tel:$TEST_MSISDN\",\"currency\":\"LKR\"}"
else
  skip "Query Balance" "IDEAMART_CAAS_BALANCE_URL not set"
fi

if [ -z "${IDEAMART_CAAS_DEBIT_URL:-}" ]; then
  skip "Direct Debit" "IDEAMART_CAAS_DEBIT_URL not set"
elif [ "$WITH_CHARGE" != true ]; then
  skip "Direct Debit" "skipped (--with-charge to run — charges real money)"
else
  echo "${YELLOW}  ⚠  This charges REAL MONEY from $TEST_MSISDN${NC}"
  TRX_ID=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
  echo "${DIM}  externalTrxId: $TRX_ID  (persist this before charging, in real code)${NC}"
  call "Direct Debit (LKR 1)" "$IDEAMART_CAAS_DEBIT_URL" \
    "{$creds,\"externalTrxId\":\"$TRX_ID\",\"subscriberId\":\"tel:$TEST_MSISDN\",\"amount\":\"1\",\"currency\":\"LKR\"}"
fi

# ── SMS ─────────────────────────────────────────────────────────────────────
echo
echo "── SMS ─────────────────────────────────────────"
if [ -z "${IDEAMART_SMS_SEND_URL:-}" ]; then
  skip "SMS Send" "IDEAMART_SMS_SEND_URL not set"
elif [ "$WITH_SMS" != true ]; then
  skip "SMS Send" "skipped (--with-sms to run — sends a real SMS)"
else
  call "SMS Send" "$IDEAMART_SMS_SEND_URL" \
    "{$creds,\"destinationAddresses\":[\"tel:$TEST_MSISDN\"],\"message\":\"Ideamart smoke test\"}"
fi

# ── LBS ─────────────────────────────────────────────────────────────────────
echo
echo "── LBS ─────────────────────────────────────────"
if [ -z "${IDEAMART_LBS_URL:-}" ]; then
  skip "Locate" "IDEAMART_LBS_URL not set"
elif [ "$WITH_LBS" != true ]; then
  skip "Locate" "skipped (--with-lbs to run — requires consent)"
else
  call "Locate" "$IDEAMART_LBS_URL" \
    "{$creds,\"subscriberId\":\"tel:$TEST_MSISDN\",\"serviceType\":\"IMMEDIATE\"}"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo
echo "───────────────────────────────────────────────"
echo "  ${GREEN}passed ${PASS}${NC}   ${RED}failed ${FAIL}${NC}   ${DIM}skipped ${SKIP}${NC}"
if [ "$PASS" -eq 0 ] && [ "$FAIL" -eq 0 ]; then
  echo "  ${YELLOW}Nothing ran — no service endpoints are configured in .env.${NC}"
fi
echo
[ "$FAIL" -eq 0 ] || exit 1
