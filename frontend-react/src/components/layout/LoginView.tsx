import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Lock, Loader2, AlertTriangle } from 'lucide-react';

export function LoginView() {
  const { login } = useAuth();
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Please enter both username and password');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center p-4 bg-slate-950 text-slate-100">
      <div className="w-full max-w-md space-y-6">
        {/* Header Block */}
        <div className="text-center space-y-2">
          <div className="text-5xl mb-2">📄</div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
            AWS Document Platform
          </h1>
          <p className="text-xs text-slate-400">
            Secure Enterprise WORM Repository • AWS Israel Region (<span className="text-aws-orange">il-central-1</span>)
          </p>
        </div>

        {/* Login Card */}
        <Card className="border-slate-800 bg-slate-900/90 shadow-2xl backdrop-blur">
          <CardHeader className="border-b border-slate-800/80 pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="w-4 h-4 text-aws-orange" /> Enterprise Authentication
            </CardTitle>
            <CardDescription className="text-xs">
              Sign in with your AWS Cognito User Pool credentials
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="login-username" className="text-xs font-semibold text-slate-300">Username or Email</label>
                <Input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username or email"
                  autoComplete="username"
                  required
                  className="bg-slate-950 border-slate-700"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="login-password" className="text-xs font-semibold text-slate-300">Password</label>
                <Input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                  className="bg-slate-950 border-slate-700"
                />
              </div>

              {error && (
                <Alert variant="destructive" role="alert" aria-live="assertive" className="py-2.5">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertTitle className="text-xs">Authentication Failed</AlertTitle>
                  <AlertDescription className="text-xs">{error}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-10 bg-aws-orange hover:bg-aws-orangeHover text-slate-950 font-bold gap-2 mt-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : '🚀 Sign In & Enter Portal'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
