import { useEffect, useState } from 'react';
import { ApiClient, DocumentRecord } from '@/api/client';
import { PdfViewer } from './PdfViewer';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Download, FileText, Hash, RotateCcw, Trash2, Loader2, Plus, Sparkles, History, Archive } from 'lucide-react';

interface DocumentDetailProps {
  documentId: string;
  onEditMetadata?: (doc: DocumentRecord) => void;
  onRefresh?: () => void;
  onSelectDocId?: (id: string) => void;
  onInspectAudit?: (doc: DocumentRecord) => void;
}

export function DocumentDetail({
  documentId,
  onEditMetadata,
  onRefresh,
  onSelectDocId,
  onInspectAudit,
}: DocumentDetailProps) {
  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  // Versions history
  const [versions, setVersions] = useState<any[]>([]);
  const [selectedVersionNum, setSelectedVersionNum] = useState<number | null>(null);

  // Add pages state
  const [showAddPages, setShowAddPages] = useState<boolean>(false);
  const [donorFile, setDonorFile] = useState<File | null>(null);
  const [donorBase64, setDonorBase64] = useState<string>('');
  const [insertPos, setInsertPos] = useState<'end' | 'start' | 'custom'>('end');
  const [customIndex, setCustomIndex] = useState<number>(0);
  const [pageIndices, setPageIndices] = useState<string>('');
  const [addPagesStatus, setAddPagesStatus] = useState<string | null>(null);

  // Direct UUID input
  const [inputDocId, setInputDocId] = useState<string>(documentId);

  // Batch ZIP export in viewer
  const [showBatchZip, setShowBatchZip] = useState<boolean>(false);
  const [batchIdsText, setBatchIdsText] = useState<string>('');
  const [batchFormat, setBatchFormat] = useState<'original' | 'pdf'>('original');
  const [batchMeta, setBatchMeta] = useState<boolean>(true);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);

  const loadDocument = (id: string, versionId?: string) => {
    setLoading(true);
    setError(null);
    setSelectedVersionNum(null);

    Promise.all([
      ApiClient.getDocument(id, versionId),
      ApiClient.getDownloadUrl(id, versionId),
      ApiClient.getDocumentVersions(id).catch(() => []),
    ])
      .then(([docData, urlData, versData]) => {
        setDoc(docData);
        setDownloadUrl(urlData.download_url);
        setVersions(versData);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load document');
        setLoading(false);
      });
  };

  useEffect(() => {
    setInputDocId(documentId);
    loadDocument(documentId);
  }, [documentId]);

  const handleFetchCustomId = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputDocId.trim()) return;
    if (onSelectDocId) onSelectDocId(inputDocId.trim());
    loadDocument(inputDocId.trim());
  };

  const handleInspectVersion = async (verNum: number, s3VerId: string) => {
    setSelectedVersionNum(verNum);
    try {
      const urlData = await ApiClient.getDownloadUrl(doc!.document_id, s3VerId);
      setDownloadUrl(urlData.download_url);
    } catch (err: any) {
      alert('Failed to get download URL for version: ' + err.message);
    }
  };

  const handleDownloadPdf = async () => {
    if (!doc) return;
    try {
      const urlData = await ApiClient.getDownloadUrl(doc.document_id, undefined, 'pdf');
      window.open(urlData.download_url, '_blank');
    } catch (err: any) {
      alert('Failed to generate PDF derivative: ' + err.message);
    }
  };

  const handleSoftDelete = async () => {
    if (!doc || !confirm(`Are you sure you want to soft-delete document ${doc.document_id}?`)) return;
    try {
      setActionLoading(true);
      await ApiClient.softDeleteDocument(doc.document_id);
      loadDocument(doc.document_id);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!doc) return;
    try {
      setActionLoading(true);
      await ApiClient.restoreDocument(doc.document_id);
      loadDocument(doc.document_id);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      alert('Restore failed: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDonorFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      setDonorFile(f);
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setDonorBase64(base64);
      };
      reader.readAsDataURL(f);
    }
  };

  const handleExecuteAddPages = async () => {
    if (!doc || !donorBase64) {
      alert('Please select a PDF or image file first');
      return;
    }
    setActionLoading(true);
    setAddPagesStatus('Appending pages and committing new version...');
    try {
      const parsedIndices = pageIndices
        ? pageIndices.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
        : undefined;

      const updated = await ApiClient.addPages(doc.document_id, {
        donor_base64: donorBase64,
        insertion_position: insertPos,
        custom_index: insertPos === 'custom' ? customIndex : undefined,
        page_indices: parsedIndices,
      });

      setDoc(updated);
      setAddPagesStatus(`Success! New application version v${updated.application_version} created (Total pages: ${updated.page_count}).`);
      setDonorFile(null);
      setDonorBase64('');
      loadDocument(doc.document_id);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setAddPagesStatus('Error: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleExecuteBatchZip = async () => {
    const ids = batchIdsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      alert('Please enter at least one document ID');
      return;
    }
    setActionLoading(true);
    setBatchStatus('Generating batch ZIP archive...');
    try {
      const res = await ApiClient.batchDownload(ids, batchFormat, batchMeta);
      setBatchStatus(`ZIP created (Batch ID: ${res.batch_id})!`);
      window.open(res.download_url, '_blank');
    } catch (err: any) {
      setBatchStatus('Batch ZIP failed: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-aws-orange mb-2" />
        <p className="text-sm">Loading document details, PDF preview, and version lineage...</p>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="space-y-4">
        <form onSubmit={handleFetchCustomId} className="flex gap-2 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
          <Input
            value={inputDocId}
            onChange={(e) => setInputDocId(e.target.value)}
            placeholder="Enter Document ID (UUID)"
            className="flex-1 bg-slate-950 font-mono text-sm"
          />
          <Button type="submit" className="bg-aws-orange text-slate-950 font-bold">
            Fetch Document
          </Button>
        </form>

        <div className="p-8 bg-red-950/20 border border-red-800/40 rounded-xl text-red-400 text-center">
          <p className="font-medium">Document Not Found</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  const isSoftDeleted = doc.status === 'SOFT_DELETED';

  return (
    <div className="space-y-6">
      {/* 1. Top UUID Fetch Bar & Batch ZIP Toggle */}
      <div className="flex flex-col sm:flex-row gap-2 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <form onSubmit={handleFetchCustomId} className="flex flex-1 gap-2">
          <Input
            value={inputDocId}
            onChange={(e) => setInputDocId(e.target.value)}
            placeholder="Enter Document UUID..."
            className="bg-slate-950 font-mono text-sm"
          />
          <Button type="submit" className="bg-aws-orange text-slate-950 font-bold whitespace-nowrap">
            Fetch Document
          </Button>
        </form>
        <Button
          variant="outline"
          onClick={() => setShowBatchZip(!showBatchZip)}
          className="gap-1.5 whitespace-nowrap"
        >
          <Archive className="w-4 h-4 text-aws-orange" />
          {showBatchZip ? 'Hide Batch Export' : '📦 Batch Export as ZIP'}
        </Button>
      </div>

      {/* 2. Collapsible Batch ZIP Export Panel */}
      {showBatchZip && (
        <Card className="border-aws-orange/30 bg-slate-900/90">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Archive className="w-4 h-4 text-aws-orange" /> Multi-Document ZIP Package Studio
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div>
              <label className="text-slate-400 font-medium">Document IDs (comma or newline separated)</label>
              <textarea
                value={batchIdsText}
                onChange={(e) => setBatchIdsText(e.target.value)}
                placeholder="550e8400-e29b-41d4-a716-446655440000, aeb210bb-7259-4d24-9ecc-e48a737fafaf"
                rows={2}
                className="w-full bg-slate-950 border border-slate-700 rounded-md p-2 font-mono text-xs mt-1"
              />
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Format Conversion:</span>
                <select
                  value={batchFormat}
                  onChange={(e) => setBatchFormat(e.target.value as any)}
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                >
                  <option value="original">Original Format</option>
                  <option value="pdf">Convert to PDF</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={batchMeta}
                  onChange={(e) => setBatchMeta(e.target.checked)}
                />
                Include metadata JSON files
              </label>
              <Button
                size="sm"
                onClick={handleExecuteBatchZip}
                disabled={actionLoading || !batchIdsText.trim()}
                className="bg-aws-orange text-slate-950 font-bold ml-auto"
              >
                ⬇️ Generate & Download ZIP
              </Button>
            </div>
            {batchStatus && <p className="text-aws-orange font-medium mt-1">{batchStatus}</p>}
          </CardContent>
        </Card>
      )}

      {/* 3. 4 Top Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Status</span>
          <div className="mt-1">
            <Badge variant={isSoftDeleted ? 'destructive' : 'success'} className="text-sm font-bold">
              {doc.status}
            </Badge>
          </div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">App Version</span>
          <div className="text-lg font-bold text-slate-100 mt-1">
            v{selectedVersionNum || doc.application_version}
            {selectedVersionNum && selectedVersionNum !== doc.application_version && (
              <span className="text-xs text-amber-400 font-normal ml-1.5">(Historical)</span>
            )}
          </div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Metadata Revision</span>
          <div className="text-lg font-bold text-aws-orange mt-1">rev {doc.metadata_revision}</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Document Class</span>
          <div className="text-sm font-bold text-blue-400 truncate mt-1">{doc.document_class}</div>
        </div>
      </div>

      {/* 4. AI Enrichment & Pipeline Stepper Banner */}
      <Card className="border-l-4 border-l-aws-orange bg-slate-900/70">
        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-aws-orange" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
              🤖 AI Enrichment & Pipeline Status
            </span>
            <Badge variant="success" className="text-[10px]">
              Enriched by Bedrock (Nova 2 Lite)
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] text-emerald-400 font-mono">
              OCC rev {doc.metadata_revision} committed
            </Badge>
            {onInspectAudit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onInspectAudit(doc)}
                className="h-6 text-[10px] px-2 text-purple-300 border-purple-500/30 hover:bg-purple-500/10"
              >
                Inspect Audit Trail ➔
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-3 space-y-3">
          {/* Stepper */}
          <div className="flex flex-wrap items-center gap-2 p-2 bg-slate-950/60 rounded-lg text-[11px] font-mono">
            <Badge variant="success" className="text-[10px]">✓ 1. Ingestion</Badge>
            <span className="text-slate-600">──►</span>
            <Badge variant="info" className="text-[10px]">✓ 2. SQS Dispatched</Badge>
            <span className="text-slate-600">──►</span>
            <Badge variant="info" className="text-[10px]">✓ 3. Bedrock Scanned</Badge>
            <span className="text-slate-600">──►</span>
            <Badge variant="success" className="text-[10px]">✓ 4. Rev 2 Committed</Badge>
          </div>

          {/* PII Discovery & Safety Ratchet */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">PII Status:</span>
              <Badge variant={doc.contains_pii ? 'warning' : 'success'} className="text-[11px]">
                {doc.contains_pii ? '⚠️ PII DETECTED' : '🛡️ NO PII'}
              </Badge>
              {doc.pii_categories && doc.pii_categories.length > 0 && (
                <div className="flex gap-1">
                  {doc.pii_categories.map((cat: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-[10px] font-mono">
                      {cat}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <span className="text-slate-500 text-[11px]">
              Model: <strong className="text-slate-300 font-mono">amazon.nova-lite-v1:0</strong>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 5. Main Grid: Viewer + S3 Metadata Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: PDF Preview + Add Pages */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4 text-aws-orange" /> In-Browser Document Preview ({doc.filename})
              </CardTitle>
              <div className="flex gap-2">
                {downloadUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(downloadUrl, '_blank')}
                    className="h-8 text-xs gap-1"
                  >
                    <Download className="w-3.5 h-3.5" /> Original
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleDownloadPdf}
                  className="h-8 text-xs gap-1 text-aws-orange border-aws-orange/30 hover:bg-aws-orange/10"
                >
                  📄 Download as PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-2">
              {downloadUrl && (doc.format === 'pdf' || doc.content_type === 'application/pdf') ? (
                <PdfViewer url={downloadUrl} />
              ) : (
                <div className="p-12 text-center text-slate-400 bg-slate-950/40 rounded-lg">
                  <p className="font-semibold text-slate-200">Non-PDF Binary ({doc.format})</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Click "Download as PDF" above to generate an on-demand PDF derivative, or "Original" to download.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Add Pages to PDF Studio Card */}
          <Card className="border-slate-800">
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between cursor-pointer" onClick={() => setShowAddPages(!showAddPages)}>
              <CardTitle className="text-sm flex items-center gap-2 text-slate-200">
                <Plus className="w-4 h-4 text-emerald-400" /> ➕ Add / Append Pages to PDF (Authoritative Binary Mutation)
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-7 text-xs">
                {showAddPages ? '▲ Hide' : '▼ Show'}
              </Button>
            </CardHeader>
            {showAddPages && (
              <CardContent className="pt-0 px-4 pb-4 space-y-4 text-xs border-t border-slate-800/60 mt-2">
                <div>
                  <label className="text-slate-300 font-medium">Select Donor File (PDF, PNG, JPEG)</label>
                  <Input
                    type="file"
                    accept=".pdf,image/png,image/jpeg"
                    onChange={handleDonorFileChange}
                    className="bg-slate-950 border-slate-700 text-xs mt-1"
                  />
                  {donorFile && (
                    <p className="text-emerald-400 text-[11px] mt-1">
                      Selected: {donorFile.name} ({(donorFile.size / 1024).toFixed(1)} KB)
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-300 font-medium">Insertion Position</label>
                    <select
                      value={insertPos}
                      onChange={(e) => setInsertPos(e.target.value as any)}
                      className="w-full h-9 rounded bg-slate-950 border border-slate-700 px-2 text-xs text-slate-200 mt-1"
                    >
                      <option value="end">At the End (Append)</option>
                      <option value="start">At the Beginning (Prepend)</option>
                      <option value="custom">Specific Page Index (0-indexed)</option>
                    </select>
                  </div>
                  {insertPos === 'custom' && (
                    <div>
                      <label className="text-slate-300 font-medium">Custom Page Index (0 = before 1st)</label>
                      <Input
                        type="number"
                        value={customIndex}
                        onChange={(e) => setCustomIndex(parseInt(e.target.value, 10))}
                        min={0}
                        className="bg-slate-950 border-slate-700 text-xs mt-1"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-slate-300 font-medium">Page Selection (Optional for PDF donors)</label>
                  <Input
                    type="text"
                    value={pageIndices}
                    onChange={(e) => setPageIndices(e.target.value)}
                    placeholder="e.g. 0, 2 (comma-separated, leave blank for all)"
                    className="bg-slate-950 border-slate-700 text-xs mt-1"
                  />
                </div>

                <Button
                  onClick={handleExecuteAddPages}
                  disabled={actionLoading || !donorBase64}
                  className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add Pages & Create New Version
                </Button>
                {addPagesStatus && <p className="text-slate-300 text-xs mt-1">{addPagesStatus}</p>}
              </CardContent>
            )}
          </Card>
        </div>

        {/* Right 1 Col: Version History + Metadata JSON + Actions */}
        <div className="space-y-6">
          {/* Actions Bar */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-3 flex flex-wrap gap-2">
              {onEditMetadata && !isSoftDeleted && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onEditMetadata(doc)}
                  className="text-xs flex-1 gap-1"
                >
                  ✏️ Edit Metadata
                </Button>
              )}
              {isSoftDeleted ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleRestore}
                  disabled={actionLoading}
                  className="text-xs flex-1 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Restore
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleSoftDelete}
                  disabled={actionLoading}
                  className="text-xs flex-1 gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Soft Delete
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Application Version History Table */}
          <Card>
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-aws-orange" /> Version Lineage
              </CardTitle>
              <Badge variant="outline" className="text-[10px] font-mono">
                {versions.length} versions
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs py-2">Ver</TableHead>
                    <TableHead className="text-xs py-2">Checksum</TableHead>
                    <TableHead className="text-xs py-2 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-4 text-xs text-slate-500">
                        No historical versions loaded
                      </TableCell>
                    </TableRow>
                  ) : (
                    versions.map((v) => (
                      <TableRow key={v.application_version} className="text-xs">
                        <TableCell className="font-bold py-2">
                          v{v.application_version}
                          {v.application_version === doc.application_version && (
                            <span className="text-[10px] text-emerald-400 font-normal ml-1">(current)</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-slate-400 py-2">
                          {(v.content_checksum || '').slice(0, 16)}...
                        </TableCell>
                        <TableCell className="text-right py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleInspectVersion(v.application_version, v.s3_version_id)}
                            className="h-6 px-2 text-[10px] text-aws-orange hover:text-white"
                          >
                            Inspect
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Canonical Traits & Banking Snapshot */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-aws-orange" /> Canonical Attributes
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-3 space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Document ID:</span>
                <span className="font-mono text-[11px] text-slate-200 truncate max-w-[170px]">{doc.document_id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Filename:</span>
                <span className="text-slate-200 font-medium truncate max-w-[170px]">{doc.filename}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Content Length:</span>
                <span className="font-mono text-slate-300">
                  {doc.content_length ? `${(doc.content_length / 1024).toFixed(1)} KB` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Page Count:</span>
                <span className="font-medium text-slate-200">{doc.page_count || 1} pages</span>
              </div>
              {doc.customer_id !== undefined && (
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-400">Customer ID:</span>
                  <span className="font-mono text-slate-200">{doc.customer_id}</span>
                </div>
              )}
              {doc.loan_number && (
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-400">Loan Number:</span>
                  <span className="font-mono text-aws-orange">{doc.loan_number}</span>
                </div>
              )}
              {doc.loan_amount_minor_units !== undefined && (
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-400">Loan Amount:</span>
                  <span className="font-semibold text-emerald-400">
                    {doc.currency || 'ILS'} {(doc.loan_amount_minor_units / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Created:</span>
                <span className="text-slate-300 font-mono text-[11px]">{new Date(doc.created_at).toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>

          {/* S3 Annotations Raw JSON Box */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                🏷️ Full S3 Annotations Payload
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <pre className="p-3 bg-slate-950 rounded-md border border-slate-800 text-[11px] font-mono text-slate-300 max-h-56 overflow-y-auto">
                {JSON.stringify(doc, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
