import { DynamoManager } from '../../shared/dynamo';
import { S3Manager } from '../../shared/s3';
import { Logger } from '../../shared/logger';
import { NotFoundError } from '../../shared/errors';
import { UserContext } from '../../shared/auth';
import { ROLE_CLEARANCE_RANKS, getUserClearanceRank } from './search-tool';

export interface FetchDocumentArgs {
  document_id: string;
  version?: number;
  userContext?: UserContext;
}

export interface FetchDocumentResult {
  document_id: string;
  status: string;
  application_version: number;
  metadata_revision: number;
  filename: string;
  content_type: string;
  format?: string;
  page_count?: number;
  content_length: number;
  content_checksum: string;
  created_at: string;
  metadata_updated_at?: string;
  presigned_download_url?: string;
  authoritative_metadata: Record<string, any>;
  notice?: string;
}

export async function executeFetchDocument(
  args: FetchDocumentArgs,
  userContext?: UserContext
): Promise<FetchDocumentResult> {
  if (!args.document_id) {
    throw new Error('document_id is required');
  }

  const context = userContext || args.userContext;

  Logger.info('Executing agent fetch_document tool with OBO identity context', {
    args,
    callerUser: context?.userId,
    callerRoles: context?.roles,
  });

  // 1. Resolve pointer in DynamoDB
  const doc = await DynamoManager.getDocument(args.document_id);
  if (!doc) {
    throw new NotFoundError(`Document ${args.document_id} not found`);
  }

  if (doc.status === 'SOFT_DELETED') {
    return {
      document_id: doc.document_id,
      status: 'SOFT_DELETED',
      application_version: doc.current_application_version,
      metadata_revision: doc.current_metadata_revision,
      filename: 'N/A',
      content_type: 'N/A',
      content_length: 0,
      content_checksum: '',
      created_at: doc.created_at,
      authoritative_metadata: {},
      notice: `Document ${args.document_id} has been SOFT_DELETED. Authoritative binary access is locked until restored by an administrator.`,
    };
  }

  let s3VersionId = doc.current_s3_version_id;
  let appVersion = doc.current_application_version;
  let s3Key = doc.current_s3_key;

  // 2. Historical version resolution if requested
  if (args.version && args.version !== doc.current_application_version) {
    const verItem = await DynamoManager.getVersion(args.document_id, args.version);
    if (verItem) {
      s3VersionId = verItem.s3_version_id;
      appVersion = verItem.application_version;
      s3Key = verItem.s3_key || doc.current_s3_key;
    }
  }

  // 3. Fetch authoritative S3 metadata annotation
  const anno = await S3Manager.getAnnotation(doc.document_class, args.document_id, s3VersionId);
  const metadata = anno.metadata;

  // 4. Enforce On-Behalf-Of (OBO) Clearance Verification
  if (context && !context.roles.includes('Document.Admin')) {
    const userRank = getUserClearanceRank(context.roles);
    const reqRole = metadata.minimum_clearance_role;
    const confidentialityTier = metadata.confidentiality_tier;

    let deniedReason: string | null = null;
    if (reqRole && ROLE_CLEARANCE_RANKS[reqRole] && ROLE_CLEARANCE_RANKS[reqRole] > userRank) {
      deniedReason = `Document requires clearance level '${reqRole}', but caller holds roles [${context.roles.join(', ')}].`;
    } else if (confidentialityTier === 'HIGHLY_CONFIDENTIAL' && userRank < 4) {
      deniedReason = `Document is classified as HIGHLY_CONFIDENTIAL and requires Document.Admin clearance.`;
    } else if (confidentialityTier === 'RESTRICTED' && userRank < 3) {
      deniedReason = `Document is classified as RESTRICTED and requires Document.MetadataEditor or Document.Admin clearance.`;
    }

    if (deniedReason) {
      Logger.warn('Agent fetch_document blocked by OBO clearance policy', {
        document_id: args.document_id,
        user: context.userId,
        roles: context.roles,
        required_clearance: reqRole || confidentialityTier,
      });

      return {
        document_id: doc.document_id,
        status: 'FORBIDDEN',
        application_version: appVersion,
        metadata_revision: doc.current_metadata_revision,
        filename: metadata.filename || 'REDACTED',
        content_type: metadata.content_type || 'application/octet-stream',
        content_length: 0,
        content_checksum: '',
        created_at: metadata.created_at || doc.created_at,
        authoritative_metadata: {
          document_id: doc.document_id,
          document_class: doc.document_class,
          status: 'FORBIDDEN',
          confidentiality_tier: confidentialityTier,
          minimum_clearance_role: reqRole,
        },
        notice: `ACCESS DENIED (OBO Clearance Policy): ${deniedReason}`,
      };
    }
  }

  // 4. Generate short-lived presigned download URL (15 minutes)
  let downloadUrl: string | undefined;
  try {
    downloadUrl = await S3Manager.generatePresignedDownloadUrl(s3Key, s3VersionId, 900);
  } catch (err: any) {
    Logger.warn('Could not generate presigned download URL in fetch_document tool', { error: err.message });
  }

  return {
    document_id: doc.document_id,
    status: doc.status,
    application_version: appVersion,
    metadata_revision: doc.current_metadata_revision,
    filename: metadata.filename || 'unknown',
    content_type: metadata.content_type || 'application/octet-stream',
    format: metadata.format,
    page_count: metadata.page_count,
    content_length: metadata.content_length || 0,
    content_checksum: metadata.content_checksum || '',
    created_at: metadata.created_at || doc.created_at,
    metadata_updated_at: metadata.metadata_updated_at,
    presigned_download_url: downloadUrl,
    authoritative_metadata: metadata,
  };
}

/**
 * Lambda handler for AgentCore Gateway MCP tool target
 */
export async function handler(event: any): Promise<any> {
  const args: FetchDocumentArgs = event.arguments || event.input || event;
  try {
    const result = await executeFetchDocument(args);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error fetching document: ${err.message}`,
        },
      ],
    };
  }
}
