import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { ApiClient } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Shield, User, Activity, LogOut, ExternalLink } from 'lucide-react';

export function Header() {
  const { username, primaryRole, logout } = useAuth();
  const [healthStatus, setHealthStatus] = useState<'checking' | 'healthy' | 'unhealthy'>('checking');

  useEffect(() => {
    let isMounted = true;
    ApiClient.getHealth()
      .then((res) => {
        if (isMounted) {
          setHealthStatus(res.status === 'healthy' || res.status === 'ok' ? 'healthy' : 'unhealthy');
        }
      })
      .catch(() => {
        if (isMounted) setHealthStatus('unhealthy');
      });
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-40">
      <div className="flex items-center gap-3">
        <div className="text-3xl">📄</div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight text-white">
              AWS Document Management Platform
            </h1>
            <Badge variant="primary" className="text-xs uppercase tracking-wider">
              React + Vite
            </Badge>
          </div>
          <p className="text-xs text-slate-400">
            Enterprise WORM Repository • AWS Israel Region (<span className="text-aws-orange">il-central-1</span>)
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Badge variant="outline" className="gap-1.5 py-1 px-3 border-slate-700 bg-slate-800/80">
          <User className="w-3.5 h-3.5 text-aws-orange" />
          <span className="text-slate-200 font-medium">{username}</span>
        </Badge>

        <Badge variant="secondary" className="gap-1.5 py-1 px-3 border-slate-700">
          <Shield className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-slate-200">{primaryRole}</span>
        </Badge>

        <Badge
          variant={healthStatus === 'healthy' ? 'success' : healthStatus === 'unhealthy' ? 'destructive' : 'secondary'}
          className="gap-1.5 py-1 px-3"
        >
          <Activity className="w-3.5 h-3.5" />
          <span className="capitalize">{healthStatus}</span>
        </Badge>

        {/* Switcher to Classic View */}
        <Button
          variant="outline"
          size="sm"
          className="text-xs text-slate-400 hover:text-slate-200 border-slate-800 hover:bg-slate-800"
          onClick={() => {
            window.location.href = window.location.port === '3001' ? 'http://localhost:3000' : '/';
          }}
          title="Switch to Classic Vanilla JS Portal"
        >
          <ExternalLink className="w-3.5 h-3.5 mr-1" />
          Classic UI
        </Button>

        <Button variant="destructive" size="sm" onClick={logout} className="gap-1.5">
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </Button>
      </div>
    </header>
  );
}
