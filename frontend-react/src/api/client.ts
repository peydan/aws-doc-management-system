export interface AppConfig {
  apiUrl: string;
  agentStreamingUrl: string;
  userPoolId: string;
  userPoolClientId: string;
  region: string;
  authFlow?: string;
}

let cachedConfig: AppConfig | null = null;

export async function loadConfig(): Promise<AppConfig> {
  if (cachedConfig) return cachedConfig;
  try {
    const res = await fetch('/config.json');
    if (res.ok) {
      cachedConfig = await res.json();
      return cachedConfig!;
    }
  } catch (e) {
    console.warn('Could not load /config.json, falling back to defaults', e);
  }
  return {
    apiUrl: 'http://localhost:3000/api',
    agentStreamingUrl: '',
    userPoolId: '',
    userPoolClientId: '',
    region: 'us-east-1',
  };
}

export interface DocumentRecord {
  document_id: string;
  document_class: string;
  document_type?: string;
  application_version: number;
  metadata_revision: number;
  content_type?: string;
  format?: string;
  page_count?: number;
  content_length?: number;
  content_checksum?: string;
  filename: string;
  status: 'ACTIVE' | 'SOFT_DELETED';
  created_at: string;
  created_by?: string;
  metadata_updated_at?: string;
  metadata_updated_by?: string;
  // Domain fields
  customer_id?: number;
  loan_number?: string;
  loan_amount_minor_units?: number;
  currency?: string;
  confidentiality_tier?: string;
  retention_schedule_code?: string;
  legal_hold_active?: boolean;
  [key: string]: any;
}

export interface SearchResults {
  total: number;
  items: DocumentRecord[];
  took_ms?: number;
}

export interface ApiAuditLogEntry {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  curl: string;
  requestBody?: any;
  response?: any;
}

type AuditListener = (logs: ApiAuditLogEntry[]) => void;
const sessionAuditLogs: ApiAuditLogEntry[] = [];
const auditListeners: Set<AuditListener> = new Set();

function generateCurl(method: string, url: string, headers: Record<string, string>, body?: any): string {
  let curl = `curl -X ${method} "${url}" \\\n`;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'authorization') {
      curl += `  -H "${k}: Bearer <JWT_TOKEN>" \\\n`;
    } else {
      curl += `  -H "${k}: ${v}" \\\n`;
    }
  }
  if (body) {
    if (typeof body === 'string') {
      curl += `  -d '${body.length > 500 ? body.slice(0, 500) + '... (truncated)' : body}'`;
    } else {
      curl += `  -d '${JSON.stringify(body)}'`;
    }
  }
  return curl;
}

function notifyAuditListeners() {
  for (const listener of auditListeners) {
    listener([...sessionAuditLogs]);
  }
}

export function getSessionAuditLogs(): ApiAuditLogEntry[] {
  return [...sessionAuditLogs];
}

export function clearSessionAuditLogs(): void {
  sessionAuditLogs.length = 0;
  notifyAuditListeners();
}

export function subscribeSessionAuditLogs(listener: AuditListener): () => void {
  auditListeners.add(listener);
  listener([...sessionAuditLogs]);
  return () => {
    auditListeners.delete(listener);
  };
}

export class ApiClient {
  private static idToken: string | null = null;

  static setToken(token: string | null) {
    this.idToken = token;
  }

