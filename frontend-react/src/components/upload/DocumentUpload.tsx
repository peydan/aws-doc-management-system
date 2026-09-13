import { useState } from 'react';
import { ApiClient, DocumentRecord } from '@/api/client';
import { CLASS_SPECIFIC_TEMPLATES, SHARED_BASE_TEMPLATE } from '@/generated/templates';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { UploadCloud, FileText, Loader2, AlertTriangle, ArrowRight, Sparkles, RefreshCw, Layers } from 'lucide-react';

interface DocumentUploadProps {
  onUploadSuccess?: (doc: DocumentRecord) => void;
}

export function DocumentUpload({ onUploadSuccess }: DocumentUploadProps) {
  const [activeStudio, setActiveStudio] = useState<'direct' | 'inline'>('direct');
  const [docClass, setDocClass] = useState<string>('loan_agreement');

  // Files
  const [directFile, setDirectFile] = useState<File | null>(null);
  const [inlineFile, setInlineFile] = useState<File | null>(null);
  const [inlineBase64, setInlineBase64] = useState<string>('');

  // Shared & Class Metadata Textareas
  const [sharedMetaJson, setSharedMetaJson] = useState<string>(() => JSON.stringify(SHARED_BASE_TEMPLATE, null, 2));
  const [classMetaJson, setClassMetaJson] = useState<string>(() =>
    JSON.stringify((CLASS_SPECIFIC_TEMPLATES as any)['loan_agreement'] || {}, null, 2)
  );

  // Auto-Enrichment Advisor toggle
  const [autoEnrich, setAutoEnrich] = useState<boolean>(true);

  // AI Paste Text Snippet Modal
  const [showAiModal, setShowAiModal] = useState<boolean>(false);
  const [aiSnippetText, setAiSnippetText] = useState<string>('');
  const [aiSuggesting, setAiSuggesting] = useState<boolean>(false);
  const [aiNotice, setAiNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Upload execution state
  const [uploadStep, setUploadStep] = useState<'idle' | 'initiating' | 'uploading_s3' | 'completing' | 'done'>('idle');
  const [progressText, setProgressText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<any>(null);

  const handleClassChange = (newClass: string) => {
    setDocClass(newClass);
    const defaults = (CLASS_SPECIFIC_TEMPLATES as any)[newClass] || {};
    setClassMetaJson(JSON.stringify(defaults, null, 2));
  };

  const handleResetShared = () => setSharedMetaJson(JSON.stringify(SHARED_BASE_TEMPLATE, null, 2));
  const handleResetClass = () => {
    const defaults = (CLASS_SPECIFIC_TEMPLATES as any)[docClass] || {};
    setClassMetaJson(JSON.stringify(defaults, null, 2));
  };

  const handleFillMockData = () => {
    const mockShared = {
      customer_id: 1094827,
      account_id: { bank_id: 10, branch_id: 802, account_number: 123456 },
      complete_customer_id_code: { id_number: '123456789', id_type: 1 },
      business_area_code: 100,
      business_sub_area_code: 101,
      transaction_id: 'TX-2026-99482',
      document_group_id: 'GRP-FIN-001',
    };
    setSharedMetaJson(JSON.stringify(mockShared, null, 2));

    let mockClass: any = {};
    if (docClass === 'loan_agreement') {
      mockClass = {
        document_type: 'SIGNED_AGREEMENT',
        loan_number: 'LN-' + Math.floor(100000 + Math.random() * 900000),
        loan_amount_minor_units: 75000000,
        currency: 'ILS',
        loan_type: 'MORTGAGE',
        branch_code: 'TLV-05',
        signed_date: new Date().toISOString().split('T')[0],
      };
    } else if (docClass === 'compliance_retention') {
      mockClass = {
        document_type: 'FINANCIAL_LEDGER',
        retention_schedule_code: 'RET-FIN-001',
        retention_period_years: 7,
        regulatory_framework: 'SOX',
        legal_hold_active: false,
        disposal_action: 'REVIEW_REQUIRED',
      };
    } else {
      mockClass = {
        document_type: 'BOARD_RESOLUTION',
        confidentiality_tier: 'RESTRICTED',
        contains_pii: false,
        pii_categories: ['NONE'],
        minimum_clearance_role: 'Document.Reader',
        encryption_requirement: 'SSE_KMS_DEFAULT',
        export_restricted: false,
      };
    }
    setClassMetaJson(JSON.stringify(mockClass, null, 2));
  };

  // AI-Assisted Metadata Pre-Fill Suggestion
  const handleAiExtractFromFile = async (fileToScan: File | null) => {
    if (!fileToScan) {
      setAiNotice({ type: 'error', message: 'Please select a file first before extracting metadata.' });
      return;
    }
    setAiSuggesting(true);
    setAiNotice(null);
    try {
      const isPdf = fileToScan.type === 'application/pdf' || fileToScan.name.toLowerCase().endsWith('.pdf');

      // For text, markdown, CSV, or JSON files: read first 64 KB directly as text
      if (!isPdf && (fileToScan.type.startsWith('text/') || fileToScan.name.match(/\.(txt|json|csv|md)$/i))) {
        const slice = fileToScan.slice(0, 64 * 1024);
        const text = await slice.text();
        const res = await ApiClient.suggestMetadata({
          document_class: docClass,
          filename: fileToScan.name,
          text_snippet: text,
        });
        applyAiSuggestions(res);
        setAiSuggesting(false);
        return;
      }

      // For PDFs or binary documents: slice first 128 KB and send base64
      // This protects against large payload limits and executes in < 1 second!
      const slice = fileToScan.slice(0, 128 * 1024);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const resultStr = reader.result as string;
          const base64 = resultStr.includes(',') ? resultStr.split(',')[1] : resultStr;
          const res = await ApiClient.suggestMetadata({
            document_class: docClass,
            filename: fileToScan.name,
            file_base64: base64,
          });
          applyAiSuggestions(res);
        } catch (e: any) {
          setAiNotice({ type: 'error', message: `AI suggestion error: ${e.message}` });
        } finally {
          setAiSuggesting(false);
        }
      };
      reader.onerror = () => {
        setAiNotice({ type: 'error', message: 'Failed to read the selected file.' });
        setAiSuggesting(false);
      };
      reader.readAsDataURL(slice);
    } catch (err: any) {
      setAiNotice({ type: 'error', message: `AI extraction error: ${err.message}` });
      setAiSuggesting(false);
    }
  };

  const handleAiExtractFromSnippet = async () => {
    if (!aiSnippetText.trim()) return;
    setAiSuggesting(true);
    setAiNotice(null);
    try {
      const res = await ApiClient.suggestMetadata({
        document_class: docClass,
        text_snippet: aiSnippetText.trim(),
      });
      applyAiSuggestions(res);
      setShowAiModal(false);
    } catch (e: any) {
      setAiNotice({ type: 'error', message: `AI snippet suggestion error: ${e.message}` });
    } finally {
      setAiSuggesting(false);
    }
  };

  const applyAiSuggestions = (res: {
    status?: string;
    document_class?: string;
    shared_metadata?: Record<string, any>;
    class_metadata?: Record<string, any>;
    suggestions?: Record<string, any>;
  }) => {
    try {
      let classChanged = false;
      if (res.document_class && res.document_class !== docClass && (CLASS_SPECIFIC_TEMPLATES as any)[res.document_class]) {
        setDocClass(res.document_class);
        classChanged = true;
      }

      if (res.shared_metadata && Object.keys(res.shared_metadata).length > 0) {
        const currShared = JSON.parse(sharedMetaJson || '{}');
        const updatedShared = { ...currShared, ...res.shared_metadata };
        setSharedMetaJson(JSON.stringify(updatedShared, null, 2));
      }

      const classSuggestions = res.class_metadata || res.suggestions || {};
      if (Object.keys(classSuggestions).length > 0) {
        const currClass = JSON.parse(classMetaJson || '{}');
        const updatedClass = { ...currClass, ...classSuggestions };
        setClassMetaJson(JSON.stringify(updatedClass, null, 2));
      }

      const targetClassName = res.document_class || docClass;
      setAiNotice({
        type: 'success',
        message: `✨ Metadata extracted and pre-filled by Amazon Bedrock!${classChanged ? ` (Detected document class: ${targetClassName})` : ''}`,
      });
    } catch (err: any) {
      setAiNotice({ type: 'error', message: `Failed to format suggestions: ${err.message}` });
    }
  };

  const parseCombinedMetadata = (): Record<string, any> => {
    let shared = {};
    let cls = {};
    try {
      shared = JSON.parse(sharedMetaJson || '{}');
    } catch {
      throw new Error('Shared Banking metadata contains invalid JSON syntax');
    }
    try {
      cls = JSON.parse(classMetaJson || '{}');
    } catch {
      throw new Error('Class-Specific metadata contains invalid JSON syntax');
    }
    return {
      ...shared,
      ...cls,
      auto_enrich_enabled: autoEnrich,
    };
  };

  // 1. Direct S3 Upload Handler
  const handleDirectUpload = async () => {
    if (!directFile) {
      setError('Please select a file to upload');
      return;
    }
    setError(null);
    setExecutionResult(null);

    try {
      const payloadMetadata = parseCombinedMetadata();

      setUploadStep('initiating');
      setProgressText('Phase 1: POST /documents/uploads (Generating direct S3 WORM upload ticket)...');

      const { session_id, upload_url, document_id } = await ApiClient.initiateUpload({
        filename: directFile.name,
        content_type: directFile.type || 'application/pdf',
        document_class: docClass,
        metadata: payloadMetadata,
      });

      setUploadStep('uploading_s3');
      setProgressText(`Phase 2: Streaming ${(directFile.size / 1024).toFixed(1)} KB directly to S3 bucket...`);

      const s3PutRes = await fetch(upload_url, {
        method: 'PUT',
        body: directFile,
        headers: { 'Content-Type': directFile.type || 'application/octet-stream' },
      });

      if (!s3PutRes.ok) {
        throw new Error(`Direct S3 upload failed with status ${s3PutRes.status}`);
      }

      setUploadStep('completing');
      setProgressText(`Phase 3: POST /uploads/${session_id}/complete (Committing DynamoDB OCC pointer)...`);

      const completed = await ApiClient.completeUpload(session_id);

      setUploadStep('done');
      setProgressText('Upload successfully committed to WORM S3 and DynamoDB control plane!');
      setExecutionResult({
        operation: 'DIRECT_S3_PRESIGNED_UPLOAD',
        session_id,
        document_id: completed.document_id || document_id,
        application_version: completed.application_version || 1,
        metadata_revision: completed.metadata_revision || 1,
        response: completed,
      });
    } catch (err: any) {
      setError(err.message || 'Direct upload failed');
      setUploadStep('idle');
    }
  };

  // 2. Inline API Upload Handler (<4MB)
  const handleInlineUpload = async () => {
    if (!inlineFile || !inlineBase64) {
      setError('Please select a file to upload');
      return;
    }
    if (inlineFile.size > 4 * 1024 * 1024) {
      setError('File exceeds the 4 MB API Gateway inline payload limit. Please use Direct S3 Upload.');
      return;
    }

    setError(null);
    setExecutionResult(null);

    try {
      const payloadMetadata = parseCombinedMetadata();
      setUploadStep('completing');
      setProgressText('Streaming synchronous Base64 payload to POST /documents...');

      const res = await ApiClient.uploadInline({
        filename: inlineFile.name,
        content_type: inlineFile.type || 'application/pdf',
        document_class: docClass,
        metadata: payloadMetadata,
        file_base64: inlineBase64,
      });

      setUploadStep('done');
      setProgressText('Inline upload succeeded!');
      setExecutionResult({
        operation: 'INLINE_API_GATEWAY_UPLOAD',
        document_id: res.document_id,
        application_version: res.application_version,
        metadata_revision: res.metadata_revision,
        response: res,
      });
    } catch (err: any) {
      setError(err.message || 'Inline upload failed');
      setUploadStep('idle');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Studio Mode Selector */}
      <Tabs value={activeStudio} onValueChange={(v) => setActiveStudio(v as any)} className="w-full">
        <TabsList className="grid grid-cols-2 w-full bg-slate-900 border border-slate-800">
          <TabsTrigger value="direct" className="gap-2">
            <UploadCloud className="w-4 h-4 text-aws-orange" />
            🚀 Direct S3 Presigned Upload (Recommended • up to 500 MB)
          </TabsTrigger>
          <TabsTrigger value="inline" className="gap-2">
            <Layers className="w-4 h-4 text-blue-400" />
            📦 Inline API Gateway Upload (&lt; 4 MB Base64)
          </TabsTrigger>
        </TabsList>

        <div className="mt-4">
          <Card>
            <CardHeader className="py-4 px-6 border-b border-slate-800/80">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    {activeStudio === 'direct' ? '🚀 Direct S3 Presigned Upload Studio' : '📦 Inline API Gateway Upload Studio'}
                  </CardTitle>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {activeStudio === 'direct'
                      ? 'Zero Lambda execution overhead for payload bytes. Client streams directly to S3.'
                      : 'Synchronous single-turn HTTP request with Base64 payload (< 4 MB).'}
                  </p>
                </div>
                <Badge variant={activeStudio === 'direct' ? 'success' : 'warning'}>
                  {activeStudio === 'direct' ? 'Direct S3 WORM' : 'Inline Base64'}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-5">
              {/* Document Class Selector */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Document Class</label>
                <select
                  value={docClass}
                  onChange={(e) => handleClassChange(e.target.value)}
                  className="w-full h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200"
                >
                  <option value="loan_agreement">loan_agreement (Loan Agreement)</option>
                  <option value="compliance_retention">compliance_retention (Compliance & Retention Ledger)</option>
                  <option value="security_classification">security_classification (Security Classification Record)</option>
                </select>
              </div>

              {/* File Dropzone */}
              <TabsContent value="direct" className="mt-0">
                <div className="border-2 border-dashed border-slate-700 hover:border-aws-orange rounded-xl p-6 text-center transition-colors bg-slate-950/40">
                  <input
                    type="file"
                    id="direct-file-input"
                    className="hidden"
                    onChange={(e) => e.target.files && setDirectFile(e.target.files[0])}
                    accept=".pdf,.png,.jpg,.jpeg,.tiff,.docx"
                  />
                  <label htmlFor="direct-file-input" className="cursor-pointer flex flex-col items-center gap-2">
                    <UploadCloud className="w-10 h-10 text-slate-400" />
                    <span className="text-sm font-medium text-slate-200">
                      {directFile ? directFile.name : 'Click to select or drag & drop document'}
                    </span>
                    <span className="text-xs text-slate-500">
                      Supports PDF, TIFF, PNG, JPEG, DOCX up to 500 MB (Direct S3 streaming)
                    </span>
                  </label>
                  {directFile && (
                    <div className="mt-2 text-xs text-aws-orange font-mono">
                      {(directFile.size / 1024).toFixed(1)} KB
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="inline" className="mt-0">
                <div className="border-2 border-dashed border-slate-700 hover:border-blue-400 rounded-xl p-6 text-center transition-colors bg-slate-950/40">
                  <input
                    type="file"
                    id="inline-file-input"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        const f = e.target.files[0];
                        setInlineFile(f);
                        const reader = new FileReader();
                        reader.onload = () => setInlineBase64((reader.result as string).split(',')[1]);
                        reader.readAsDataURL(f);
                      }
                    }}
                  />
                  <label htmlFor="inline-file-input" className="cursor-pointer flex flex-col items-center gap-2">
                    <FileText className="w-10 h-10 text-slate-400" />
                    <span className="text-sm font-medium text-slate-200">
                      {inlineFile ? inlineFile.name : 'Select file for synchronous inline upload'}
                    </span>
                    <span className="text-xs text-slate-500">
                      Strict limit: &lt; 4 MB Base64 payload via REST API Gateway
                    </span>
                  </label>
                  {inlineFile && (
                    <div className="mt-2 text-xs text-blue-400 font-mono">
                      {(inlineFile.size / 1024).toFixed(1)} KB
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* AI-Assisted Metadata Pre-Fill Banner */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-aws-orange/10 border border-aws-orange/30 rounded-xl">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-aws-orange" />
                  <div>
                    <div className="text-xs font-bold text-aws-orange">AI-Assisted Metadata Pre-Fill</div>
                    <div className="text-[11px] text-slate-400">
                      Extract customer ID, loan number, and compliance attributes with Amazon Bedrock before upload
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleAiExtractFromFile(activeStudio === 'direct' ? directFile : inlineFile)}
                    disabled={aiSuggesting}
                    className="h-8 text-xs bg-aws-orange text-slate-950 font-bold"
                  >
                    {aiSuggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '🤖 Extract from File'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAiModal(true)}
                    className="h-8 text-xs"
                  >
                    📋 Paste Text
                  </Button>
                </div>
              </div>

              {/* AI Suggestion Feedback Alert */}
              {aiNotice && (
                <Alert variant={aiNotice.type === 'success' ? 'success' : 'destructive'} className="my-2">
                  <AlertDescription className="text-xs flex items-center justify-between">
                    <span>{aiNotice.message}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAiNotice(null)}
                      className="h-5 px-1 text-[11px] text-slate-400 hover:text-white"
                    >
                      ✕
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {/* Dual Metadata Textareas with Presets */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Left: Shared Banking Traits */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">🌐 Shared Banking Traits</span>
                    <div className="flex gap-1.5">
                      <Button variant="ghost" size="sm" onClick={handleResetShared} className="h-6 text-[10px] px-1.5">
                        <RefreshCw className="w-3 h-3 mr-1" /> Reset
                      </Button>
                      <Button variant="ghost" size="sm" onClick={handleFillMockData} className="h-6 text-[10px] px-1.5 text-aws-orange">
                        ✨ Mock
                      </Button>
                    </div>
                  </div>
                  <textarea
                    value={sharedMetaJson}
                    onChange={(e) => setSharedMetaJson(e.target.value)}
                    rows={6}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-aws-orange"
                  />
                </div>

                {/* Right: Class-Specific Metadata */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">📑 Class-Specific Attributes ({docClass})</span>
                    <div className="flex gap-1.5">
                      <Button variant="ghost" size="sm" onClick={handleResetClass} className="h-6 text-[10px] px-1.5">
                        <RefreshCw className="w-3 h-3 mr-1" /> Reset
                      </Button>
                      <Button variant="ghost" size="sm" onClick={handleFillMockData} className="h-6 text-[10px] px-1.5 text-aws-orange">
                        ✨ Mock
                      </Button>
                    </div>
                  </div>
                  <textarea
                    value={classMetaJson}
                    onChange={(e) => setClassMetaJson(e.target.value)}
                    rows={6}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-aws-orange"
                  />
                </div>
              </div>

              {/* Bedrock AI Advisor Checkbox */}
              <div className="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-base">🤖</span>
                  <span className="text-slate-300 font-medium">Amazon Bedrock AI Auto-Enrichment</span>
                  <span className="text-[11px] text-slate-500">• Triggers asynchronous PII scan & OCC revision bump</span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoEnrich}
                    onChange={(e) => setAutoEnrich(e.target.checked)}
                  />
                  <span className="text-xs text-slate-200 font-semibold">Auto-Enrich Document</span>
                </label>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertTitle>Upload Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {uploadStep !== 'idle' && uploadStep !== 'done' && (
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-center gap-3">
                  <Loader2 className="w-4 h-4 animate-spin text-aws-orange" />
                  <span className="text-xs text-slate-300">{progressText}</span>
                </div>
              )}

              {/* Submit Button */}
              {activeStudio === 'direct' ? (
                <Button
                  onClick={handleDirectUpload}
                  disabled={!directFile || uploadStep !== 'idle'}
                  className="w-full h-11 bg-aws-orange hover:bg-aws-orangeHover text-slate-950 font-bold"
                >
                  🚀 Initiate & Upload Directly to S3
                </Button>
              ) : (
                <Button
                  onClick={handleInlineUpload}
                  disabled={!inlineFile || uploadStep !== 'idle'}
                  className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-bold"
                >
                  📦 Upload via Synchronous Inline API
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </Tabs>

      {/* Execution Response Inspector */}
      {executionResult && (
        <Card className="border-emerald-500/30 bg-slate-900/90">
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400">✅</span>
              <CardTitle className="text-sm">Upload Execution Response</CardTitle>
            </div>
            {onUploadSuccess && (
              <Button
                size="sm"
                onClick={() => onUploadSuccess(executionResult.response)}
                className="h-7 text-xs gap-1.5 bg-aws-orange text-slate-950 font-bold"
              >
                📂 Open in Viewer <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <pre className="p-3 bg-slate-950 rounded border border-slate-800 text-[11px] font-mono text-emerald-300 max-h-56 overflow-y-auto">
              {JSON.stringify(executionResult, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* AI Paste Text Modal */}
      <Dialog open={showAiModal} onOpenChange={setShowAiModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="w-4 h-4 text-aws-orange" /> Extract Metadata from Text Snippet
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <p className="text-slate-400">
              Paste an excerpt from a contract, loan schedule, or audit memo to extract metadata attributes:
            </p>
            <textarea
              value={aiSnippetText}
              onChange={(e) => setAiSnippetText(e.target.value)}
              rows={5}
              placeholder="e.g. Loan Agreement LN-2026-88821 for customer 1094827 with mortgage amount ILS 750,000..."
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs font-mono text-slate-200"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowAiModal(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleAiExtractFromSnippet}
              disabled={aiSuggesting || !aiSnippetText.trim()}
              className="bg-aws-orange text-slate-950 font-bold"
            >
              {aiSuggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Extract Metadata'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
