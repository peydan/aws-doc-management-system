import { APIGatewayProxyResult } from "aws-lambda";
import { CORS_HEADERS } from "./headers";

export async function handler(): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: "",
  };
}
