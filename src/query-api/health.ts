import { APIGatewayProxyResult } from 'aws-lambda';
import { CORS_HEADERS } from '../shared/headers';

export async function handler(): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      status: 'HEALTHY',
      service: 'aws-document-management-platform',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    }),
  };
}
