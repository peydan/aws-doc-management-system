import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import sharedDocumentSchema from '../../schemas/shared_document_metadata-v1.json';
import loanAgreementSchema from '../../schemas/loan_agreement-v1.json';
import complianceRetentionSchema from '../../schemas/compliance_retention-v1.json';
import securityClassificationSchema from '../../schemas/security_classification-v1.json';
import { ValidationError, ErrorDetail } from './errors';
import { detectFileFormat } from './pdf-converter';

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: true });
addFormats(ajv);

// Register shared base schema so $ref: "https://bank.internal/schemas/shared-document-metadata-v1.json" compiles cleanly
ajv.addSchema(sharedDocumentSchema);

const schemaRegistry: Record<string, ValidateFunction> = {
  'loan_agreement:1': ajv.compile(loanAgreementSchema),
  'compliance_retention:1': ajv.compile(complianceRetentionSchema),
  'security_classification:1': ajv.compile(securityClassificationSchema),
};

export function validateMetadataSchema(metadata: Record<string, any>): void {
  const docClass = metadata.document_class || 'loan_agreement';
  const schemaVer = metadata.schema_version || 1;
  const key = `${docClass}:${schemaVer}`;

  const validator = schemaRegistry[key];
  if (!validator) {
    throw new ValidationError(
      `Unsupported document_class '${docClass}' or schema_version '${schemaVer}'. Available classes: ${Object.keys(schemaRegistry).join(', ')}`
    );
  }

  const valid = validator(metadata);
  if (!valid && validator.errors) {
    const details: ErrorDetail[] = validator.errors.map((err) => ({
      field: err.instancePath ? `metadata${err.instancePath.replace(/\//g, '.')}` : (err.params as any)?.missingProperty || 'metadata',
      error: err.message || 'invalid',
    }));
    throw new ValidationError(`Metadata validation failed against schema '${key}'`, details);
  }
}

