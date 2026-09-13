import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { ApiClient } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Shield, User, Activity, LogOut } from 'lucide-react';

export function Header() {
  const { username, primaryRole, logout } = useAuth();
  const [healthStatus, setHealthStatus] = useState<'checking' | 'healthy' | 'unhealthy'>('checking');

  useEffect(() => {
    let isMounted = true;
    ApiClient.getHealth()
      .then((res) => {
        if (isMounted) {
          const statusLower = String(res.status || '').toLowerCase();
          setHealthStatus(statusLower === 'healthy' || statusLower === 'ok' ? 'healthy' : 'unhealthy');
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
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-aws-orange to-amber-400 flex items-center justify-center font-black text-slate-950 shadow-md shadow-aws-orange/20">
          D
        </div>
        <div>
          <h1 className="font-bold text-base tracking-tight text-white flex items-center gap-2">
            AWS Document Management Platform
            <Badge variant="outline" className="text-[10px] text-aws-orange border-aws-orange/40 font-mono py-0">
              PROD
            </Badge>
          </h1>
          <p className="text-xs text-slate-400">Content Authority & WORM Store</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="gap-1.5 py-1 px-3 border-slate-700">
          <User className="w-3.5 h-3.5 text-slate-400" />
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

        <Button variant="destructive" size="sm" onClick={logout} className="gap-1.5">
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </Button>
      </div>
    </header>
  );
}
