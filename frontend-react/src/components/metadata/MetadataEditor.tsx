import { useState, useEffect } from 'react';
import { ApiClient, DocumentRecord } from '@/api/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Lock, Save, AlertTriangle, CheckCircle2, RefreshCw, Loader2, Sparkles, Code, LayoutGrid } from 'lucide-react';

interface MetadataEditorProps {
  document: DocumentRecord | null;
  onSaved?: (updatedDoc: DocumentRecord) => void;
  onRefresh?: () => void;
}

const DEFAULT_CHANGES_JSON = JSON.stringify(
  {
    approval_status: 'APPROVED',
    underwriter_id: 'UW-4029',
    approved_amount: 1450000,
    notes: 'Fast-tracked corporate loan underwriter approval.',
  },
  null,
  2
);

export function MetadataEditor({ document, onSaved, onRefresh }: MetadataEditorProps) {
  const [docId, setDocId] = useState<string>(document?.document_id || '');
  const [doc, setDoc] = useState<DocumentRecord | null>(document);
  const [expectedRev, setExpectedRev] = useState<number>(document?.metadata_revision || 1);
  const [editorMode, setEditorMode] = useState<'json' | 'form'>('json');
  const [changesJson, setChangesJson] = useState<string>(DEFAULT_CHANGES_JSON);
  const [editableFields, setEditableFields] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState<boolean>(false);
  const [fetchingDoc, setFetchingDoc] = useState<boolean>(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [liveResponse, setLiveResponse] = useState<string>('Submit a patch to observe atomic revision increments.');

  useEffect(() => {
    if (document) {
      setDoc(document);
      setDocId(document.document_id);
      setExpectedRev(document.metadata_revision);

      const mutable: Record<string, any> = {};
      if (document.customer_id !== undefined) mutable.customer_id = document.customer_id;
      if (document.loan_number !== undefined) mutable.loan_number = document.loan_number;
      if (document.loan_amount_minor_units !== undefined) {
        mutable.loan_amount = (document.loan_amount_minor_units / 100).toString();
      }
      if (document.currency !== undefined) mutable.currency = document.currency;
      if (document.confidentiality_tier !== undefined) mutable.confidentiality_tier = document.confidentiality_tier;
      if (document.retention_schedule_code !== undefined) mutable.retention_schedule_code = document.retention_schedule_code;
      if (document.legal_hold_active !== undefined) mutable.legal_hold_active = document.legal_hold_active;
      if (document.regulatory_framework !== undefined) mutable.regulatory_framework = document.regulatory_framework;
      setEditableFields(mutable);
    }
  }, [document]);

  const handleFetchDoc = async () => {
    if (!docId.trim()) return;
    setFetchingDoc(true);
    setConflictError(null);
    try {
      const fetched = await ApiClient.getDocument(docId.trim());
      setDoc(fetched);
      setExpectedRev(fetched.metadata_revision);
      setLiveResponse(JSON.stringify(fetched, null, 2));
    } catch (err: any) {
      setConflictError(err.message || 'Failed to fetch document');
      setLiveResponse(JSON.stringify({ error: err.message, status: err.status }, null, 2));
    } finally {
      setFetchingDoc(false);
    }
  };

  const handleApplyPatch = async (overrideRev?: number) => {
    const targetDocId = docId.trim() || doc?.document_id;
    if (!targetDocId) {
      setConflictError('Please specify a target Document ID');
      return;
    }

    const revToUse = overrideRev !== undefined ? overrideRev : expectedRev;
    let payloadChanges: Record<string, any> = {};

    if (editorMode === 'json') {
      try {
        payloadChanges = JSON.parse(changesJson);
      } catch (err: any) {
        setConflictError(`Invalid JSON in metadata changes: ${err.message}`);
        return;
      }
    } else {
      payloadChanges = { ...editableFields };
      if (payloadChanges.loan_amount !== undefined) {
        payloadChanges.loan_amount_minor_units = Math.round(parseFloat(payloadChanges.loan_amount) * 100);
        delete payloadChanges.loan_amount;
      }
      if (payloadChanges.customer_id !== undefined) {
        payloadChanges.customer_id = parseInt(payloadChanges.customer_id, 10);
      }
    }

    setSaving(true);
    setConflictError(null);
    setSuccessMessage(null);

    try {
      const updated = await ApiClient.updateMetadata(targetDocId, payloadChanges, revToUse);
      setDoc(updated);
      setExpectedRev(updated.metadata_revision);
      setLiveResponse(JSON.stringify(updated, null, 2));
      setSuccessMessage(`Metadata successfully updated to revision ${updated.metadata_revision}!`);
      if (onSaved) onSaved(updated);
    } catch (err: any) {
      const respObj = err.body || { message: err.message, status: err.status };
      setLiveResponse(`PATCH ERROR [${err.status || 500}]:\n${JSON.stringify(respObj, null, 2)}`);
      if (err.status === 409) {
        setConflictError(
          `Optimistic Concurrency Conflict (HTTP 409): The document was modified concurrently! Expected revision was ${revToUse}, but server state differs.`
        );
      } else {
        setConflictError(err.message || 'Failed to update metadata');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSimulateConflict = () => {
    setExpectedRev(999);
    handleApplyPatch(999);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            ✏️ Optimistic Locking Metadata &amp; Concurrency Editor
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Mutates S3 Object Annotations atomically with DynamoDB OCC (<code className="text-aws-orange">current_metadata_revision = :expected</code>)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={editorMode === 'json' ? 'default' : 'outline'}
            onClick={() => setEditorMode('json')}
            className="text-xs gap-1.5"
          >
            <Code className="w-3.5 h-3.5" /> Freeform JSON Patch
          </Button>
          <Button
            size="sm"
            variant={editorMode === 'form' ? 'default' : 'outline'}
            onClick={() => setEditorMode('form')}
            className="text-xs gap-1.5"
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Visual Form Fields
          </Button>
        </div>
      </div>

      {/* Target Document & Revision Controls */}
      <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-slate-300">Target Document ID (UUIDv4)</label>
            <div className="flex gap-2 mt-1">
              <Input
                value={docId}
                onChange={(e) => setDocId(e.target.value)}
                placeholder="Target Document UUID (e.g. 550e8400-e29b-41d4-a716-446655440000)"
                className="bg-slate-950 border-slate-700 font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleFetchDoc}
                disabled={fetchingDoc || !docId.trim()}
                className="gap-1.5 shrink-0 text-xs"
              >
                {fetchingDoc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Load Document
              </Button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300">Expected Revision (Atomic OCC Check)</label>
            <Input
              type="number"
              value={expectedRev}
              onChange={(e) => setExpectedRev(parseInt(e.target.value, 10) || 1)}
              min={1}
              className="bg-slate-950 border-slate-700 font-mono text-xs mt-1"
            />
          </div>
        </div>

        {doc && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800/80 text-xs">
            <span className="text-slate-400">Loaded:</span>
            <Badge variant="outline" className="font-mono text-slate-300">Class: {doc.document_class}</Badge>
            <Badge variant="outline" className="font-mono text-slate-300">App Version: v{doc.application_version}</Badge>
            <Badge variant="primary" className="font-mono">Current Rev: rev {doc.metadata_revision}</Badge>
            <Badge variant={doc.status === 'ACTIVE' ? 'success' : 'destructive'} className="font-mono">{doc.status}</Badge>
          </div>
        )}
      </div>

      {conflictError && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertTitle>Concurrency Conflict / Error</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{conflictError}</p>
            {onRefresh && (
              <Button size="sm" variant="outline" onClick={onRefresh} className="gap-1 mt-2 text-xs">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh Document
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {successMessage && (
        <Alert variant="success">
          <CheckCircle2 className="w-4 h-4" />
          <AlertTitle>Update Committed</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Editor Controls */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span className="flex items-center gap-2 text-aws-orange uppercase tracking-wider">
                  <span>⚡</span> {editorMode === 'json' ? 'Metadata Changes (JSON Patch)' : 'Mutable Domain Metadata'}
                </span>
                {editorMode === 'json' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setChangesJson(DEFAULT_CHANGES_JSON)}
                    className="text-[11px] h-7 gap-1 text-slate-400 hover:text-slate-200"
                  >
                    <Sparkles className="w-3 h-3 text-aws-orange" /> Reset Sample
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              {editorMode === 'json' ? (
                <div>
                  <textarea
                    value={changesJson}
                    onChange={(e) => setChangesJson(e.target.value)}
                    rows={12}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-emerald-300 focus:outline-none focus:ring-1 focus:ring-aws-orange"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Provide a JSON object with fields to update/merge. Immutable fields (e.g. <code>document_id</code>, <code>s3_version_id</code>) are automatically protected.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-slate-300 font-medium">Customer ID</label>
                    <Input
                      type="number"
                      value={editableFields.customer_id ?? ''}
                      onChange={(e) => setEditableFields((prev) => ({ ...prev, customer_id: e.target.value }))}
                      className="bg-slate-950 border-slate-700 font-mono text-xs mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-slate-300 font-medium">Loan Number</label>
                    <Input
                      type="text"
                      value={editableFields.loan_number ?? ''}
                      onChange={(e) => setEditableFields((prev) => ({ ...prev, loan_number: e.target.value }))}
                      placeholder="e.g. LN-2026-88821"
                      className="bg-slate-950 border-slate-700 font-mono text-xs mt-1"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-slate-300 font-medium">Loan Amount (Major Units)</label>
                      <Input
                        type="number"
                        value={editableFields.loan_amount ?? ''}
                        onChange={(e) => setEditableFields((prev) => ({ ...prev, loan_amount: e.target.value }))}
                        placeholder="e.g. 450000"
                        className="bg-slate-950 border-slate-700 font-mono text-xs mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-medium">Currency</label>
                      <Input
                        type="text"
                        value={editableFields.currency ?? 'ILS'}
                        onChange={(e) => setEditableFields((prev) => ({ ...prev, currency: e.target.value }))}
                        className="bg-slate-950 border-slate-700 font-mono text-xs mt-1"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-slate-300 font-medium">Retention Schedule Code</label>
                    <Input
                      type="text"
                      value={editableFields.retention_schedule_code ?? ''}
                      onChange={(e) => setEditableFields((prev) => ({ ...prev, retention_schedule_code: e.target.value }))}
                      placeholder="e.g. RET-FIN-001"
                      className="bg-slate-950 border-slate-700 font-mono text-xs mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-slate-300 font-medium">Regulatory Framework</label>
                    <select
                      value={editableFields.regulatory_framework ?? 'SOX'}
                      onChange={(e) => setEditableFields((prev) => ({ ...prev, regulatory_framework: e.target.value }))}
                      className="w-full h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-xs text-slate-200 mt-1"
                    >
                      <option value="SOX">SOX</option>
                      <option value="GDPR">GDPR</option>
                      <option value="BASEL_III">BASEL_III</option>
                      <option value="LOCAL_BANKING_REG">LOCAL_BANKING_REG</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  onClick={() => handleApplyPatch()}
                  disabled={saving || (!docId.trim() && !doc)}
                  className="flex-1 gap-2 bg-aws-orange hover:bg-aws-orangeHover text-slate-950 font-bold text-xs"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Apply Metadata Patch (PATCH)
                </Button>
                <Button
                  variant="outline"
                  onClick={handleSimulateConflict}
                  disabled={saving || (!docId.trim() && !doc)}
                  className="text-amber-400 border-amber-500/40 hover:bg-amber-500/10 text-xs shrink-0"
                >
                  ⚠️ Simulate Conflict (409)
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Live Operation Response & Immutable Core Traits */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center justify-between text-slate-300">
                <span>Live Operation Response</span>
                <Badge variant="outline" className="text-[10px] font-mono">DynamoDB OCC Check</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-slate-200 h-[260px] overflow-y-auto whitespace-pre-wrap">
                {liveResponse}
              </pre>
            </CardContent>
          </Card>

          {doc && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold flex items-center gap-2 text-slate-400 uppercase tracking-wider">
                  <Lock className="w-3.5 h-3.5 text-amber-500" /> Immutable Core Traits (WORM Source)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-800/60 font-mono text-[11px]">
                  <span className="text-slate-400">Document Class:</span>
                  <span className="text-slate-200">{doc.document_class}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60 font-mono text-[11px]">
                  <span className="text-slate-400">Original Filename:</span>
                  <span className="text-slate-200">{doc.filename}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60 font-mono text-[11px]">
                  <span className="text-slate-400">Content Checksum:</span>
                  <span className="text-slate-400 truncate max-w-[240px]">{doc.content_checksum || 'sha256:unknown'}</span>
                </div>
                <div className="flex justify-between py-1 font-mono text-[11px]">
                  <span className="text-slate-400">Created At:</span>
                  <span className="text-slate-300">{new Date(doc.created_at).toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

