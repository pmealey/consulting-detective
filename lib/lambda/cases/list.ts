import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, CASES_TABLE } from '../shared/db';
import { successResponse, errorResponse, ErrorCodes } from '../shared/response';

/**
 * GET /cases -- List all available cases.
 *
 * Returns summary fields only (caseDate, title, difficulty, setting).
 * Sorted by caseDate descending (newest first).
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: CASES_TABLE,
        ProjectionExpression: 'caseDate, title, difficulty, setting',
      }),
    );

    const cases = (result.Items ?? []).sort((a, b) =>
      (b.caseDate as string).localeCompare(a.caseDate as string),
    );

    return successResponse(cases);
  } catch (error) {
    console.error('List cases error:', error);
    return errorResponse(
      ErrorCodes.INTERNAL_ERROR.code,
      'Failed to list cases',
      ErrorCodes.INTERNAL_ERROR.status,
    );
  }
}
