#!/usr/bin/env bash
set -uo pipefail

PASS=0
FAIL=0
SKIP=0

check() {
  local name="$1"
  local cmd="$2"
  printf "  %-45s" "$name"
  if result=$(eval "$cmd" 2>&1); then
    echo "[PASS]"
    PASS=$((PASS + 1))
  else
    echo "[FAIL]"
    echo "    -> $result"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Integration Validation ==="
echo ""

# Engine health
check "Engine /health responds" \
  "curl -sf http://localhost:3001/health | grep -q 'ok\|status\|healthy'"

# Watchdog alive
check "Watchdog /watchdog-alive responds" \
  "curl -sf http://localhost:3002/watchdog-alive | grep -q 'ok\|alive\|status'"

# Dashboard loads
check "Dashboard returns HTML" \
  "curl -sf http://localhost:3000 | grep -q '<'"

# DynamoDB tables
check "DynamoDB trading-state table exists" \
  "aws dynamodb describe-table --table-name trading-state --endpoint-url http://localhost:8000 --region us-east-1 > /dev/null 2>&1"

check "DynamoDB trading-config table exists" \
  "aws dynamodb describe-table --table-name trading-config --endpoint-url http://localhost:8000 --region us-east-1 > /dev/null 2>&1"

check "DynamoDB trading-history table exists" \
  "aws dynamodb describe-table --table-name trading-history --endpoint-url http://localhost:8000 --region us-east-1 > /dev/null 2>&1"

echo ""
echo "=== Summary ==="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "Some checks failed. Review output above."
  exit 1
else
  echo "All checks passed."
  exit 0
fi
