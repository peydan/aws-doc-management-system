import { useState, useEffect, useRef } from 'react';
import { ApiClient, DocumentRecord } from '@/api/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Search, FileText, Eye, Loader2, Archive, RotateCcw, Filter } from 'lucide-react';

interface SearchExplorerProps {
  onSelectDocument: (docId: string) => void;
  onEditMetadata: (doc: DocumentRecord) => void;
}

function resolveFormat(doc: DocumentRecord): string {
  if (doc.format && doc.format.trim()) {
    return doc.format.trim().toUpperCase();
  }
  const ext = doc.filename.split('.').pop();
  if (ext && ext !== doc.filename) {
    return ext.toUpperCase();
  }
  if (doc.content_type) {
    const ct = doc.content_type.toLowerCase();
    if (ct.includes('pdf')) return 'PDF';
    if (ct.includes('word') || ct.includes('officedocument')) return 'DOCX';
    if (ct.includes('tiff')) return 'TIFF';
    if (ct.includes('png')) return 'PNG';
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'JPEG';
  }
  return 'FILE';
}

function getFormatBadge(doc: DocumentRecord) {
  const fmt = resolveFormat(doc);
  switch (fmt) {
    case 'PDF':
      return (
        <Badge variant="destructive" className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5">
          PDF
        </Badge>
      );
    case 'DOCX':
    case 'DOC':
      return (
        <Badge variant="info" className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5">
          {fmt}
        </Badge>
      );
    case 'PNG':
    case 'JPEG':
    case 'JPG':
      return (
        <Badge variant="success" className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5">
          {fmt}
        </Badge>
      );
    case 'TIFF':
    case 'TIF':
      return (
        <Badge variant="warning" className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5">
          {fmt}
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5">
          {fmt}
        </Badge>
      );
  }
}

