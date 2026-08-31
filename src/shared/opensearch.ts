import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { SearchUnavailableError } from './errors';

const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT || '';
const INDEX_NAME = 'documents-v1';

let osClient: Client | null = null;

function getClient(): Client {
  if (!osClient) {
    if (!OPENSEARCH_ENDPOINT) {
      throw new SearchUnavailableError('OpenSearch endpoint environment variable is not configured');
    }
    const node = OPENSEARCH_ENDPOINT.startsWith('http') ? OPENSEARCH_ENDPOINT : `https://${OPENSEARCH_ENDPOINT}`;
    osClient = new Client({
      ...AwsSigv4Signer({
        region: process.env.AWS_REGION || 'us-east-1',
        service: 'aoss',
        getCredentials: () => defaultProvider()(),
      }),
      node,
    });
  }
  return osClient;
}

async function ensureIndexExists(client: Client): Promise<void> {
  try {
    const existsRes = await client.indices.exists({ index: INDEX_NAME });
    if (!existsRes.body) {
      console.log(`Creating OpenSearch Serverless index '${INDEX_NAME}'...`);
      await client.indices.create({
        index: INDEX_NAME,
        body: {
          mappings: {
            properties: {
              document_id: { type: 'keyword' },
              document_class: { type: 'keyword' },
              filename: { type: 'keyword' },
              status: { type: 'keyword' },
              application_version: { type: 'integer' },
              metadata_revision: { type: 'integer' },
              content_type: { type: 'keyword' },
              content_length: { type: 'long' },
              created_at: { type: 'date' },
              updated_at: { type: 'date' },
              projection_timestamp: { type: 'date' },

              // Shared Banking / DCTM Properties
              customer_id: { type: 'long' },
              complete_customer_id_code: {
                properties: {
                  id_number: { type: 'keyword' },
                  id_type: { type: 'integer' },
                },
              },
              account_id: {
                properties: {
                  bank_id: { type: 'integer' },
                  branch_id: { type: 'integer' },
                  account_number: { type: 'long' },
                },
              },
              account_subscription_num: { type: 'long' },
              transaction_id: { type: 'keyword' },
              document_int: { type: 'keyword' },
              document_ext: { type: 'keyword' },
              a_content_type: { type: 'keyword' },
              document_form_id: { type: 'keyword' },
              legacy_document_entry_dttm: { type: 'date', format: 'yyyy-MM-dd||strict_date_optional_time||epoch_millis' },
              r_creation_date: { type: 'date', format: 'yyyy-MM-dd||strict_date_optional_time||epoch_millis' },
              r_modify_date: { type: 'date', format: 'yyyy-MM-dd||strict_date_optional_time||epoch_millis' },
              business_area_code: { type: 'integer' },
              business_sub_area_code: { type: 'integer' },
              document_group_id: { type: 'keyword' },

              // Loan Agreement Properties
              document_type: { type: 'keyword' },
              loan_number: { type: 'keyword' },
              loan_type: { type: 'keyword' },
              branch_code: { type: 'keyword' },
              currency: { type: 'keyword' },
              loan_amount_minor_units: { type: 'long' },
              signed_date: { type: 'date', format: 'yyyy-MM-dd||strict_date_optional_time||epoch_millis' },

              // Compliance & Retention Properties
              retention_schedule_code: { type: 'keyword' },
              retention_period_years: { type: 'integer' },
              regulatory_framework: { type: 'keyword' },
              retention_start_date: { type: 'date', format: 'yyyy-MM-dd||strict_date_optional_time||epoch_millis' },
              retention_expiry_date: { type: 'date', format: 'yyyy-MM-dd||strict_date_optional_time||epoch_millis' },
              legal_hold_active: { type: 'boolean' },
              legal_hold_case_id: { type: 'keyword' },
              disposal_action: { type: 'keyword' },
              compliance_officer_id: { type: 'keyword' },

              // Security & Privacy Classification Properties
              confidentiality_tier: { type: 'keyword' },
              contains_pii: { type: 'boolean' },
              pii_categories: { type: 'keyword' },
              minimum_clearance_role: { type: 'keyword' },
              encryption_requirement: { type: 'keyword' },
              data_residency_jurisdiction: { type: 'keyword' },
              export_restricted: { type: 'boolean' },
              classification_owner: { type: 'keyword' },
            },
          },
        },
      });
      console.log(`Successfully created index '${INDEX_NAME}'`);
    }
  } catch (err: any) {
    console.warn(`Note on index creation check: ${err.message}`);
  }
}

export interface SearchFilters {
  document_class?: string;
  filename?: string;
  customer_id?: number | string;
  document_type?: string;
  loan_type?: string;
  branch_code?: string;
  created_from?: string;
  created_to?: string;
  loan_amount_min_minor_units?: number;
  loan_amount_max_minor_units?: number;
  business_area_code?: number;
  business_sub_area_code?: number;
  document_int?: string;
  document_ext?: string;
  document_group_id?: string;
}

