import { S3Manager } from '../../src/shared/s3';
import { NotFoundError } from '../../src/shared/errors';

describe('S3 Annotations Feature Unit Tests', () => {
  const documentClass = 'loan_agreement';
  const documentId = 'test-doc-12345';
  const s3VersionId = 'mock-version-999';
  const metadata = {
    annotation_schema: 'bank.document-metadata/1',
    document_id: documentId,
    document_class: documentClass,
    application_version: 1,
    metadata_revision: 1,
    customer_id: 'IL-998811',
    loan_number: 'LN-998811',
  };

  beforeAll(() => {
    process.env.MOCK_STORAGE_BYPASS = 'true';
  });

  it('should format canonical document key without sidecar extension', () => {
    const key = S3Manager.getDocumentKey(documentClass, documentId);
    expect(key).toBe('documents/' + documentClass + '/' + documentId);
    expect(key.endsWith('.annotation.json')).toBe(false);
  });

  it('should attach and retrieve native S3 annotation directly', async () => {
    const putRes = await S3Manager.putAnnotation(documentClass, documentId, s3VersionId, metadata);
    expect(putRes.eTag).toBeDefined();

    const getRes = await S3Manager.getAnnotation(documentClass, documentId, s3VersionId);
    expect(getRes.metadata).toEqual(metadata);
    expect(getRes.metadata.customer_id).toBe('IL-998811');
  });

  it('should support updating annotation with incremented revision', async () => {
    const updatedMeta = { ...metadata, metadata_revision: 2, status: 'UPDATED' };
    await S3Manager.putAnnotation(documentClass, documentId, s3VersionId, updatedMeta);

    const getRes = await S3Manager.getAnnotation(documentClass, documentId, s3VersionId);
    expect(getRes.metadata.metadata_revision).toBe(2);
    expect(getRes.metadata.status).toBe('UPDATED');
  });

  it('should throw NotFoundError for non-existent document annotation', async () => {
    await expect(S3Manager.getAnnotation(documentClass, 'non-existent-id')).rejects.toThrow(NotFoundError);
  });

  it('should delete annotation successfully', async () => {
    const tempDocId = 'temp-doc-to-delete';
    await S3Manager.putAnnotation(documentClass, tempDocId, 'v1', metadata);
    const before = await S3Manager.getAnnotation(documentClass, tempDocId, 'v1');
    expect(before.metadata).toBeDefined();

    await S3Manager.deleteAnnotation(documentClass, tempDocId, 'v1');
    await expect(S3Manager.getAnnotation(documentClass, tempDocId, 'v1')).rejects.toThrow(NotFoundError);
  });
});
