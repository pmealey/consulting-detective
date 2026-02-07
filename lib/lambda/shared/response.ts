export interface SuccessResponse<T> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

export function successResponse<T>(data: T, statusCode: number = 200) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
    body: JSON.stringify({
      success: true,
      data,
    } as SuccessResponse<T>),
  };
}

export function errorResponse(
  code: string,
  message: string,
  statusCode: number = 400
) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
    body: JSON.stringify({
      success: false,
      error: {
        code,
        message,
      },
    } as ErrorResponse),
  };
}

export const ErrorCodes = {
  NOT_FOUND: { code: 'NOT_FOUND', status: 404 },
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 400 },
  UNAUTHORIZED: { code: 'UNAUTHORIZED', status: 401 },
  CONFLICT: { code: 'CONFLICT', status: 409 },
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', status: 500 },
};
