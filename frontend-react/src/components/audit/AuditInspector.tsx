import { useState, useEffect } from 'react';
import { ApiClient, DocumentRecord, ApiAuditLogEntry, subscribeSessionAuditLogs, clearSessionAuditLogs } from '@/api/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Bot,
  Clock,
  Shield,
  Copy,
  Download,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Terminal,
  FileText,
  Search,
} from 'lucide-react';

interface AuditInspectorProps {
  activeDocument: DocumentRecord | null;
}

export function AuditInspector({ activeDocument }: AuditInspectorProps) {
  const [docId, setDocId] = useState<string>(activeDocument?.document_id || '');
  const [subTab, setSubTab] = useState<'llm' | 'lifecycle' | 'both' | 'session'>('llm');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [auditData, setAuditData] = useState<any>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [sessionLogs, setSessionLogs] = useState<ApiAuditLogEntry[]>([]);

  // Subscribe to real-time session API calls
  useEffect(() => {
    const unsubscribe = subscribeSessionAuditLogs((logs) => {
      setSessionLogs(logs);
    });
    return unsubscribe;
  }, []);

  // Update docId when activeDocument changes
  useEffect(() => {
    if (activeDocument) {
      setDocId(activeDocument.document_id);
      fetchAudit(activeDocument.document_id);
    }
  }, [activeDocument]);

  const fetchAudit = async (targetId?: string) => {
    const idToFetch = (targetId || docId).trim();
    if (!idToFetch) {
      setError('Please enter a Document UUID to inspect audit.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await ApiClient.getDocumentAudit(idToFetch);
      setAuditData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load document audit trail');
      setAuditData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleUseActiveDoc = () => {
    if (activeDocument?.document_id) {
      setDocId(activeDocument.document_id);
      fetchAudit(activeDocument.document_id);
    } else {
      setError('No active document loaded in viewer. Enter a Document UUID.');
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(`${label} copied to clipboard!`);
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  const handleExportSessionLogs = () => {
    if (sessionLogs.length === 0) return;
    const blob = new Blob([JSON.stringify(sessionLogs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `doc-platform-session-audit-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const llm = auditData?.llm_enrichment_audit || {};
  const lifecycle = auditData?.lifecycle_audit || {};
  const versions: any[] = lifecycle?.versions || [];
  const systemEvents: any[] = lifecycle?.system_events || [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Top Document Context Selector */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                <Search className="w-4 h-4 text-aws-orange" /> Document Audit Context
              </CardTitle>
              <p className="text-xs text-slate-400 mt-0.5">
                Inspect Bedrock LLM enrichment metadata and authoritative S3/DynamoDB lifecycle audit for a specific document
              </p>
            </div>

            {auditData && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={auditData.status === 'ACTIVE' ? 'success' : 'destructive'} className="font-mono text-xs">
                  {auditData.status}
                </Badge>
                <Badge variant="outline" className="font-mono text-xs text-slate-300">
                  {auditData.document_class || '-'}
                </Badge>
                <Badge variant="outline" className="font-mono text-xs text-slate-300">
                  v{auditData.current_application_version || 1}
                </Badge>
                <Badge variant="primary" className="font-mono text-xs">
                  rev {auditData.current_metadata_revision || 1}
                </Badge>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex-1 min-w-[280px]">
              <Input
                value={docId}
                onChange={(e) => setDocId(e.target.value)}
                placeholder="Enter Document UUID (e.g. 550e8400-e29b-41d4-a716-446655440000)"
                className="bg-slate-950 border-slate-700 font-mono text-xs"
              />
            </div>
            <Button
              onClick={() => fetchAudit()}
              disabled={loading || !docId.trim()}
              className="gap-2 bg-aws-orange hover:bg-aws-orangeHover text-slate-950 font-bold text-xs"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Fetch Audit Trail
            </Button>
            <Button
              variant="outline"
              onClick={handleUseActiveDoc}
              disabled={!activeDocument}
              className="text-xs gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" /> Use Active Document
            </Button>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="w-4 h-4" />
              <AlertTitle>Audit Fetch Failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {copyFeedback && (
            <Alert variant="success">
              <CheckCircle2 className="w-4 h-4" />
              <AlertDescription>{copyFeedback}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Sub-Navigation Buttons */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        <Button
          size="sm"
          variant={subTab === 'llm' ? 'default' : 'outline'}
          onClick={() => setSubTab('llm')}
          className="text-xs gap-1.5"
        >
          <Bot className="w-3.5 h-3.5 text-purple-400" /> LLM Enrichment Audit
        </Button>
        <Button
          size="sm"
          variant={subTab === 'lifecycle' ? 'default' : 'outline'}
          onClick={() => setSubTab('lifecycle')}
          className="text-xs gap-1.5"
        >
          <Clock className="w-3.5 h-3.5 text-blue-400" /> Lifecycle &amp; System Audit
        </Button>
        <Button
          size="sm"
          variant={subTab === 'both' ? 'default' : 'outline'}
          onClick={() => setSubTab('both')}
          className="text-xs gap-1.5"
        >
          🔀 Side-by-Side View
        </Button>
        <Button
          size="sm"
          variant={subTab === 'session' ? 'default' : 'outline'}
          onClick={() => setSubTab('session')}
          className="text-xs gap-1.5 ml-auto"
        >
          <Terminal className="w-3.5 h-3.5 text-emerald-400" /> Session API Requests ({sessionLogs.length})
        </Button>
      </div>

      {/* KIND 1: LLM Enrichment Audit */}
      {(subTab === 'llm' || subTab === 'both') && (
        <Card className="border-l-4 border-l-aws-orange">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
                  <Bot className="w-4 h-4 text-purple-400" /> Amazon Bedrock Metadata &amp; PII Enrichment Audit
                </CardTitle>
                <p className="text-xs text-slate-400 mt-0.5">
                  Authoritative record captured from S3 metadata annotations &amp; immutable S3 compliance bucket
                </p>
              </div>

              {auditData && (
                <div className="flex items-center gap-2">
                  <Badge variant={llm.status === 'ENRICHED' ? 'success' : 'outline'} className="text-xs">
                    {llm.status === 'ENRICHED' ? 'Bedrock Audited' : (llm.status || 'Not Enriched')}
                  </Badge>
                  {llm.latency_ms !== undefined && (
                    <Badge variant="outline" className="text-xs font-mono text-slate-300">
                      {llm.latency_ms} ms
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {!auditData ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                Please fetch or select a document above to inspect its Bedrock LLM enrichment audit trail.
              </div>
            ) : (
              <>
                {/* 4 Metric Tiles */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800/80">
                    <div className="text-[11px] text-slate-400 font-medium uppercase">Bedrock Model</div>
                    <div className="text-sm font-semibold text-sky-400 mt-1 truncate">
                      {llm.model_id || 'Amazon Nova 2 Lite'}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800/80">
                    <div className="text-[11px] text-slate-400 font-medium uppercase">Total Tokens</div>
                    <div className="text-sm font-semibold text-amber-400 mt-1">
                      {(llm.total_tokens || 0).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {(llm.prompt_tokens || 0).toLocaleString()} in / {(llm.completion_tokens || 0).toLocaleString()} out
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800/80">
                    <div className="text-[11px] text-slate-400 font-medium uppercase">Inference Latency</div>
                    <div className="text-sm font-semibold text-emerald-400 mt-1">
                      {llm.latency_ms || 0} ms
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800/80">
                    <div className="text-[11px] text-slate-400 font-medium uppercase">Enriched At</div>
                    <div className="text-xs font-mono text-slate-200 mt-1 truncate">
                      {llm.applied_at ? new Date(llm.applied_at).toLocaleString() : '-'}
                    </div>
                  </div>
                </div>

                {/* PII Discovery & Safety Ratchet */}
                <div className="p-4 bg-slate-950/60 rounded-lg border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-blue-400" /> PII Discovery &amp; Safety Ratchet
                    </div>
                    <Badge variant={llm.contains_pii ? 'destructive' : 'success'} className="text-xs">
                      {llm.contains_pii ? '⚠️ PII Detected' : '✅ No PII'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Enforces monotonic safety ratchet: PII flags cannot be downgraded, and newly detected categories are merged.
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {Array.isArray(llm.pii_categories) && llm.pii_categories.length > 0 ? (
                      llm.pii_categories.map((cat: string) => (
                        <Badge key={cat} variant="destructive" className="text-[10px] font-mono">
                          {cat}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-[11px] text-slate-500">No PII categories identified</span>
                    )}
                  </div>
                </div>

                {/* Immutable S3 Compliance URI */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-medium text-slate-300">📦 Immutable S3 Compliance Audit URI</label>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleCopy(llm.s3_audit_uri || llm.s3_audit_key || '', 'S3 URI')}
                      className="text-[11px] h-6 px-2 text-slate-400 hover:text-white gap-1"
                    >
                      <Copy className="w-3 h-3" /> Copy URI
                    </Button>
                  </div>
                  <div className="p-2.5 bg-slate-950 rounded border border-slate-800 text-xs font-mono text-slate-300 break-all">
                    {llm.s3_audit_uri || llm.s3_audit_key || '-'}
                  </div>
                </div>

                {/* Raw Bedrock Audit Payload */}
                <details className="cursor-pointer group">
                  <summary className="text-xs font-semibold text-aws-orange hover:text-aws-orangeHover">
                    🔍 Full Bedrock Audit Record Payload
                  </summary>
                  <pre className="mt-2 p-3 bg-slate-950 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300 max-h-60 overflow-y-auto whitespace-pre-wrap">
                    {JSON.stringify(llm.raw_record || llm, null, 2)}
                  </pre>
                </details>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* KIND 2: Document Lifecycle & System Audit */}
      {(subTab === 'lifecycle' || subTab === 'both') && (
        <div className="space-y-6">
          {/* Version Lineage Table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-400" /> Document Version Lineage (DynamoDB &amp; S3 WORM)
              </CardTitle>
              <p className="text-xs text-slate-400 mt-0.5">
                Cryptographic SHA-256 checksums and immutable version records
              </p>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs">
                  {auditData ? 'No version records found' : 'Please fetch a document above'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2 px-3">App Version</th>
                        <th className="py-2 px-3">S3 Version ID</th>
                        <th className="py-2 px-3">SHA-256 Checksum</th>
                        <th className="py-2 px-3">State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {versions.map((v: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-900/50">
                          <td className="py-2 px-3 font-sans">
                            <Badge variant="outline" className="text-xs text-blue-400">
                              v{v.application_version}
                            </Badge>
                          </td>
                          <td className="py-2 px-3 text-[11px] text-slate-300">
                            {v.s3_version_id || '-'}
                          </td>
                          <td className="py-2 px-3 text-[11px] text-slate-400 truncate max-w-[200px]">
                            {v.content_checksum || '-'}
                          </td>
                          <td className="py-2 px-3 font-sans">
                            <Badge variant={v.state === 'ACTIVE' || !v.state ? 'success' : 'destructive'} className="text-[10px]">
                              {v.state || 'ACTIVE'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Chronological Timeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
                🏛️ Document Mutation &amp; Lifecycle Timeline
              </CardTitle>
              <p className="text-xs text-slate-400 mt-0.5">
                Server-side lifecycle events recorded in S3 audit bucket and DynamoDB Streams
              </p>
            </CardHeader>
            <CardContent>
              {systemEvents.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs">
                  No lifecycle events recorded for this document.
                </div>
              ) : (
                <div className="space-y-3">
                  {systemEvents.map((evt: any, idx: number) => (
                    <div key={idx} className="p-3 bg-slate-950/70 rounded-lg border border-slate-800/80 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <strong className="text-slate-200">{evt.description || evt.event_type || 'Event'}</strong>
                        <span className="text-[11px] text-slate-500">
                          {evt.timestamp ? new Date(evt.timestamp).toLocaleString() : '-'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-2">
                        <span>Actor: <Badge variant="outline" className="text-[10px]">{evt.actor || 'system'}</Badge></span>
                        {evt.details && (
                          <span className="font-mono text-slate-500 truncate max-w-md">
                            {JSON.stringify(evt.details)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* SESSION API REQUEST & cURL INSPECTOR */}
      {subTab === 'session' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" /> Session API Request &amp; cURL Inspector
                </CardTitle>
                <p className="text-xs text-slate-400 mt-0.5">
                  Operational REST calls made during this active single-page app session
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportSessionLogs}
                  disabled={sessionLogs.length === 0}
                  className="text-xs gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> Export JSON
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearSessionAuditLogs}
                  disabled={sessionLogs.length === 0}
                  className="text-xs gap-1.5 text-slate-400 hover:text-red-400"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear Log
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {sessionLogs.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No API calls logged in this session yet. Perform searches, viewer fetches, or uploads to view live traces.
              </div>
            ) : (
              <div className="space-y-3">
                {sessionLogs.map((log) => (
                  <div key={log.id} className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-mono">
                        <Badge
                          variant={log.status >= 200 && log.status < 300 ? 'success' : log.status === 409 ? 'outline' : 'destructive'}
                          className="text-[10px]"
                        >
                          {log.method} {log.status || 'ERR'}
                        </Badge>
                        <span className="text-slate-300 text-[11px] truncate max-w-lg">{log.url}</span>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono">
                        <span>{log.durationMs} ms</span>
                        <span>{log.timestamp}</span>
                      </div>
                    </div>

                    {/* Expandable cURL & Response */}
                    <details className="cursor-pointer group pt-1">
                      <summary className="text-[11px] text-aws-orange hover:text-aws-orangeHover">
                        Inspect cURL &amp; Response Body
                      </summary>
                      <div className="mt-2 space-y-2 font-mono text-[11px]">
                        <div>
                          <div className="flex justify-between items-center text-[10px] text-slate-400 mb-1">
                            <span>cURL Command</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleCopy(log.curl, 'cURL')}
                              className="h-5 px-1.5 text-[10px] text-slate-400 hover:text-white"
                            >
                              <Copy className="w-2.5 h-2.5 mr-1" /> Copy
                            </Button>
                          </div>
                          <pre className="p-2 bg-slate-900 rounded border border-slate-800 text-slate-300 overflow-x-auto whitespace-pre-wrap">
                            {log.curl}
                          </pre>
                        </div>

                        {log.response && (
                          <div>
                            <div className="text-[10px] text-slate-400 mb-1">Response Body</div>
                            <pre className="p-2 bg-slate-900 rounded border border-slate-800 text-emerald-400 max-h-48 overflow-y-auto whitespace-pre-wrap">
                              {JSON.stringify(log.response, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
