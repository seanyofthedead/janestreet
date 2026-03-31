import { DynamoDBClient, CreateTableCommand, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent } from 'http';

const endpoint = process.env.DYNAMODB_ENDPOINT || 'http://127.0.0.1:8000';
const region = process.env.AWS_REGION || 'us-east-1';

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
  },
  requestHandler: new NodeHttpHandler({
    httpAgent: new Agent({ family: 4 }),
    connectionTimeout: 5000,
    socketTimeout: 5000,
  }),
});

const tables = [
  {
    TableName: 'trading-state',
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'trading-config',
    KeySchema: [
      { AttributeName: 'key', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'key', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'trading-history',
    KeySchema: [
      { AttributeName: 'strategy', KeyType: 'HASH' },
      { AttributeName: 'timestamp', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'strategy', AttributeType: 'S' },
      { AttributeName: 'timestamp', AttributeType: 'N' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
];

async function main() {
  console.log(`Setting up DynamoDB tables at ${endpoint}...`);

  const existing = await client.send(new ListTablesCommand({}));
  const existingNames = new Set(existing.TableNames ?? []);

  for (const tableDef of tables) {
    const name = tableDef.TableName;
    if (existingNames.has(name)) {
      console.log(`  Table "${name}" already exists — skipping.`);
      continue;
    }
    try {
      await client.send(new CreateTableCommand(tableDef));
      console.log(`  Created table "${name}".`);
    } catch (err) {
      if (err.name === 'ResourceInUseException') {
        console.log(`  Table "${name}" already exists — skipping.`);
      } else {
        console.error(`  Failed to create table "${name}":`, err.message);
        throw err;
      }
    }
  }

  console.log('DynamoDB table setup complete.');
}

main().catch((err) => {
  console.error('Table setup failed:', err);
  process.exit(1);
});
