import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { loadConfig, ApiClient } from '@/api/client';

export interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  username: string;
  roles: string[];
  primaryRole: string;
  claims: Record<string, any> | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('');
  const [roles, setRoles] = useState<string[]>([]);
  const [primaryRole, setPrimaryRole] = useState<string>('Document.Reader');
  const [claims, setClaims] = useState<Record<string, any> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const parseJwt = (jwt: string) => {
    try {
      const parts = jwt.split('.');
      if (parts.length === 3) {
        const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          atob(payloadBase64)
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        return JSON.parse(jsonPayload);
      }
    } catch (e) {
      console.error('Failed to parse JWT payload', e);
    }
    return null;
  };

  const setAuthSession = useCallback((jwtToken: string) => {
    const parsedClaims = parseJwt(jwtToken);
    if (!parsedClaims) {
      logout();
      return false;
    }

    if (parsedClaims.exp && parsedClaims.exp * 1000 < Date.now()) {
      console.warn('Stored JWT token expired');
      logout();
      return false;
    }

    const uname = parsedClaims['cognito:username'] || parsedClaims.sub || 'User';
    const userGroups = parsedClaims['cognito:groups'] || parsedClaims.roles || ['Document.Reader'];
    const pRole = Array.isArray(userGroups) && userGroups.length > 0 ? userGroups[0] : 'Document.Reader';

    setToken(jwtToken);
    setUsername(uname);
    setRoles(Array.isArray(userGroups) ? userGroups : [userGroups]);
    setPrimaryRole(pRole);
    setClaims(parsedClaims);
    ApiClient.setToken(jwtToken);

    localStorage.setItem('doc_platform_token', jwtToken);
    return true;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUsername('');
    setRoles([]);
    setPrimaryRole('Document.Reader');
    setClaims(null);
    ApiClient.setToken(null);
    localStorage.removeItem('doc_platform_token');
    localStorage.removeItem('doc_platform_refresh_token');
  }, []);

  const login = async (user: string, pass: string) => {
    const config = await loadConfig();
    const endpoint = `https://cognito-idp.${config.region}.amazonaws.com/`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
      },
      body: JSON.stringify({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: config.userPoolClientId,
        AuthParameters: {
          USERNAME: user,
          PASSWORD: pass,
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.__type || 'Authentication failed');
    }

    const jwt = data.AuthenticationResult?.IdToken || data.AuthenticationResult?.AccessToken;
    if (!jwt) throw new Error('No authentication token received');

    if (data.AuthenticationResult?.RefreshToken) {
      localStorage.setItem('doc_platform_refresh_token', data.AuthenticationResult.RefreshToken);
    }

    setAuthSession(jwt);
  };

  // Restore token on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('doc_platform_token');
    if (savedToken) {
      setAuthSession(savedToken);
    }
    setIsLoading(false);
  }, [setAuthSession]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!token,
        isLoading,
        token,
        username,
        roles,
        primaryRole,
        claims,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
