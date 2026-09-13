import { useState, useEffect } from 'react';
import { ApiClient } from '@/api/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Activity, RefreshCw, Loader2, Server } from 'lucide-react';

export function SystemHealth() {
  const [healthData, setHealthData] = useState<any>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const checkHealth = async () => {
    setLoading(true);
    setError(null);
    const t0 = performance.now();
    try {
      const data = await ApiClient.getHealth();
      const elapsed = Math.round(performance.now() - t0);
      setHealthData(data);
      setLatencyMs(elapsed);
    } catch (err: any) {
      setError(err.message || 'Health check failed');
      setHealthData(null);
      setLatencyMs(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  const isHealthy = healthData && (healthData.status === 'healthy' || healthData.status === 'ok' || healthData.status === 'HEALTHY');

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" /> Platform Health &amp; Dependency Diagnostics
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Continuous real-time probing of API Gateway, DynamoDB control plane, S3 immutable binary store, and OpenSearch
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={checkHealth}
          disabled={loading}
          className="text-xs gap-1.5"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh Diagnostics
        </Button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-slate-900/60">
          <CardContent className="p-4 space-y-1">
            <div className="text-xs text-slate-400 font-medium">System Status</div>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={isHealthy ? 'success' : 'destructive'} className="text-sm font-bold">
                {isHealthy ? 'HEALTHY / ONLINE' : error ? 'DEGRADED / OFFLINE' : 'CHECKING...'}
              </Badge>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Endpoint: <code>/health</code></div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60">
          <CardContent className="p-4 space-y-1">
            <div className="text-xs text-slate-400 font-medium">Roundtrip API Latency</div>
            <div className="text-2xl font-bold text-emerald-400 font-mono">
              {latencyMs !== null ? `${latencyMs} ms` : '-'}
            </div>
            <div className="text-[11px] text-slate-500">API Gateway + Lambda execution</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60">
          <CardContent className="p-4 space-y-1">
            <div className="text-xs text-slate-400 font-medium">Architecture Runtime</div>
            <div className="text-sm font-semibold text-slate-200 flex items-center gap-1.5 mt-1">
              <Server className="w-4 h-4 text-aws-orange" /> AWS Graviton ARM64
            </div>
            <div className="text-[11px] text-slate-500">100% Serverless CloudFront + S3 SPA</div>
          </CardContent>
        </Card>
      </div>

      {/* Raw Health JSON Response */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-white flex items-center justify-between">
            <span>Dependency Probes &amp; Raw JSON Response</span>
            <Badge variant="outline" className="text-[10px] font-mono text-slate-400">HTTP 200 OK</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="p-8 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-aws-orange" /> Querying platform health endpoint...
            </div>
          ) : error ? (
            <div className="p-4 bg-red-950/30 rounded border border-red-900/50 text-red-300 text-xs font-mono">
              Error probing /health: {error}
            </div>
          ) : (
            <pre className="p-4 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-emerald-300 max-h-80 overflow-y-auto whitespace-pre-wrap">
              {JSON.stringify(healthData, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
