import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Header } from '@/components/layout/Header';
import { LoginView } from '@/components/layout/LoginView';
import { DocumentDetail } from '@/components/viewer/DocumentDetail';
import { SearchExplorer } from '@/components/search/SearchExplorer';
import { DocumentUpload } from '@/components/upload/DocumentUpload';
import { MetadataEditor } from '@/components/metadata/MetadataEditor';
import { AiAssistant } from '@/components/assistant/AiAssistant';
import { AdminPanel } from '@/components/admin/AdminPanel';
import { AuditInspector } from '@/components/audit/AuditInspector';
import { CostCalculator } from '@/components/cost/CostCalculator';
import { SystemHealth } from '@/components/health/SystemHealth';
import { SessionInspector } from '@/components/session/SessionInspector';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DocumentRecord } from '@/api/client';
import {
  FileText,
  Search,
  UploadCloud,
  Bot,
  Edit3,
  Shield,
  Loader2,
  ClipboardList,
  Calculator,
  Activity,
  UserCheck,
} from 'lucide-react';

export function App() {
  const { isAuthenticated, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<string>('search');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-aws-orange mb-2" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginView />;
  }

  const handleSelectDocument = (docId: string) => {
    setSelectedDocId(docId);
    setActiveTab('viewer');
  };

  const handleEditMetadata = (doc: DocumentRecord) => {
    setSelectedDoc(doc);
    setSelectedDocId(doc.document_id);
    setActiveTab('metadata');
  };

  const handleInspectAudit = (doc: DocumentRecord) => {
    setSelectedDoc(doc);
    setSelectedDocId(doc.document_id);
    setActiveTab('audit');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="flex flex-wrap gap-1 bg-slate-900 border-slate-800 p-1 mb-6 rounded-xl h-auto">
            <TabsTrigger value="search" className="gap-1.5 text-xs py-1.5">
              <Search className="w-3.5 h-3.5 text-sky-400" /> OpenSearch Explorer
            </TabsTrigger>
            <TabsTrigger value="viewer" className="gap-1.5 text-xs py-1.5">
              <FileText className="w-3.5 h-3.5 text-amber-400" /> Document Viewer
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-1.5 text-xs py-1.5">
              <UploadCloud className="w-3.5 h-3.5 text-emerald-400" /> Ingestion Studio
            </TabsTrigger>
            <TabsTrigger value="assistant" className="gap-1.5 text-xs py-1.5">
              <Bot className="w-3.5 h-3.5 text-purple-400" /> AI Assistant
            </TabsTrigger>
            <TabsTrigger value="metadata" className="gap-1.5 text-xs py-1.5">
              <Edit3 className="w-3.5 h-3.5 text-aws-orange" /> Metadata &amp; OCC
            </TabsTrigger>
            <TabsTrigger value="admin" className="gap-1.5 text-xs py-1.5">
              <Shield className="w-3.5 h-3.5 text-red-400" /> Admin &amp; Lifecycle
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-1.5 text-xs py-1.5">
              <ClipboardList className="w-3.5 h-3.5 text-blue-400" /> Audit Trail
            </TabsTrigger>
            <TabsTrigger value="cost" className="gap-1.5 text-xs py-1.5">
              <Calculator className="w-3.5 h-3.5 text-yellow-400" /> Cost Calculator
            </TabsTrigger>
            <TabsTrigger value="health" className="gap-1.5 text-xs py-1.5">
              <Activity className="w-3.5 h-3.5 text-emerald-400" /> Health
            </TabsTrigger>
            <TabsTrigger value="session" className="gap-1.5 text-xs py-1.5">
              <UserCheck className="w-3.5 h-3.5 text-indigo-400" /> Session
            </TabsTrigger>
          </TabsList>

          <TabsContent value="search">
            <SearchExplorer
              onSelectDocument={handleSelectDocument}
              onEditMetadata={handleEditMetadata}
            />
          </TabsContent>

          <TabsContent value="viewer">
            {selectedDocId ? (
              <DocumentDetail
                documentId={selectedDocId}
                onEditMetadata={handleEditMetadata}
                onInspectAudit={handleInspectAudit}
              />
            ) : (
              <div className="p-16 text-center text-slate-400 bg-slate-900/40 rounded-xl border border-slate-800">
                <FileText className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-slate-200">No Document Selected</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Select a document from the <strong>OpenSearch Explorer</strong> tab to inspect canonical metadata, render the PDF canvas preview, or download binaries.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="upload">
            <DocumentUpload
              onUploadSuccess={(newDoc) => {
                setSelectedDocId(newDoc.document_id);
                setSelectedDoc(newDoc);
                setActiveTab('viewer');
              }}
            />
          </TabsContent>

          <TabsContent value="assistant">
            <AiAssistant onSelectDocument={handleSelectDocument} />
          </TabsContent>

          <TabsContent value="metadata">
            <MetadataEditor
              document={selectedDoc}
              onSaved={(updated) => {
                setSelectedDoc(updated);
              }}
            />
          </TabsContent>

          <TabsContent value="admin">
            <AdminPanel />
          </TabsContent>

          <TabsContent value="audit">
            <AuditInspector activeDocument={selectedDoc} />
          </TabsContent>

          <TabsContent value="cost">
            <CostCalculator />
          </TabsContent>

          <TabsContent value="health">
            <SystemHealth />
          </TabsContent>

          <TabsContent value="session">
            <SessionInspector />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
export default App;