export function buildFullMetadata(params: {
  documentId: string;
  documentClass: string;
  filename: string;
  contentType: string;
  contentLength: number;
  checksum: string;
  userId: string;
  clientMetadata: Record<string, any>;
  applicationVersion?: number;
  metadataRevision?: number;
  schemaVersion?: number;
  format?: string;
  pageCount?: number;
}): Record<string, any> {
  const now = new Date().toISOString();
  const clientMeta = { ...params.clientMetadata };
  const docClass = params.documentClass || clientMeta.document_class || 'loan_agreement';
  const schemaVer = params.schemaVersion || clientMeta.schema_version || 1;
  const annotationSchema =
    docClass === 'loan_agreement'
      ? 'bank.document-metadata/1'
      : `bank.document-metadata/${docClass}/${schemaVer}`;

  const detectedFormat = params.format || clientMeta.format || detectFileFormat(params.contentType, params.filename);
  const effectivePageCount = params.pageCount !== undefined ? params.pageCount : clientMeta.page_count;

  const baseMetadata: Record<string, any> = {
    ...clientMeta,
    annotation_schema: annotationSchema,
    document_id: params.documentId,
    document_class: docClass,
    application_version: params.applicationVersion || clientMeta.application_version || 1,
    metadata_revision: params.metadataRevision || clientMeta.metadata_revision || 1,
    schema_version: schemaVer,
    content_type: params.contentType,
    format: detectedFormat,
    ...(effectivePageCount !== undefined && effectivePageCount !== null ? { page_count: effectivePageCount } : {}),
    content_length: params.contentLength,
    content_checksum: params.checksum.startsWith('sha256:') ? params.checksum : `sha256:${params.checksum}`,
    filename: params.filename,
    created_at: clientMeta.created_at || now,
    created_by: clientMeta.created_by || params.userId,
    metadata_updated_at: now,
    metadata_updated_by: params.userId,
  };

  // Shared Banking / DCTM default traits & coercion
  if (baseMetadata.customer_id !== undefined && typeof baseMetadata.customer_id === 'string') {
    baseMetadata.customer_id = parseInt(baseMetadata.customer_id, 10);
  }
  if (baseMetadata.customer_id === undefined || isNaN(baseMetadata.customer_id)) baseMetadata.customer_id = 1094827;

  if (typeof baseMetadata.complete_customer_id_code === 'string') {
    try { baseMetadata.complete_customer_id_code = JSON.parse(baseMetadata.complete_customer_id_code); } catch {}
  }
  if (!baseMetadata.complete_customer_id_code || typeof baseMetadata.complete_customer_id_code !== 'object') {
    baseMetadata.complete_customer_id_code = {
      id_number: '123456789',
      id_type: 1,
    };
  } else {
    if (baseMetadata.complete_customer_id_code.id_type !== undefined) {
      baseMetadata.complete_customer_id_code.id_type = parseInt(baseMetadata.complete_customer_id_code.id_type, 10) || 1;
    }
  }

  if (typeof baseMetadata.account_id === 'string') {
    try { baseMetadata.account_id = JSON.parse(baseMetadata.account_id); } catch {}
  }
  if (!baseMetadata.account_id || typeof baseMetadata.account_id !== 'object') {
    baseMetadata.account_id = {
      bank_id: 10,
      branch_id: 802,
      account_number: 123456,
    };
  } else {
    if (baseMetadata.account_id.bank_id !== undefined) baseMetadata.account_id.bank_id = parseInt(baseMetadata.account_id.bank_id, 10) || 10;
    if (baseMetadata.account_id.branch_id !== undefined) baseMetadata.account_id.branch_id = parseInt(baseMetadata.account_id.branch_id, 10) || 802;
    if (baseMetadata.account_id.account_number !== undefined) baseMetadata.account_id.account_number = parseInt(baseMetadata.account_id.account_number, 10) || 123456;
  }

  if (baseMetadata.business_area_code !== undefined) baseMetadata.business_area_code = parseInt(baseMetadata.business_area_code, 10) || 100;
  else baseMetadata.business_area_code = 100;

  if (baseMetadata.business_sub_area_code !== undefined) baseMetadata.business_sub_area_code = parseInt(baseMetadata.business_sub_area_code, 10) || 101;
  else baseMetadata.business_sub_area_code = 101;

  if (docClass === 'loan_agreement') {
    if (!baseMetadata.document_type) baseMetadata.document_type = 'SIGNED_AGREEMENT';
    if (!baseMetadata.loan_number) baseMetadata.loan_number = 'LN-2026-88821';
    if (baseMetadata.loan_amount_minor_units !== undefined) baseMetadata.loan_amount_minor_units = parseInt(baseMetadata.loan_amount_minor_units, 10);
    if (baseMetadata.loan_amount_minor_units === undefined || isNaN(baseMetadata.loan_amount_minor_units)) baseMetadata.loan_amount_minor_units = 100000000;
    if (!baseMetadata.currency) baseMetadata.currency = 'ILS';
    if (!baseMetadata.loan_type) baseMetadata.loan_type = 'MORTGAGE';
    if (!baseMetadata.branch_code) baseMetadata.branch_code = 'TLV-01';
    if (!baseMetadata.signed_date) baseMetadata.signed_date = now.substring(0, 10);
  } else if (docClass === 'compliance_retention') {
    if (!baseMetadata.document_type) baseMetadata.document_type = 'FINANCIAL_LEDGER';
    if (!baseMetadata.retention_schedule_code) baseMetadata.retention_schedule_code = 'RET-FIN-001';
    if (baseMetadata.retention_period_years !== undefined) baseMetadata.retention_period_years = parseInt(baseMetadata.retention_period_years, 10);
    if (baseMetadata.retention_period_years === undefined || isNaN(baseMetadata.retention_period_years)) baseMetadata.retention_period_years = 7;
    if (!baseMetadata.regulatory_framework) baseMetadata.regulatory_framework = 'SOX';
    if (!baseMetadata.retention_start_date) baseMetadata.retention_start_date = now.substring(0, 10);
    if (!baseMetadata.retention_expiry_date) baseMetadata.retention_expiry_date = '2033-12-31';
    if (baseMetadata.legal_hold_active !== undefined) baseMetadata.legal_hold_active = String(baseMetadata.legal_hold_active).toLowerCase() === 'true';
    else baseMetadata.legal_hold_active = false;
    if (!baseMetadata.disposal_action) baseMetadata.disposal_action = 'PERMANENT_DELETE';
    if (!baseMetadata.compliance_officer_id) baseMetadata.compliance_officer_id = 'COMP-OFFICER-01';
  } else if (docClass === 'security_classification') {
    if (!baseMetadata.document_type) baseMetadata.document_type = 'BOARD_RESOLUTION';
    if (!baseMetadata.confidentiality_tier) baseMetadata.confidentiality_tier = 'RESTRICTED';
    if (baseMetadata.contains_pii !== undefined) baseMetadata.contains_pii = String(baseMetadata.contains_pii).toLowerCase() === 'true';
    else baseMetadata.contains_pii = false;
    if (!baseMetadata.pii_categories || !Array.isArray(baseMetadata.pii_categories)) baseMetadata.pii_categories = ['NONE'];
    if (!baseMetadata.minimum_clearance_role) baseMetadata.minimum_clearance_role = 'Document.Reader';
    if (!baseMetadata.encryption_requirement) baseMetadata.encryption_requirement = 'SSE_KMS_DEFAULT';
    if (!baseMetadata.data_residency_jurisdiction) baseMetadata.data_residency_jurisdiction = 'IL';
    if (baseMetadata.export_restricted !== undefined) baseMetadata.export_restricted = String(baseMetadata.export_restricted).toLowerCase() === 'true';
    else baseMetadata.export_restricted = false;
    if (!baseMetadata.classification_owner) baseMetadata.classification_owner = 'SEC-OPS-01';
  }

  return baseMetadata;
}