  private static async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const config = await loadConfig();
    const url = `${config.apiUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
    const method = options.method || 'GET';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.idToken) {
      headers['Authorization'] = `Bearer ${this.idToken}`;
    }

    const startTime = performance.now();
    let status = 0;
    let resBody: any = null;

    try {
      const res = await fetch(url, { ...options, headers });
      status = res.status;
      const durationMs = Math.round(performance.now() - startTime);

      if (!res.ok) {
        try {
          resBody = await res.json();
        } catch {
          resBody = { message: res.statusText };
        }

        const logEntry: ApiAuditLogEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: new Date().toLocaleTimeString(),
          method,
          url,
          status,
          durationMs,
          curl: generateCurl(method, url, headers, options.body),
          requestBody: options.body,
          response: resBody,
        };
        sessionAuditLogs.unshift(logEntry);
        if (sessionAuditLogs.length > 50) sessionAuditLogs.pop();
        notifyAuditListeners();

        const errorMsg = resBody.error?.message || resBody.message || (typeof resBody.error === 'string' ? resBody.error : `Request failed with status ${res.status}`);
        const error: any = new Error(errorMsg);
        error.status = res.status;
        error.body = resBody;
        throw error;
      }

      if (res.status === 204) {
        resBody = {};
      } else {
        resBody = await res.json();
      }

      const logEntry: ApiAuditLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toLocaleTimeString(),
        method,
        url,
        status,
        durationMs,
        curl: generateCurl(method, url, headers, options.body),
        requestBody: options.body,
        response: resBody,
      };
      sessionAuditLogs.unshift(logEntry);
      if (sessionAuditLogs.length > 50) sessionAuditLogs.pop();
      notifyAuditListeners();

      return resBody as T;
    } catch (err: any) {
      if (status === 0) {
        const durationMs = Math.round(performance.now() - startTime);
        const logEntry: ApiAuditLogEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: new Date().toLocaleTimeString(),
          method,
          url,
          status: 0,
          durationMs,
          curl: generateCurl(method, url, headers, options.body),
          requestBody: options.body,
          response: { error: err.message },
        };
        sessionAuditLogs.unshift(logEntry);
        if (sessionAuditLogs.length > 50) sessionAuditLogs.pop();
        notifyAuditListeners();
      }
      throw err;
    }
  }

  static async searchDocuments(params: {
    q?: string;
    document_class?: string;
    status?: string;
    customer_id?: string;
    limit?: number;
  }): Promise<SearchResults> {
    const filters: Record<string, any> = {};

    if (params.status && params.status !== 'ALL') {
      filters.status = params.status;
    } else if (params.status === 'ALL') {
      filters.status = 'ALL';
    }

    if (params.document_class && params.document_class !== 'ALL') {
      filters.document_class = params.document_class;
    }

    if (params.customer_id) {
      filters.customer_id = params.customer_id;
    }

    if (params.q) {
      const trimmed = params.q.trim();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(trimmed)) {
        filters.document_id = trimmed;
      } else if (/^\d+$/.test(trimmed)) {
        filters.customer_id = trimmed;
      } else if (trimmed.toUpperCase().startsWith('LN-')) {
        filters.loan_number = trimmed;
      } else {
        filters.filename = trimmed;
      }
    }

    return this.request<SearchResults>('/search', {
      method: 'POST',
      body: JSON.stringify({
        filters,
        page_size: params.limit || 50,
      }),
    });
  }

  static async getDocument(id: string, versionId?: string): Promise<DocumentRecord> {
    const qs = versionId ? `?version_id=${encodeURIComponent(versionId)}` : '';
    return this.request<DocumentRecord>(`/documents/${id}${qs}`);
  }

  static async getDownloadUrl(id: string, versionId?: string, format?: string): Promise<{ download_url: string }> {
    const params = new URLSearchParams();
    if (versionId) params.set('version_id', versionId);
    if (format) params.set('format', format);
    const qs = params.toString();
    return this.request<{ download_url: string }>(`/documents/${id}/download${qs ? `?${qs}` : ''}`);
  }

  static async getDocumentVersions(id: string): Promise<Array<{
    application_version: number;
    s3_version_id: string;
    content_checksum: string;
    created_at: string;
  }>> {
    const res: any = await this.request(`/documents/${id}/versions`);
    return res.versions || (Array.isArray(res) ? res : []);
  }

  static async addPages(id: string, payload: {
    donor_base64: string;
    insertion_position: 'end' | 'start' | 'custom';
    custom_index?: number;
    page_indices?: number[];
  }): Promise<DocumentRecord> {
    return this.request(`/documents/${id}/pages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async uploadInline(payload: {
    filename: string;
    content_type: string;
    document_class: string;
    metadata: Record<string, any>;
    file_base64: string;
  }): Promise<DocumentRecord> {
    return this.request('/documents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async suggestMetadata(payload: {
    document_class: string;
    file_base64?: string;
    filename?: string;
    text_snippet?: string;
    existing_metadata?: Record<string, any>;
  }): Promise<{
    status: string;
    document_class?: string;
    shared_metadata?: Record<string, any>;
    class_metadata?: Record<string, any>;
    pii_detected?: boolean;
    audit?: Record<string, any>;
    suggestions?: Record<string, any>;
    confidence?: number;
  }> {
    return this.request('/metadata/suggest', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async chatWithAgent(payload: {
    message: string;
    sessionId?: string;
  }): Promise<{
    session_id: string;
    message: string;
    citations?: Array<{
      document_id: string;
      filename?: string;
      application_version?: number;
      document_class?: string;
    }>;
    tools_used?: string[];
    correlation_id?: string;
  }> {
    return this.request('/agent/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async getDocumentAudit(id: string): Promise<any> {
    return this.request(`/documents/${id}/audit`);
  }

  static async initiateUpload(payload: {
    filename: string;
    content_type: string;
    document_class: string;
    metadata: Record<string, any>;
  }): Promise<{
    session_id: string;
    upload_url: string;
    document_id: string;
  }> {
    const res: any = await this.request('/documents/uploads', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return {
      session_id: res.upload_id || res.session_id,
      upload_url: res.upload_url,
      document_id: res.document_id,
    };
  }

  static async completeUpload(uploadId: string): Promise<DocumentRecord> {
    return this.request(`/uploads/${uploadId}/complete`, {
      method: 'POST',
    });
  }

  static async updateMetadata(
    documentId: string,
    changes: Record<string, any>,
    expectedRevision: number
  ): Promise<DocumentRecord> {
    return this.request(`/documents/${documentId}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify({
        expected_metadata_revision: expectedRevision,
        changes,
        metadata: changes,
      }),
    });
  }

  static async softDeleteDocument(documentId: string): Promise<void> {
    return this.request(`/documents/${documentId}/soft-delete`, {
      method: 'POST',
    });
  }

  static async restoreDocument(documentId: string): Promise<DocumentRecord> {
    return this.request(`/documents/${documentId}/restore`, {
      method: 'POST',
    });
  }

  static async batchDownload(documentIds: string[], format?: string, includeMeta = true): Promise<{ download_url: string; batch_id: string }> {
    return this.request('/documents/batch-download', {
      method: 'POST',
      body: JSON.stringify({
        document_ids: documentIds,
        format: format || 'original',
        include_metadata: includeMeta,
      }),
    });
  }

  static async getHealth(): Promise<{ status: string; checks?: Record<string, any>; [key: string]: any }> {
    return this.request('/health');
  }
}
