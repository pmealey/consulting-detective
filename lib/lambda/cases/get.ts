import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, CASES_TABLE } from '../shared/db';
import { successResponse, errorResponse, ErrorCodes } from '../shared/response';

/**
 * GET /cases/{caseDate} -- Get a full case by date.
 *
 * Returns the complete Case object including answers and optimal path.
 * All game logic runs client-side (Wordle model).
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const caseDate = event.pathParameters?.caseDate;

    if (!caseDate) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR.code,
        'caseDate path parameter is required',
        ErrorCodes.VALIDATION_ERROR.status,
      );
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: CASES_TABLE,
        Key: { caseDate },
      }),
    );

    if (!result.Item) {
      return errorResponse(
        ErrorCodes.NOT_FOUND.code,
        `No case found for date ${caseDate}`,
        ErrorCodes.NOT_FOUND.status,
      );
    }

    return successResponse(result.Item);
  } catch (error) {
    console.error('Get case error:', error);
    return errorResponse(
      ErrorCodes.INTERNAL_ERROR.code,
      'Failed to get case',
      ErrorCodes.INTERNAL_ERROR.status,
    );
  }
}
