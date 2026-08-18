import { APIGatewayProxyResult } from 'aws-lambda';

export async function handler(): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'HEALTHY',
      service: 'aws-document-management-platform',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    }),
  };
}
