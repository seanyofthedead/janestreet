import {
  DynamoDBClient,
  CreateTableCommand,
  ListTablesCommand,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';

const endpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
const region = process.env.AWS_REGION || 'us-east-1';

const client = new DynamoDBClient({
  region,
  ...(endpoint ? { endpoint } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
  },
});

const tables: CreateTableCommandInput[] = [
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

async function main(): Promise<void> {
  console.log(`Setting up DynamoDB tables at ${endpoint}...`);

  const existing = await client.send(new ListTablesCommand({}));
  const existingNames = new Set(existing.TableNames ?? []);

  for (const tableDef of tables) {
    const name = tableDef.TableName!;
    if (existingNames.has(name)) {
      console.log(`  Table "${name}" already exists — skipping.`);
      continue;
    }
    try {
      await client.send(new CreateTableCommand(tableDef));
      console.log(`  Created table "${name}".`);
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name === 'ResourceInUseException') {
        console.log(`  Table "${name}" already exists — skipping.`);
      } else {
        console.error(`  Failed to create table "${name}":`, error.message);
        throw error;
      }
    }
  }

  console.log('DynamoDB table setup complete.');
}

main().catch((err) => {
  console.error('Table setup failed:', err);
  process.exit(1);
});
