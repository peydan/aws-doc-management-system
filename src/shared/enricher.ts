import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

export const DEFAULT_BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';

export interface EnrichmentAuditDetails {
  model_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  raw_llm_output: Record<string, any>;
  applied_diff: {
    fields_added: string[];
    fields_ignored_due_to_uploader_precedence: string[];
  };
  governance_verification: {
    confidentiality_tier_preserved: string;
    safety_ratchet_applied: boolean;
  };
}

export interface EnrichmentResult {
  enrichedMetadata: Record<string, any>;
  auditDetails: EnrichmentAuditDetails;
}

const VALID_PII_CATEGORIES = new Set([
  'NATIONAL_ID',
  'FINANCIAL_ACCOUNT',
  'FINANCIAL_HISTORY',
  'BIOMETRIC',
  'CONTACT_INFO',
  'CREDIT_SCORE',
  'NONE',
]);

export function extractJsonFromLlmResponse(text: string): Record<string, any> {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = jsonMatch ? jsonMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Attempt to locate first { and last }
    const startIdx = candidate.indexOf('{');
    const endIdx = candidate.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      return JSON.parse(candidate.substring(startIdx, endIdx + 1));
    }
    throw new Error(`Failed to parse valid JSON from LLM response: ${text.substring(0, 200)}...`);
  }
}

export function buildEnrichmentPrompt(textSnippet: string, documentClass: string): string {
  return `You are an expert document metadata extractor and data classification specialist for an enterprise banking platform.
Analyze the following document excerpt and extract structured metadata and PII classification.

Respond ONLY with a valid JSON object matching the applicable schema. Do not include markdown preamble or conversational text outside of the JSON block.

Schema instructions:
1. PII Detection (REQUIRED):
   - "contains_pii": boolean (true if any personally identifiable information, national ID, passport, account number, personal name, or financial details are present).
   - "pii_categories": array of strings chosen strictly from: ["NATIONAL_ID", "FINANCIAL_ACCOUNT", "FINANCIAL_HISTORY", "BIOMETRIC", "CONTACT_INFO", "CREDIT_SCORE", "NONE"].
     If contains_pii is false, set ["NONE"].

2. Domain Attributes for class "${documentClass}":
   ${
     documentClass === 'loan_agreement'
       ? `- "document_type": enum string ("SIGNED_AGREEMENT" | "APPLICATION" | "DISCLOSURE" | "PROMISSORY_NOTE")
   - "loan_number": string (e.g. "LN-2026-88821")
   - "loan_amount_minor_units": integer (monetary amount in integer minor units / cents / agorot, e.g. 5000000 for 50,000.00. NEVER use floating point or decimals).
   - "currency": string (3-letter ISO 4217, e.g. "ILS", "USD", "EUR")
   - "loan_type": enum string ("MORTGAGE" | "PERSONAL" | "COMMERCIAL" | "AUTO")
   - "branch_code": string (e.g. "TLV-01")
   - "signed_date": string (ISO date "YYYY-MM-DD")`
       : documentClass === 'compliance_retention'
       ? `- "document_type": enum string ("STATUTORY_RECORD" | "FINANCIAL_LEDGER" | "AUDIT_EVIDENCE" | "CONTRACT_ARCHIVE" | "COMMUNICATION_LOG")
   - "retention_schedule_code": string (e.g. "RET-FIN-001")
   - "retention_period_years": integer (>= 0)
   - "regulatory_framework": enum string ("SOX" | "GDPR" | "BASEL_III" | "HIPAA" | "LOCAL_BANKING_REG")
   - "retention_start_date": string (ISO date "YYYY-MM-DD")
   - "retention_expiry_date": string (ISO date "YYYY-MM-DD")
   - "legal_hold_active": boolean
   - "disposal_action": enum string ("PERMANENT_DELETE" | "ARCHIVE_GLACIER" | "REVIEW_REQUIRED")
   - "compliance_officer_id": string`
       : documentClass === 'security_classification'
       ? `- "document_type": enum string ("CUSTOMER_RECORD" | "INTERNAL_MEMO" | "BOARD_RESOLUTION" | "FINANCIAL_FORECAST" | "SECURITY_ASSESSMENT")
   - "confidentiality_tier": enum string ("PUBLIC" | "INTERNAL" | "RESTRICTED" | "HIGHLY_CONFIDENTIAL")
   - "minimum_clearance_role": enum string ("Document.Reader" | "Document.Writer" | "Document.MetadataEditor" | "Document.Admin")
   - "encryption_requirement": enum string ("SSE_S3" | "SSE_KMS_DEFAULT" | "SSE_KMS_CUSTOMER_MANAGED")
   - "export_restricted": boolean
   - "classification_owner": string`
       : `- "document_type": string`
   }

3. Shared Banking Attributes (if clearly identified or inferable):
   - "customer_id": integer (core customer number, e.g. 1094827)
   - "complete_customer_id_code": object {"id_number": string, "id_type": integer (usually 1 for national id)}
   - "account_id": object {"bank_id": integer, "branch_id": integer, "account_number": integer}
   - "transaction_id": string (e.g. "TX-2026-10042")
   - "business_area_code": integer
   - "business_sub_area_code": integer
   - "document_group_id": string

Document Excerpt:
"""
${textSnippet.substring(0, 4000)}
"""`;
}

