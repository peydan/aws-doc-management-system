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
       ? `- "loan_number": string (e.g. "LN-2026-88821")
   - "loan_amount_minor_units": integer (monetary amount in integer minor units / cents / agorot, e.g. 5000000 for 50,000.00. NEVER use floating point or decimals).
   - "currency": string (3-letter ISO 4217, e.g. "ILS", "USD", "EUR")
   - "loan_type": enum string ("MORTGAGE" | "PERSONAL" | "COMMERCIAL" | "AUTO")
   - "branch_code": string (e.g. "TLV-01")
   - "signed_date": string (ISO date "YYYY-MM-DD")`
       : documentClass === 'compliance_retention'
       ? `- "retention_schedule_code": string (e.g. "RET-FIN-001")
   - "retention_period_years": integer (>= 0)
   - "regulatory_framework": enum string ("SOX" | "GDPR" | "BASEL_III" | "HIPAA" | "LOCAL_BANKING_REG")
   - "retention_start_date": string (ISO date "YYYY-MM-DD")`
       : `- "document_type": string`
   }

3. Shared Banking Attributes (if clearly identified):
   - "customer_id": integer (core customer number, e.g. 1094827)
   - "transaction_id": string

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
