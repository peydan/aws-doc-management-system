import { OpenSearchManager, SearchFilters } from '../../shared/opensearch';
import { Logger } from '../../shared/logger';
import { UserContext } from '../../shared/auth';

export const ROLE_CLEARANCE_RANKS: Record<string, number> = {
  'Document.Reader': 1,
  'Document.Writer': 2,
  'Document.MetadataEditor': 3,
  'Document.Admin': 4,
  'Compliance.Auditor': 4,
  'Executive.Only': 5,
};

export function getUserClearanceRank(roles: string[] = []): number {
  let maxRank = 0;
  for (const r of roles) {
    if (ROLE_CLEARANCE_RANKS[r] && ROLE_CLEARANCE_RANKS[r] > maxRank) {
      maxRank = ROLE_CLEARANCE_RANKS[r];
    }
  }
  return maxRank;
}

export interface SearchDocumentsArgs {
  query?: string;
  customer_id?: number | string;
  loan_number?: string;
  document_class?: string;
  document_type?: string;
  loan_type?: string;
  branch_code?: string;
  created_from?: string;
  created_to?: string;
  limit?: number;
  userContext?: UserContext;
}

export interface DocumentSummary {
  document_id: string;
  filename: string;
  document_class: string;
  document_type?: string;
  status: string;
  application_version: number;
  metadata_revision: number;
  content_type?: string;
  format?: string;
  page_count?: number;
  created_at: string;
  customer_id?: number;
  loan_number?: string;
  loan_amount_minor_units?: number;
  currency?: string;
  loan_type?: string;
  branch_code?: string;
}

export interface SearchToolResult {
  total_found: number;
  count_returned: number;
  documents: DocumentSummary[];
  search_criteria_applied: SearchDocumentsArgs;
}

export async function executeSearchDocuments(
  args: SearchDocumentsArgs,
  userContext?: UserContext
): Promise<SearchToolResult> {
  const context = userContext || args.userContext;
  const limit = Math.min(Math.max(args.limit || 5, 1), 20);

  const filters: SearchFilters = {};
  if (args.document_class) filters.document_class = args.document_class;
  if (args.customer_id) filters.customer_id = args.customer_id;
  if (args.document_type) filters.document_type = args.document_type;
  if (args.loan_type) filters.loan_type = args.loan_type;
  if (args.branch_code) filters.branch_code = args.branch_code;
  if (args.created_from) filters.created_from = args.created_from;
  if (args.created_to) filters.created_to = args.created_to;

  // If query is provided and looks like a loan number or filename, route appropriately
  if (args.loan_number) {
    (filters as any).loan_number = args.loan_number;
  } else if (args.query) {
    if (args.query.toUpperCase().startsWith('LN-')) {
      (filters as any).loan_number = args.query.toUpperCase();
    } else {
      filters.filename = args.query;
    }
  }

  Logger.info('Executing agent search_documents tool with OBO identity context', {
    args,
    filters,
    limit,
    callerUser: context?.userId,
    callerRoles: context?.roles,
  });

  try {
    const searchRes = await OpenSearchManager.searchDocuments({
      filters,
      page_size: limit,
      sort: { field: 'created_at', direction: 'desc' },
    });

    const userRank = context ? getUserClearanceRank(context.roles) : 4;
    const isAdmin = context ? context.roles.includes('Document.Admin') : true;

    // Defense-in-depth: filter documents that exceed the user's clearance
    const authorizedItems = (searchRes.items || []).filter((item) => {
      if (isAdmin) return true;
      const reqRole = item.minimum_clearance_role;
      if (reqRole && ROLE_CLEARANCE_RANKS[reqRole] && ROLE_CLEARANCE_RANKS[reqRole] > userRank) {
        return false;
      }
      if (item.confidentiality_tier === 'HIGHLY_CONFIDENTIAL' && userRank < 4) {
        return false;
      }
      if (item.confidentiality_tier === 'RESTRICTED' && userRank < 3) {
        return false;
      }
      return true;
    });

    const documents: DocumentSummary[] = authorizedItems.map((item) => ({
      document_id: item.document_id,
      filename: item.filename,
      document_class: item.document_class,
      document_type: item.document_type,
      status: item.status || 'ACTIVE',
      application_version: item.application_version || 1,
      metadata_revision: item.metadata_revision || 1,
      content_type: item.content_type,
      format: item.format,
      page_count: item.page_count,
      created_at: item.created_at,
      customer_id: item.customer_id,
      loan_number: item.loan_number,
      loan_amount_minor_units: item.loan_amount_minor_units,
      currency: item.currency,
      loan_type: item.loan_type,
      branch_code: item.branch_code,
    }));

    return {
      total_found: authorizedItems.length,
      count_returned: documents.length,
      documents,
      search_criteria_applied: args,
    };
  } catch (err: any) {
    Logger.warn('OpenSearch query in search_documents tool failed, returning empty set with error notice', {
      error: err.message,
    });
    return {
      total_found: 0,
      count_returned: 0,
      documents: [],
      search_criteria_applied: args,
    };
  }
}

/**
 * Lambda handler for AgentCore Gateway MCP tool target
 */
export async function handler(event: any): Promise<any> {
  const args: SearchDocumentsArgs = event.arguments || event.input || event;
  const result = await executeSearchDocuments(args);

  // Return standard MCP tool content response
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
