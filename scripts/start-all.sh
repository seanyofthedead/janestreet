#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== Jane Street Trading System — Development Startup ==="
echo ""

# --- 1. Check / Start DynamoDB Local ---
echo "[1/4] Checking DynamoDB Local..."
if docker ps --format '{{.Names}}' | grep -q 'janestreet-dynamodb'; then
  echo "  DynamoDB Local is already running."
else
  echo "  Starting DynamoDB Local via Docker..."
  docker compose up -d dynamodb-local
  echo "  Waiting for DynamoDB Local to be ready..."
  sleep 3
fi

# --- 2. Create DynamoDB tables ---
echo ""
echo "[2/4] Setting up DynamoDB tables..."
npx tsx scripts/setup-tables.ts
echo "  Tables ready."

# --- 3. Load environment ---
echo ""
echo "[3/4] Checking environment..."
if [ ! -f .env ]; then
  echo "  WARNING: .env file not found. Copy .env.example to .env and fill in your keys."
  echo "  Continuing with defaults..."
fi

# --- 4. Start services via PM2 ---
echo ""
echo "[4/4] Starting services via PM2..."
npx pm2 start ecosystem.config.js
echo ""
npx pm2 status

echo ""
echo "=== All services started ==="
echo "  Engine:    http://localhost:3001"
echo "  Watchdog:  http://localhost:3002"
echo "  Dashboard: http://localhost:3000"
echo ""
echo "Useful commands:"
echo "  npx pm2 logs          — view all logs"
echo "  npx pm2 logs engine   — view engine logs"
echo "  npx pm2 stop all      — stop all services"
echo "  npx pm2 restart all   — restart all services"
echo "  npx pm2 delete all    — remove all from PM2"