export function SearchExplorer({ onSelectDocument, onEditMetadata }: SearchExplorerProps) {
  // Query fields
  const [query, setQuery] = useState<string>('');
  const [docClass, setDocClass] = useState<string>('');
  const [customerId, setCustomerId] = useState<string>('');
  const [docType, setDocType] = useState<string>('');
  const [loanNumber, setLoanNumber] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ACTIVE');
  const [pageSize, setPageSize] = useState<number>(25);

  // Results
  const [results, setResults] = useState<DocumentRecord[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [tookMs, setTookMs] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Batch Multi-Select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [includeMetaZip, setIncludeMetaZip] = useState<boolean>(true);
  const [batchLoading, setBatchLoading] = useState<boolean>(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const executeSearch = async (overrides?: {
    docClass?: string;
    customerId?: string;
    docType?: string;
    loanNumber?: string;
    statusFilter?: string;
    query?: string;
  }) => {
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setLoading(true);
    setError(null);
    setSelectedIds(new Set());
    setBatchMessage(null);

    const cClass = overrides?.docClass !== undefined ? overrides.docClass : docClass;
    const cCust = overrides?.customerId !== undefined ? overrides.customerId : customerId;
    const cType = overrides?.docType !== undefined ? overrides.docType : docType;
    const cLoan = overrides?.loanNumber !== undefined ? overrides.loanNumber : loanNumber;
    const cStatus = overrides?.statusFilter !== undefined ? overrides.statusFilter : statusFilter;
    const cQ = overrides?.query !== undefined ? overrides.query : query;

    const t0 = performance.now();
    try {
      const data = await ApiClient.searchDocuments({
        q: cQ.trim() || undefined,
        document_class: cClass || undefined,
        customer_id: cCust.trim() || undefined,
        status: cStatus,
        limit: pageSize,
      });

      if (controller.signal.aborted) return;

      let items = data.items || [];
      if (cType.trim()) {
        items = items.filter((d) => (d.document_type || '').toLowerCase().includes(cType.trim().toLowerCase()));
      }
      if (cLoan.trim()) {
        items = items.filter((d) => (d.loan_number || '').toLowerCase().includes(cLoan.trim().toLowerCase()));
      }

      setResults(items);
      setTotal(data.total || items.length);
      setTookMs(Math.round(performance.now() - t0));
    } catch (err: any) {
      if (controller.signal.aborted) return;
      setError(err.message || 'Search execution failed');
      setResults([]);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    executeSearch();
  }, [statusFilter, pageSize]);

  // Quick Preset Handlers
  const applyPreset = (preset: 'all' | 'customer' | 'loan' | 'compliance' | 'security') => {
    if (preset === 'all') {
      setDocClass('');
      setCustomerId('');
      setDocType('');
      setLoanNumber('');
      setStatusFilter('ACTIVE');
      setQuery('');
      executeSearch({ docClass: '', customerId: '', docType: '', loanNumber: '', statusFilter: 'ACTIVE', query: '' });
    } else if (preset === 'customer') {
      setDocClass('');
      setCustomerId('1094827');
      setDocType('');
      setLoanNumber('');
      setQuery('');
      executeSearch({ docClass: '', customerId: '1094827', docType: '', loanNumber: '', statusFilter: 'ACTIVE', query: '' });
    } else if (preset === 'loan') {
      setDocClass('loan_agreement');
      setCustomerId('');
      setDocType('');
      setLoanNumber('');
      setQuery('');
      executeSearch({ docClass: 'loan_agreement', customerId: '', docType: '', loanNumber: '', statusFilter: 'ACTIVE', query: '' });
    } else if (preset === 'compliance') {
      setDocClass('compliance_retention');
      setCustomerId('');
      setDocType('');
      setLoanNumber('');
      setQuery('');
      executeSearch({ docClass: 'compliance_retention', customerId: '', docType: '', loanNumber: '', statusFilter: 'ACTIVE', query: '' });
    } else if (preset === 'security') {
      setDocClass('security_classification');
      setCustomerId('');
      setDocType('');
      setLoanNumber('');
      setQuery('');
      executeSearch({ docClass: 'security_classification', customerId: '', docType: '', loanNumber: '', statusFilter: 'ACTIVE', query: '' });
    }
  };

  // Checkbox helpers
  const handleToggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(results.map((r) => r.document_id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleToggleRow = (docId: string) => {
    const updated = new Set(selectedIds);
    if (updated.has(docId)) {
      updated.delete(docId);
    } else {
      updated.add(docId);
    }
    setSelectedIds(updated);
  };

  const handleDownloadBatchZip = async (format: 'original' | 'pdf') => {
    if (selectedIds.size === 0) return;
    setBatchLoading(true);
    setBatchMessage('Packaging documents into ZIP archive...');
    try {
      const res = await ApiClient.batchDownload(Array.from(selectedIds), format, includeMetaZip);
      setBatchMessage(`ZIP generated (Batch ID: ${res.batch_id})!`);
      window.open(res.download_url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setBatchMessage('Batch ZIP failed: ' + err.message);
    } finally {
      setBatchLoading(false);
    }
  };

  const isAllSelected = results.length > 0 && results.every((r) => selectedIds.has(r.document_id));

  return (
    <div className="space-y-6">
      {/* 1. Quick Presets Bar */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <span className="text-xs text-slate-400 font-semibold flex items-center gap-1">
          <Filter className="w-3.5 h-3.5 text-aws-orange" /> Quick Presets:
        </span>
        <Button variant="secondary" size="sm" onClick={() => applyPreset('all')} className="h-7 text-xs">
          🌐 All Active Docs
        </Button>
        <Button variant="secondary" size="sm" onClick={() => applyPreset('customer')} className="h-7 text-xs">
          👤 Customer 1094827
        </Button>
        <Button variant="secondary" size="sm" onClick={() => applyPreset('loan')} className="h-7 text-xs text-blue-400">
          📑 Loan Agreements
        </Button>
        <Button variant="secondary" size="sm" onClick={() => applyPreset('compliance')} className="h-7 text-xs text-emerald-400">
          ⚖️ Compliance Records
        </Button>
        <Button variant="secondary" size="sm" onClick={() => applyPreset('security')} className="h-7 text-xs text-amber-400">
          🔒 Security Records
        </Button>
      </div>

      {/* 2. Multi-Attribute Filter Grid */}
      <div className="bg-slate-900/80 p-5 rounded-xl border border-slate-800 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Document Class</label>
            <select
              value={docClass}
              onChange={(e) => setDocClass(e.target.value)}
              className="w-full h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-xs text-slate-200"
            >
              <option value="">All Document Classes</option>
              <option value="loan_agreement">loan_agreement</option>
              <option value="compliance_retention">compliance_retention</option>
              <option value="security_classification">security_classification</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Customer ID</label>
            <Input
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="e.g. 1094827"
              className="h-9 bg-slate-950 border-slate-700 text-xs font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Document Type</label>
            <Input
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              placeholder="e.g. SIGNED_AGREEMENT, FINANCIAL_LEDGER"
              className="h-9 bg-slate-950 border-slate-700 text-xs font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Loan Number</label>
            <Input
              value={loanNumber}
              onChange={(e) => setLoanNumber(e.target.value)}
              placeholder="e.g. LN-TEST-921243"
              className="h-9 bg-slate-950 border-slate-700 text-xs font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Status Filter</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-xs text-slate-200"
            >
              <option value="ACTIVE">ACTIVE Only</option>
              <option value="SOFT_DELETED">SOFT_DELETED Only</option>
              <option value="ALL">ALL (Active + Soft Deleted)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Page Size</label>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="w-full h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-xs text-slate-200"
            >
              <option value={10}>10 records</option>
              <option value={20}>20 records</option>
              <option value={50}>50 records</option>
            </select>
          </div>
        </div>

        {/* Freeform Search Query Input */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && executeSearch()}
            placeholder="Search by UUID, customer ID, loan number, or filename..."
            className="pl-9 h-10 bg-slate-950 border-slate-700 text-xs"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-2">
            <Button
              onClick={() => executeSearch()}
              disabled={loading}
              className="h-9 px-5 gap-2 bg-aws-orange hover:bg-aws-orangeHover text-slate-950 font-bold"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Execute Query
            </Button>
            <Button
              variant="outline"
              onClick={() => applyPreset('all')}
              className="h-9 gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset All
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Found <strong className="text-white">{total}</strong> documents</span>
            {tookMs !== undefined && <span className="font-mono text-slate-500">({tookMs}ms)</span>}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-950/20 border border-red-800/40 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* 3. Batch Selection Toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-blue-950/40 border border-blue-800/60 rounded-xl">
          <div className="flex items-center gap-3">
            <Badge variant="primary" className="text-xs">
              {selectedIds.size} selected
            </Badge>
            <span className="text-xs text-slate-300">Selected for multi-document batch ZIP export</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-300 flex items-center gap-1.5 cursor-pointer mr-2">
              <input
                type="checkbox"
                checked={includeMetaZip}
                onChange={(e) => setIncludeMetaZip(e.target.checked)}
              />
              Include Metadata JSON
            </label>
            <Button
              size="sm"
              onClick={() => handleDownloadBatchZip('original')}
              disabled={batchLoading}
              className="h-8 text-xs gap-1.5 bg-aws-orange text-slate-950 font-bold"
            >
              <Archive className="w-3.5 h-3.5" /> Download ZIP (Original)
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleDownloadBatchZip('pdf')}
              disabled={batchLoading}
              className="h-8 text-xs gap-1.5 text-blue-300"
            >
              📄 Download ZIP (as PDF)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
              className="h-8 text-xs text-red-400 hover:text-red-300"
            >
              ✕ Clear
            </Button>
          </div>
        </div>
      )}

      {batchMessage && (
        <div className="p-2.5 bg-aws-orange/10 border border-aws-orange/30 rounded-lg text-aws-orange text-xs">
          {batchMessage}
        </div>
      )}

      {/* 4. Results Table with Checkboxes */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-center">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={(e) => handleToggleSelectAll(e.target.checked)}
                title="Select all on this page"
                aria-label="Select all documents on this page"
              />
            </TableHead>
            <TableHead>Document / Filename</TableHead>
            <TableHead className="w-20">Format</TableHead>
            <TableHead>Class & Type</TableHead>
            <TableHead>Customer / Loan</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Version</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-12 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-aws-orange" />
                Querying OpenSearch Serverless...
              </TableCell>
            </TableRow>
          ) : results.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-12 text-slate-500">
                No documents found matching the filter criteria.
              </TableCell>
            </TableRow>
          ) : (
            results.map((doc) => {
              const isSoftDeleted = doc.status === 'SOFT_DELETED';
              const isSelected = selectedIds.has(doc.document_id);
              return (
                <TableRow
                  key={doc.document_id}
                  className={`hover:bg-slate-800/40 cursor-pointer ${isSelected ? 'bg-slate-800/60' : ''}`}
                >
                  <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleRow(doc.document_id)}
                      aria-label={`Select document ${doc.filename}`}
                    />
                  </TableCell>

                  <TableCell onClick={() => onSelectDocument(doc.document_id)}>
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-aws-orange shrink-0" />
                      <div>
                        <div className="font-medium text-slate-200 hover:text-aws-orange transition-colors text-xs">
                          {doc.filename}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {doc.document_id.slice(0, 18)}...
                        </div>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell onClick={() => onSelectDocument(doc.document_id)}>
                    {getFormatBadge(doc)}
                  </TableCell>

                  <TableCell onClick={() => onSelectDocument(doc.document_id)}>
                    <div className="text-xs font-medium text-slate-300">{doc.document_class}</div>
                    <div className="text-[11px] text-slate-500">{doc.document_type || '—'}</div>
                  </TableCell>

                  <TableCell onClick={() => onSelectDocument(doc.document_id)}>
                    <div className="text-xs font-mono text-slate-300">
                      {doc.customer_id ? `Cust: ${doc.customer_id}` : '—'}
                    </div>
                    {doc.loan_number && (
                      <div className="text-[10px] font-mono text-aws-orange">{doc.loan_number}</div>
                    )}
                  </TableCell>

                  <TableCell onClick={() => onSelectDocument(doc.document_id)}>
                    <Badge variant={isSoftDeleted ? 'destructive' : 'success'} className="text-[10px]">
                      {doc.status}
                    </Badge>
                  </TableCell>

                  <TableCell onClick={() => onSelectDocument(doc.document_id)}>
                    <span className="font-mono text-xs text-slate-400">
                      v{doc.application_version} (r{doc.metadata_revision})
                    </span>
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectDocument(doc.document_id);
                        }}
                        className="h-8 px-2 text-xs text-slate-300 hover:text-white"
                      >
                        <Eye className="w-3.5 h-3.5 mr-1 text-aws-orange" /> Preview
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditMetadata(doc);
                        }}
                        className="h-8 px-2 text-xs text-slate-300 hover:text-white"
                      >
                        ✏️ Edit
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
