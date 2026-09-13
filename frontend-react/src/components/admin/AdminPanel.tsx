import { useState } from 'react';
import { ApiClient } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Archive, RotateCcw, Trash2, Download, Shield, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

export function AdminPanel() {
  const { primaryRole, roles } = useAuth();
  const [docIdInput, setDocIdInput] = useState<string>('');
  const [batchIdsInput, setBatchIdsInput] = useState<string>('');
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const isAdmin = roles?.includes('Document.Admin') || primaryRole === 'Document.Admin';

  const handleSoftDelete = async () => {
    if (!docIdInput.trim()) return;
    setLoading(true);
    setActionStatus(null);
    setActionError(null);
    try {
      await ApiClient.softDeleteDocument(docIdInput.trim());
      setActionStatus(`Document ${docIdInput.trim()} was successfully marked as SOFT_DELETED and hidden from search.`);
      setDocIdInput('');
    } catch (err: any) {
      setActionError(err.message || 'Soft delete failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!docIdInput.trim()) return;
    setLoading(true);
    setActionStatus(null);
    setActionError(null);
    try {
      const restored = await ApiClient.restoreDocument(docIdInput.trim());
      setActionStatus(`Document ${restored.document_id} was successfully restored to ACTIVE status.`);
      setDocIdInput('');
    } catch (err: any) {
      setActionError(err.message || 'Restore failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBatchDownload = async () => {
    const ids = batchIdsInput
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      setActionError('Please specify at least one document ID for batch ZIP packaging.');
      return;
    }

    setLoading(true);
    setActionStatus(null);
    setActionError(null);
    try {
      const res = await ApiClient.batchDownload(ids);
      setActionStatus(`Batch ZIP export bundle generated! (Batch ID: ${res.batch_id})`);
      window.open(res.download_url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setActionError(err.message || 'Batch export failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-400" /> Document Lifecycle Operations &amp; Admin Controls
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Restricted operations requiring <code className="text-aws-orange">Document.Admin</code> role privileges
          </p>
        </div>

        <Badge variant={isAdmin ? 'success' : 'destructive'} className="text-xs font-semibold">
          {isAdmin ? 'Admin Clearance Granted' : 'Restricted: Document.Admin Required'}
        </Badge>
      </div>

      {actionStatus && (
        <Alert variant="success">
          <CheckCircle2 className="w-4 h-4" />
          <AlertTitle>Action Complete</AlertTitle>
          <AlertDescription>{actionStatus}</AlertDescription>
        </Alert>
      )}

      {actionError && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Document Lifecycle Card */}
        <Card className="border-red-900/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-red-400">
              <Trash2 className="w-4 h-4" /> Soft Delete &amp; Restore Lifecycle
            </CardTitle>
            <p className="text-xs text-slate-400 mt-0.5">
              Soft-deleted documents are hidden from search and viewer, but preserved in immutable WORM S3 storage.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            <div>
              <label htmlFor="admin-target-doc-id" className="text-slate-300 font-medium">Target Document ID (UUIDv4)</label>
              <Input
                id="admin-target-doc-id"
                value={docIdInput}
                onChange={(e) => setDocIdInput(e.target.value)}
                placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                className="bg-slate-950 border-slate-700 font-mono mt-1 text-xs"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleSoftDelete}
                disabled={loading || !docIdInput.trim() || !isAdmin}
                className="flex-1 gap-1.5 text-xs"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Soft Delete
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRestore}
                disabled={loading || !docIdInput.trim() || !isAdmin}
                className="flex-1 gap-1.5 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                Restore Document
              </Button>
            </div>

            {!isAdmin && (
              <p className="text-[11px] text-amber-400">
                ⚠️ Your active role is not <code>Document.Admin</code>. Lifecycle mutations will be rejected by the server.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Batch ZIP Export Card */}
        <Card className="border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-white">
              <Archive className="w-4 h-4 text-aws-orange" /> Batch Multi-Document ZIP Export
            </CardTitle>
            <p className="text-xs text-slate-400 mt-0.5">
              Package multiple canonical binaries and manifest.json into an on-demand transient ZIP archive.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            <div>
              <label htmlFor="admin-batch-doc-ids" className="text-slate-300 font-medium">Document IDs (Comma or newline separated)</label>
              <textarea
                id="admin-batch-doc-ids"
                value={batchIdsInput}
                onChange={(e) => setBatchIdsInput(e.target.value)}
                placeholder="550e8400-e29b-41d4-a716-446655440000, 6ba7b810-9dad-11d1-80b4-00c04fd430c8"
                rows={4}
                className="w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-xs font-mono text-slate-200 mt-1 focus:outline-none focus:ring-1 focus:ring-aws-orange"
              />
            </div>
            <Button
              onClick={handleBatchDownload}
              disabled={loading || !batchIdsInput.trim()}
              className="w-full gap-2 bg-aws-orange hover:bg-aws-orangeHover text-slate-950 font-bold text-xs"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Generate &amp; Download ZIP Bundle
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
