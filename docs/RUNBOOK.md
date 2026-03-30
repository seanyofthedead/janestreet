# Operational Runbook

## Pre-flight Checklist

Before starting the trading system, verify:

- [ ] `.env` file exists with valid Alpaca paper trading API keys
- [ ] Docker is installed and running (for DynamoDB Local)
- [ ] Node.js 20+ is installed
- [ ] `npm install` has been run at the project root
- [ ] Market hours are known (US equities: 9:30 AM - 4:00 PM ET, Mon-Fri)

## Start / Stop Procedures

### Development (PM2)

**Start all services:**

```bash
bash scripts/start-all.sh
```

This will:
1. Start DynamoDB Local if not already running
2. Create required DynamoDB tables
3. Launch engine, watchdog, and dashboard via PM2

**Stop all services:**

```bash
npx pm2 stop all
```

**Restart a single service:**

```bash
npx pm2 restart engine
npx pm2 restart watchdog
npx pm2 restart dashboard
```

**Remove all from PM2:**

```bash
npx pm2 delete all
docker compose down   # stops DynamoDB Local
```

**View logs:**

```bash
npx pm2 logs              # all services
npx pm2 logs engine       # engine only
npx pm2 logs --lines 100  # last 100 lines
```

### Production-like (Docker Compose)

**Start:**

```bash
docker compose up -d
npx tsx scripts/setup-tables.ts
```

**Stop:**

```bash
docker compose down
```

**Rebuild after code changes:**

```bash
docker compose up -d --build
```

**View logs:**

```bash
docker compose logs -f
docker compose logs -f engine
```

## Validate Services

Run the integration validation script:

```bash
bash scripts/validate-integration.sh
```

Expected output: all checks pass for engine health, watchdog alive, dashboard HTML, and DynamoDB tables.

## Kill Switch Activation

The kill switch immediately halts all trading activity.

**Activate:**

```bash
# Via watchdog API
curl -X POST http://localhost:3002/kill-switch/activate

# Or set in DynamoDB directly
aws dynamodb put-item \
  --table-name trading-config \
  --item '{"key": {"S": "kill-switch"}, "active": {"BOOL": true}, "activatedAt": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}}' \
  --endpoint-url http://localhost:8000 \
  --region us-east-1
```

**What happens when activated:**
- Engine stops placing new orders
- Existing open orders are cancelled
- No new positions are opened
- Watchdog continues monitoring

**Recovery:**

1. Identify and resolve the root cause
2. Check open positions and orders in Alpaca dashboard
3. Deactivate the kill switch:

```bash
curl -X POST http://localhost:3002/kill-switch/deactivate
```

4. Monitor the first few trades closely after reactivation

## Common Failure Modes

### WebSocket Disconnect

**Symptoms:** Engine logs show WebSocket errors, no market data updates.

**Resolution:**
1. Check internet connectivity
2. Verify Alpaca API status at https://status.alpaca.markets
3. Engine should auto-reconnect — check logs for reconnection attempts
4. If stuck, restart the engine: `npx pm2 restart engine`

### Engine Crash Loop

**Symptoms:** PM2 shows engine restarting repeatedly.

**Resolution:**
1. Check logs: `npx pm2 logs engine --lines 200`
2. Common causes:
   - Invalid API keys in `.env`
   - DynamoDB Local not running
   - Port 3001 already in use
3. Fix the root cause, then: `npx pm2 restart engine`

### Stale Positions

**Symptoms:** Dashboard shows positions that no longer exist in Alpaca, or quantities are wrong.

**Resolution:**
1. Check actual positions in Alpaca paper dashboard
2. Restart engine to force a position sync: `npx pm2 restart engine`
3. If still stale, clear the state table:

```bash
aws dynamodb delete-item \
  --table-name trading-state \
  --key '{"pk": {"S": "positions"}, "sk": {"S": "current"}}' \
  --endpoint-url http://localhost:8000 \
  --region us-east-1
```

4. Restart engine again

### DynamoDB Local Not Starting

**Symptoms:** Docker container exits immediately.

**Resolution:**
1. Check Docker logs: `docker logs janestreet-dynamodb`
2. Ensure port 8000 is not in use: `lsof -i :8000` or `netstat -an | grep 8000`
3. Remove and recreate: `docker compose down -v && docker compose up -d dynamodb-local`

### Dashboard Not Loading

**Symptoms:** Browser shows connection refused on port 3000.

**Resolution:**
1. Check dashboard logs: `npx pm2 logs dashboard`
2. Ensure engine is running (dashboard depends on it for API data)
3. Restart: `npx pm2 restart dashboard`

## Performance Review Cadence

### Daily (during market hours)

- Check dashboard for P&L and open positions
- Review watchdog alerts for any anomalies
- Verify engine is connected and processing data

### Weekly

- Review total P&L for the week
- Check trade history for unexpected patterns
- Review watchdog logs for recurring warnings
- Verify DynamoDB table sizes are reasonable

### Monthly

- Full performance review: win rate, Sharpe ratio, max drawdown
- Compare strategy performance against benchmarks
- Review and adjust strategy parameters if needed
- Back-test any proposed parameter changes before deploying
- Archive old trade history data if tables are growing large

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `ALPACA_API_KEY` | Yes | Alpaca paper trading API key |
| `ALPACA_SECRET_KEY` | Yes | Alpaca paper trading secret |
| `ALPACA_BASE_URL` | Yes | Alpaca API base URL |
| `LOCAL_API_SECRET` | Yes | Secret for inter-service auth |
| `DYNAMODB_ENDPOINT` | No | DynamoDB endpoint (default: http://localhost:8000) |
| `AWS_REGION` | No | AWS region (default: us-east-1) |
| `AWS_ACCESS_KEY_ID` | No | AWS key (use "local" for local dev) |
| `AWS_SECRET_ACCESS_KEY` | No | AWS secret (use "local" for local dev) |
| `ENGINE_PORT` | No | Engine port (default: 3001) |
| `WATCHDOG_PORT` | No | Watchdog port (default: 3002) |
| `DASHBOARD_PORT` | No | Dashboard port (default: 3000) |
| `SLACK_WEBHOOK_URL` | No | Slack webhook for alerts |
| `SNS_TOPIC_ARN` | No | AWS SNS topic for alerts |
| `NODE_ENV` | No | Environment (development/production) |
