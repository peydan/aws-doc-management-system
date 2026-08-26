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

  describe('Compliance Retention Schema Tests', () => {
    const validRetention = {
      annotation_schema: 'bank.document-metadata/compliance_retention/1',
      document_id: '550e8400-e29b-41d4-a716-446655440001',
      document_class: 'compliance_retention',
      application_version: 1,
      metadata_revision: 1,
      schema_version: 1,
      document_type: 'FINANCIAL_LEDGER',
      retention_schedule_code: 'RET-FIN-7Y',
      retention_period_years: 7,
      regulatory_framework: 'SOX',
      retention_start_date: '2026-08-01',
      retention_expiry_date: '2033-08-01',
      legal_hold_active: false,
      disposal_action: 'TRANSITION_TO_GLACIER',
      compliance_officer_id: 'OFFICER-4491',
      content_type: 'application/pdf',
      content_length: 1048576,
      filename: 'audit_ledger.pdf',
    };

    it('should validate valid compliance_retention metadata', () => {
      expect(() => validateMetadataSchema(validRetention)).not.toThrow();
    });

    it('should throw ValidationError if retention_schedule_code pattern is invalid', () => {
      const invalid = { ...validRetention, retention_schedule_code: 'invalid_code' };
      expect(() => validateMetadataSchema(invalid)).toThrow(ValidationError);
    });
  });

  describe('Security Classification Schema Tests', () => {
    const validSecurity = {
      annotation_schema: 'bank.document-metadata/security_classification/1',
      document_id: '550e8400-e29b-41d4-a716-446655440002',
      document_class: 'security_classification',
      application_version: 1,
      metadata_revision: 1,
      schema_version: 1,
      document_type: 'BOARD_RESOLUTION',
      confidentiality_tier: 'HIGHLY_CONFIDENTIAL',
      contains_pii: true,
      pii_categories: ['FINANCIAL_ACCOUNT', 'CREDIT_SCORE'],
      minimum_clearance_role: 'Executive.Only',
      encryption_requirement: 'SSE_KMS_CUSTOM_KEY',
      data_residency_jurisdiction: 'IL',
      export_restricted: true,
      classification_owner: 'CISO_OFFICE',
      content_type: 'application/pdf',
      content_length: 524288,
      filename: 'board_minutes.pdf',
    };

    it('should validate valid security_classification metadata', () => {
      expect(() => validateMetadataSchema(validSecurity)).not.toThrow();
    });

    it('should throw ValidationError if confidentiality_tier is invalid', () => {
      const invalid = { ...validSecurity, confidentiality_tier: 'TOP_SECRET' };
      expect(() => validateMetadataSchema(invalid)).toThrow(ValidationError);
    });
  });

  it('should throw ValidationError for unsupported document_class', () => {
    const invalid = { ...validMetadata, document_class: 'unknown_class' };
    expect(() => validateMetadataSchema(invalid)).toThrow(ValidationError);
  });
});
