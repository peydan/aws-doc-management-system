import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { UserCheck, Copy, CheckCircle2, Shield, Key, Clock } from 'lucide-react';

export function SessionInspector() {
  const { token, claims, primaryRole, username } = useAuth();
  const [copied, setCopied] = useState<boolean>(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const handleCopyToken = async () => {
    if (token) {
      try {
        await navigator.clipboard.writeText(token);
        setCopied(true);
        setCopyError(null);
        setTimeout(() => setCopied(false), 2500);
      } catch (err: any) {
        setCopyError('Unable to copy token: ' + (err.message || 'Clipboard access denied'));
        setTimeout(() => setCopyError(null), 3000);
      }
    }
  };

  const expDate = claims?.exp ? new Date(claims.exp * 1000).toLocaleString() : 'Unknown';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-purple-400" /> Active Session JWT Claims &amp; Persona
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Decoded Cognito ID/Access token determining RBAC permissions across the document platform
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={handleCopyToken}
          className="text-xs gap-1.5"
        >
          <Copy className="w-3.5 h-3.5" /> Copy Raw JWT Token
        </Button>
      </div>

      {copied && (
        <Alert variant="success">
          <CheckCircle2 className="w-4 h-4" />
          <AlertDescription>Raw JWT token copied to clipboard!</AlertDescription>
        </Alert>
      )}

      {copyError && (
        <Alert variant="destructive">
          <AlertDescription>{copyError}</AlertDescription>
        </Alert>
      )}

      {/* Persona Overview Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-slate-900/60">
          <CardContent className="p-4 space-y-1">
            <div className="text-xs text-slate-400 font-medium">Active Username</div>
            <div className="text-base font-bold text-white mt-1">
              {username || 'Unknown'}
            </div>
            <div className="text-[11px] text-slate-500 font-mono">
              sub: {claims?.sub ? claims.sub.slice(0, 16) + '...' : '-'}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60">
          <CardContent className="p-4 space-y-1">
            <div className="text-xs text-slate-400 font-medium">Enforced RBAC Role</div>
            <div className="mt-1">
              <Badge variant="primary" className="text-xs font-semibold">
                <Shield className="w-3 h-3 mr-1 inline" />
                {primaryRole || 'Document.Reader'}
              </Badge>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">From <code>cognito:groups</code> claim</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60">
          <CardContent className="p-4 space-y-1">
            <div className="text-xs text-slate-400 font-medium">Session Expiration</div>
            <div className="text-xs font-mono text-slate-200 mt-1 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              {expDate}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Cognito User Pool Auth</div>
          </CardContent>
        </Card>
      </div>

      {/* Decoded JWT Claims Box */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-white flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Key className="w-4 h-4 text-aws-orange" /> Decoded JWT Claims Payload
            </span>
            <Badge variant="outline" className="text-[10px] font-mono text-purple-400">RS256 Verified</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="p-4 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-purple-300 max-h-96 overflow-y-auto whitespace-pre-wrap">
            {JSON.stringify(claims, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
