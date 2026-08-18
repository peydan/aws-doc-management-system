import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { AuthenticationError, AuthorizationError } from './errors';

export type ApplicationRole = 'Document.Reader' | 'Document.Writer' | 'Document.MetadataEditor' | 'Document.Admin';

export interface UserContext {
  userId: string;
  email?: string;
  roles: ApplicationRole[];
}

let verifier: any = null;

function getVerifier() {
  if (!verifier && process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID,
      tokenUse: null, // Allow both id and access tokens
      clientId: process.env.COGNITO_CLIENT_ID,
    });
  }
  return verifier;
}

export async function authenticateRequest(event: APIGatewayProxyEvent): Promise<UserContext> {
  const authHeader = event.headers.Authorization || event.headers.authorization;
  
  // Allow test mock bypass in local unit testing if explicit flag is set
  if (process.env.MOCK_AUTH_BYPASS === 'true') {
    const mockRole = (event.headers['x-mock-role'] as ApplicationRole) || 'Document.Admin';
    const mockUser = event.headers['x-mock-user'] || 'test-user-id';
    return {
      userId: mockUser,
      email: `${mockUser}@demo.local`,
      roles: [mockRole],
    };
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError('Missing or malformed Authorization header');
  }

  const token = authHeader.substring(7);

  try {
    const v = getVerifier();
    if (!v) {
      throw new AuthenticationError('Cognito User Pool verification is not configured on this environment');
    }
    const payload: any = await v.verify(token);

    const userId = payload.sub || payload.username || 'unknown';
    const email = payload.email;
    const groups: string[] = payload['cognito:groups'] || payload['roles'] || [];

    const roles: ApplicationRole[] = [];
    if (groups.includes('Document.Admin') || groups.includes('admin')) roles.push('Document.Admin');
    if (groups.includes('Document.Writer') || groups.includes('writer')) roles.push('Document.Writer');
    if (groups.includes('Document.MetadataEditor') || groups.includes('editor')) roles.push('Document.MetadataEditor');
    if (groups.includes('Document.Reader') || groups.includes('reader')) roles.push('Document.Reader');

    // Default to Document.Reader if authenticated with valid token
    if (roles.length === 0) {
      roles.push('Document.Reader');
    }

    return { userId, email, roles };
  } catch (err: any) {
    throw new AuthenticationError(`Token verification failed: ${err.message}`);
  }
}

export function authorizeRoles(userContext: UserContext, allowedRoles: ApplicationRole[]): void {
  // Document.Admin has superuser permissions over all MVP operations
  if (userContext.roles.includes('Document.Admin')) {
    return;
  }

  const hasRole = allowedRoles.some((role) => userContext.roles.includes(role));
  if (!hasRole) {
    throw new AuthorizationError(`Required role: one of [${allowedRoles.join(', ')}]. User roles: [${userContext.roles.join(', ')}]`);
  }
}