export async function enrichMetadataWithBedrock(
  textSnippet: string,
  clientMetadata: Record<string, any>,
  documentClass: string,
  modelId = DEFAULT_BEDROCK_MODEL_ID
): Promise<EnrichmentResult> {
  const startTime = Date.now();
  const prompt = buildEnrichmentPrompt(textSnippet, documentClass);

  const command = new ConverseCommand({
    modelId,
    messages: [
      {
        role: 'user',
        content: [{ text: prompt }],
      },
    ],
    inferenceConfig: {
      maxTokens: 1000,
      temperature: 0,
    },
  });

  const response = await bedrockClient.send(command);
  const latencyMs = Date.now() - startTime;

  const rawText = response.output?.message?.content?.[0]?.text || '{}';
  const extracted = extractJsonFromLlmResponse(rawText);

  // Apply PII Safety Ratchet:
  // 1. If uploader already said true, LLM cannot downgrade to false
  const uploaderContainsPii = clientMetadata.contains_pii === true;
  const llmContainsPii = extracted.contains_pii === true;
  const finalContainsPii = uploaderContainsPii || llmContainsPii;

  // 2. Union PII categories
  const uploaderCategories: string[] = Array.isArray(clientMetadata.pii_categories)
    ? clientMetadata.pii_categories
    : [];
  const llmCategories: string[] = Array.isArray(extracted.pii_categories)
    ? extracted.pii_categories.filter((cat: string) => VALID_PII_CATEGORIES.has(cat))
    : [];

  const mergedCategoriesSet = new Set([...uploaderCategories, ...llmCategories]);
  if (finalContainsPii) {
    mergedCategoriesSet.delete('NONE');
  }
  const finalPiiCategories =
    mergedCategoriesSet.size > 0 ? Array.from(mergedCategoriesSet) : finalContainsPii ? ['CONTACT_INFO'] : ['NONE'];

  // Apply Uploader Precedence for Domain Attributes:
  const fieldsAdded: string[] = [];
  const fieldsIgnored: string[] = [];

  const candidateUpdates: Record<string, any> = {};

  for (const [key, value] of Object.entries(extracted)) {
    // Strictly protect governance traits from LLM mutation
    if (
      key === 'confidentiality_tier' ||
      key === 'minimum_clearance_role' ||
      key === 'classification_owner' ||
      key === 'encryption_requirement' ||
      key === 'document_id' ||
      key === 'document_class' ||
      key === 'annotation_schema' ||
      key === 'schema_version' ||
      key === 'application_version' ||
      key === 'metadata_revision' ||
      key === 'created_at' ||
      key === 'created_by'
    ) {
      fieldsIgnored.push(key);
      continue;
    }

    if (key === 'contains_pii' || key === 'pii_categories') {
      continue; // handled by safety ratchet above
    }

    // Integer minor units safety: ensure integer if loan_amount_minor_units
    if (key === 'loan_amount_minor_units' && typeof value === 'number') {
      candidateUpdates[key] = Math.round(value);
    } else {
      candidateUpdates[key] = value;
    }
  }

  // Merge: clientMetadata takes absolute precedence over candidateUpdates
  const mergedMetadata: Record<string, any> = { ...clientMetadata };

  for (const [key, val] of Object.entries(candidateUpdates)) {
    if (mergedMetadata[key] === undefined || mergedMetadata[key] === null || mergedMetadata[key] === '') {
      mergedMetadata[key] = val;
      fieldsAdded.push(key);
    } else {
      fieldsIgnored.push(key);
    }
  }

  // Set final PII attributes
  mergedMetadata.contains_pii = finalContainsPii;
  mergedMetadata.pii_categories = finalPiiCategories;
  if (!uploaderCategories.length && llmCategories.length) {
    fieldsAdded.push('contains_pii', 'pii_categories');
  }

  const promptTokens = response.usage?.inputTokens || 0;
  const completionTokens = response.usage?.outputTokens || 0;

  const auditDetails: EnrichmentAuditDetails = {
    model_id: modelId,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    latency_ms: latencyMs,
    raw_llm_output: extracted,
    applied_diff: {
      fields_added: fieldsAdded,
      fields_ignored_due_to_uploader_precedence: fieldsIgnored,
    },
    governance_verification: {
      confidentiality_tier_preserved: clientMetadata.confidentiality_tier || 'UNSPECIFIED',
      safety_ratchet_applied: true,
    },
  };

  return {
    enrichedMetadata: mergedMetadata,
    auditDetails,
  };
}

