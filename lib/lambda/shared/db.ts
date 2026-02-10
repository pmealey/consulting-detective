import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Create DynamoDB client
const client = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

// Table names from environment variables
export const CASES_TABLE = process.env.CASES_TABLE_NAME!;
export const DRAFT_CASES_TABLE = process.env.DRAFT_CASES_TABLE_NAME!;
