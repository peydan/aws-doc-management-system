import { validateMetadataSchema } from '../../src/shared/validator';
import { ValidationError } from '../../src/shared/errors';

describe('Metadata Validator Unit Tests', () => {
  const validMetadata = {
    annotation_schema: 'bank.document-metadata/1',
    document_id: '550e8400-e29b-41d4-a716-446655440000',
    document_class: 'loan_agreement',
    application_version: 1,
    metadata_revision: 1,
    schema_version: 1,
    document_type: 'SIGNED_AGREEMENT',
    customer_id: 'IL-4492817',
    loan_number: 'LN-2026-88821',
    loan_amount_minor_units: 90000000,
    currency: 'ILS',
    loan_type: 'MORTGAGE',
    branch_code: 'TLV-04',
    signed_date: '2026-07-15',
    content_type: 'application/pdf',
    content_length: 204800,
    filename: 'loan_LN-2026-88821.pdf',
  };

  it('should validate valid metadata without throwing', () => {
    expect(() => validateMetadataSchema(validMetadata)).not.toThrow();
  });

  it('should throw ValidationError if required field customer_id is missing', () => {
    const invalid = { ...validMetadata };
    delete (invalid as any).customer_id;
    expect(() => validateMetadataSchema(invalid)).toThrow(ValidationError);
  });

  it('should throw ValidationError if document_type is not in approved enum', () => {
    const invalid = { ...validMetadata, document_type: 'INVALID_ENUM' };
    expect(() => validateMetadataSchema(invalid)).toThrow(ValidationError);
  });
});