export const SHARED_METADATA_KEYS = new Set([
  'customer_id',
  'complete_customer_id_code',
  'account_id',
  'account_subscription_num',
  'transaction_id',
  'business_area_code',
  'business_sub_area_code',
  'document_group_id',
  'document_int',
  'document_ext',
  'a_content_type',
  'document_form_id',
  'legacy_document_entry_dttm',
]);

export interface PartitionedMetadata {
  shared_metadata: Record<string, any>;
  class_metadata: Record<string, any>;
  raw_extracted: Record<string, any>;
}

export function partitionExtractedMetadata(
  extracted: Record<string, any>,
  documentClass: string
): PartitionedMetadata {
  const shared: Record<string, any> = {};
  const classSpecific: Record<string, any> = {};

  const systemKeys = new Set([
    'document_id',
    'document_class',
    'annotation_schema',
    'schema_version',
    'application_version',
    'metadata_revision',
    'created_at',
    'created_by',
    'metadata_updated_at',
    'metadata_updated_by',
    'content_checksum',
    'content_length',
    'content_type',
    'format',
    'page_count',
    'filename',
    'skip_enrichment',
  ]);

  for (const [key, value] of Object.entries(extracted)) {
    if (systemKeys.has(key)) continue;
    if (value === null || value === undefined || value === '') continue;

    if (SHARED_METADATA_KEYS.has(key)) {
      shared[key] = value;
    } else {
      classSpecific[key] = value;
    }
  }

  return {
    shared_metadata: shared,
    class_metadata: classSpecific,
    raw_extracted: extracted,
  };
}

export interface SuggestionResult {
  shared_metadata: Record<string, any>;
  class_metadata: Record<string, any>;
  pii_detected: {
    contains_pii: boolean;
    pii_categories: string[];
  };
  audit: {
    model_id: string;
    latency_ms: number;
    total_tokens: number;
    fields_extracted: string[];
  };
}

export async function suggestMetadataWithBedrock(
  textSnippet: string,
  documentClass: string,
  existingMetadata: Record<string, any> = {},
  modelId = DEFAULT_BEDROCK_MODEL_ID
): Promise<SuggestionResult> {
  const startTime = Date.now();
  const prompt = buildEnrichmentPrompt(textSnippet, documentClass);

  const command = new ConverseCommand({
    modelId,
    messages: [
      {
        role: 'user',
        content: [{ text: prompt }],
      },
    ],
    inferenceConfig: {
      maxTokens: 1000,
      temperature: 0,
    },
  });

  const response = await bedrockClient.send(command);
  const latencyMs = Date.now() - startTime;
  const rawText = response.output?.message?.content?.[0]?.text || '{}';
  const extracted = extractJsonFromLlmResponse(rawText);

  // Normalize PII categories and types
  const containsPii = extracted.contains_pii === true || existingMetadata.contains_pii === true;
  let piiCategories: string[] = Array.isArray(extracted.pii_categories)
    ? extracted.pii_categories.filter((c: string) => VALID_PII_CATEGORIES.has(c))
    : [];

  if (Array.isArray(existingMetadata.pii_categories)) {
    piiCategories = Array.from(new Set([...existingMetadata.pii_categories, ...piiCategories]));
  }
  if (containsPii) {
    piiCategories = piiCategories.filter((c) => c !== 'NONE');
    if (piiCategories.length === 0) piiCategories = ['CONTACT_INFO'];
  } else {
    piiCategories = ['NONE'];
  }

  // Only assign PII attributes if class is security_classification or if detected
  extracted.contains_pii = containsPii;
  extracted.pii_categories = piiCategories;

  // Enforce integer minor units
  if (typeof extracted.loan_amount_minor_units === 'number') {
    extracted.loan_amount_minor_units = Math.round(extracted.loan_amount_minor_units);
  }

  const partitioned = partitionExtractedMetadata(extracted, documentClass);
  const fieldsExtracted = [
    ...Object.keys(partitioned.shared_metadata),
    ...Object.keys(partitioned.class_metadata),
  ];

  const promptTokens = response.usage?.inputTokens || 0;
  const completionTokens = response.usage?.outputTokens || 0;

  return {
    shared_metadata: partitioned.shared_metadata,
    class_metadata: partitioned.class_metadata,
    pii_detected: {
      contains_pii: containsPii,
      pii_categories: piiCategories,
    },
    audit: {
      model_id: modelId,
      latency_ms: latencyMs,
      total_tokens: promptTokens + completionTokens,
      fields_extracted: fieldsExtracted,
    },
  };
}