export interface SearchParams {
  filters?: SearchFilters;
  sort?: { field: 'created_at' | 'updated_at'; direction: 'asc' | 'desc' };
  page_size?: number;
  cursor?: any[];
}

export class OpenSearchManager {
  static async upsertDocumentProjection(metadata: Record<string, any>, status = 'ACTIVE'): Promise<void> {
    if (!OPENSEARCH_ENDPOINT) {
      console.warn('OpenSearch endpoint not configured. Skipping projection indexing.');
      return;
    }

    const client = getClient();
    await ensureIndexExists(client);

    const doc = {
      ...metadata,
      status: status,
      projection_timestamp: new Date().toISOString(),
      created_at: metadata.created_at || new Date().toISOString(),
      updated_at: metadata.metadata_updated_at || new Date().toISOString(),
    };

    try {
      await client.index({
        index: INDEX_NAME,
        id: metadata.document_id,
        body: doc,
      });
    } catch (err: any) {
      throw new SearchUnavailableError(`Failed to index document in OpenSearch: ${err.message}`);
    }
  }

  static async removeDocumentProjection(documentId: string): Promise<void> {
    if (!OPENSEARCH_ENDPOINT) return;
    try {
      const client = getClient();
      await client.delete({
        index: INDEX_NAME,
        id: documentId,
      });
    } catch (err: any) {
      if (err.statusCode !== 404) {
        throw new SearchUnavailableError(`Failed to delete document from OpenSearch: ${err.message}`);
      }
    }
  }

  static async searchDocuments(params: SearchParams): Promise<{ items: any[]; next_cursor: any[] | null; total: number }> {
    if (!OPENSEARCH_ENDPOINT) {
      throw new SearchUnavailableError('OpenSearch service is unavailable');
    }

    const client = getClient();
    await ensureIndexExists(client);

    const pageSize = Math.min(params.page_size || 20, 100);
    const sortField = params.sort?.field || 'created_at';
    const sortDir = params.sort?.direction || 'desc';

    const mustFilters: any[] = [];

    if (params.filters) {
      const f: any = params.filters;

      // Status filter (default ACTIVE unless specified or ALL)
      if (f.status && f.status !== 'ALL') {
        mustFilters.push({ term: { status: f.status } });
      } else if (!f.status) {
        mustFilters.push({ term: { status: 'ACTIVE' } });
      }

      if (f.created_from || f.created_to) {
        const range: any = {};
        if (f.created_from) range.gte = f.created_from;
        if (f.created_to) range.lte = f.created_to;
        mustFilters.push({ range: { created_at: range } });
      }

      if (f.loan_amount_min_minor_units !== undefined || f.loan_amount_max_minor_units !== undefined) {
        const range: any = {};
        if (f.loan_amount_min_minor_units !== undefined) range.gte = f.loan_amount_min_minor_units;
        if (f.loan_amount_max_minor_units !== undefined) range.lte = f.loan_amount_max_minor_units;
        mustFilters.push({ range: { loan_amount_minor_units: range } });
      }

      for (const [key, value] of Object.entries(f)) {
        if (['status', 'created_from', 'created_to', 'loan_amount_min_minor_units', 'loan_amount_max_minor_units'].includes(key)) {
          continue;
        }
        if (value !== undefined && value !== null && value !== '') {
          const cleanKey = key.replace(/^metadata\./, '');
          mustFilters.push({ term: { [cleanKey]: value } });
        }
      }
    } else {
      mustFilters.push({ term: { status: 'ACTIVE' } });
    }

    const queryBody: any = {
      size: pageSize,
      query: {
        bool: {
          must: mustFilters,
        },
      },
      sort: [{ [sortField]: { order: sortDir } }, { document_id: { order: 'asc' } }],
    };

    if (params.cursor && Array.isArray(params.cursor)) {
      queryBody.search_after = params.cursor;
    }

    try {
      const response = await client.search({
        index: INDEX_NAME,
        body: queryBody,
      });

      const hits = response.body.hits?.hits || [];
      const total = typeof response.body.hits?.total === 'number' ? response.body.hits.total : response.body.hits?.total?.value || 0;

      const items = hits.map((hit: any) => hit._source);
      const lastHit = hits[hits.length - 1];
      const next_cursor = lastHit ? lastHit.sort : null;

      return { items, next_cursor, total };
    } catch (err: any) {
      if (err.statusCode === 404 || err.message?.includes('index_not_found_exception')) {
        return { items: [], next_cursor: null, total: 0 };
      }
      throw new SearchUnavailableError(`OpenSearch query failed: ${err.message}`);
    }
  }
}