export function parseJsonBody(event: { body?: string | null; isBase64Encoded?: boolean }): Record<string, any> {
  if (!event.body) {
    return {};
  }
  let bodyStr = event.body;
  if (event.isBase64Encoded) {
    bodyStr = Buffer.from(event.body, 'base64').toString('utf-8');
  }
  try {
    return JSON.parse(bodyStr);
  } catch {
    try {
      const decoded = Buffer.from(bodyStr, 'base64').toString('utf-8');
      if (decoded.startsWith('{') || decoded.startsWith('[')) {
        return JSON.parse(decoded);
      }
    } catch {}
    throw new ValidationError('Invalid JSON request body');
  }
}

export interface BatchDownloadRequestItem {
  document_id: string;
  version?: number;
}

export interface BatchDownloadRequest {
  document_ids?: string[];
  items?: BatchDownloadRequestItem[];
  format?: 'original' | 'pdf';
  include_metadata?: boolean;
}

export function validateBatchDownloadRequest(payload: any): {
  items: BatchDownloadRequestItem[];
  format: 'original' | 'pdf';
  include_metadata: boolean;
} {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Request body must be a valid JSON object');
  }

  const items: BatchDownloadRequestItem[] = [];

  if (Array.isArray(payload.document_ids)) {
    for (const id of payload.document_ids) {
      if (typeof id === 'string' && id.trim()) {
        items.push({ document_id: id.trim() });
      }
    }
  }

  if (Array.isArray(payload.items)) {
    for (const item of payload.items) {
      if (item && typeof item === 'object' && typeof item.document_id === 'string' && item.document_id.trim()) {
        const vNum = typeof item.version === 'number' ? item.version : undefined;
        items.push({ document_id: item.document_id.trim(), version: vNum });
      }
    }
  }

  if (items.length === 0) {
    throw new ValidationError(
      'At least one valid document_id must be provided in "document_ids" or "items"',
      [{ field: 'document_ids', error: 'must contain at least one document ID' }]
    );
  }

  if (items.length > 100) {
    throw new ValidationError(
      'Batch download exceeds maximum allowed limit of 100 documents per request',
      [{ field: 'document_ids', error: 'max 100 items per request' }]
    );
  }

  const format = payload.format ? String(payload.format).toLowerCase() : 'original';
  if (format !== 'original' && format !== 'pdf') {
    throw new ValidationError('Invalid format. Supported values are "original" or "pdf"', [
      { field: 'format', error: 'must be either "original" or "pdf"' },
    ]);
  }

  const include_metadata = Boolean(payload.include_metadata);

  return {
    items,
    format: format as 'original' | 'pdf',
    include_metadata,
  };
}

export interface ValidatedAddPagesPayload {
  pages_base64: string;
  content_type: string;
  position?: 'end' | 'start' | number;
  page_indices?: number[];
}

/**
 * Validates request payload for POST /documents/{id}/pages.
 */
export function validateAddPagesPayload(body: any): ValidatedAddPagesPayload {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be a JSON object');
  }

  const pages_base64 = body.pages_base64;
  if (!pages_base64 || typeof pages_base64 !== 'string' || !pages_base64.trim()) {
    throw new ValidationError('pages_base64 is required and must be a non-empty base64 string', [
      { field: 'pages_base64', error: 'must be a non-empty base64 string' },
    ]);
  }

  const content_type = body.content_type || 'application/pdf';
  if (typeof content_type !== 'string' || !content_type.trim()) {
    throw new ValidationError('content_type must be a non-empty string', [
      { field: 'content_type', error: 'must be a non-empty string' },
    ]);
  }

  let position: 'end' | 'start' | number | undefined;
  if (body.position !== undefined && body.position !== null) {
    if (body.position === 'end' || body.position === 'start') {
      position = body.position;
    } else if (typeof body.position === 'number' && Number.isInteger(body.position) && body.position >= 0) {
      position = body.position;
    } else {
      throw new ValidationError(
        'position must be "end", "start", or a non-negative integer page index',
        [{ field: 'position', error: 'must be "end", "start", or non-negative integer' }]
      );
    }
  }

  let page_indices: number[] | undefined;
  if (body.page_indices !== undefined && body.page_indices !== null) {
    if (!Array.isArray(body.page_indices)) {
      throw new ValidationError('page_indices must be an array of integers', [
        { field: 'page_indices', error: 'must be an array of integers' },
      ]);
    }
    for (const idx of body.page_indices) {
      if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0) {
        throw new ValidationError('All elements of page_indices must be non-negative integers', [
          { field: 'page_indices', error: 'all elements must be non-negative integers' },
        ]);
      }
    }
    page_indices = body.page_indices;
  }

  return {
    pages_base64: pages_base64.trim(),
    content_type: content_type.trim().toLowerCase(),
    position,
    page_indices,
  };
}


