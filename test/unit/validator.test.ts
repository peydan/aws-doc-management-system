import { validateMetadataSchema, buildFullMetadata } from '../../src/shared/validator';
import { ValidationError } from '../../src/shared/errors';

describe('Metadata Validator Unit Tests', () => {
  const sharedBaseMetadata = {
    customer_id: 1094827,
    complete_customer_id_code: {
      id_number: '123456789',
      id_type: 1,
    },
    account_id: {
      bank_id: 10,
      branch_id: 802,
      account_number: 123456,
    },
    account_subscription_num: 998877,
    transaction_id: 'TX-2026-9901',
    document_int: '090123458000abcd',
    document_ext: 'LEGACY-DOC-771',
    a_content_type: 'application/pdf',
    document_form_id: 'FORM-1029',
    legacy_document_entry_dttm: '2026-08-01T10:00:00Z',
    r_creation_date: '2026-08-01T10:00:00Z',
    r_modify_date: '2026-08-01T10:00:00Z',
    business_area_code: 100,
    business_sub_area_code: 101,
    document_group_id: 'GRP-FIN-001',
    created_at: '2026-08-01T10:00:00Z',
    created_by: 'USER-01',
    content_checksum: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  };

  const validLoanMetadata = {
    ...sharedBaseMetadata,
    annotation_schema: 'bank.document-metadata/1',
    document_id: '550e8400-e29b-41d4-a716-446655440000',
    document_class: 'loan_agreement',
    application_version: 1,
    metadata_revision: 1,
    schema_version: 1,
    document_type: 'SIGNED_AGREEMENT',
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

  it('should validate valid loan agreement metadata with shared properties without throwing', () => {
    expect(() => validateMetadataSchema(validLoanMetadata)).not.toThrow();
  });

  it('should throw ValidationError if shared required field customer_id is missing', () => {
    const invalid = { ...validLoanMetadata };
    delete (invalid as any).customer_id;
    expect(() => validateMetadataSchema(invalid)).toThrow(ValidationError);
  });

  it('should throw ValidationError if shared complete_customer_id_code is missing required sub-properties', () => {
    const invalid = {
      ...validLoanMetadata,
      complete_customer_id_code: { id_type: 1 }, // missing id_number
    };
    expect(() => validateMetadataSchema(invalid)).toThrow(ValidationError);
  });

  it('should throw ValidationError if shared account_id is missing branch_id', () => {
    const invalid = {
      ...validLoanMetadata,
      account_id: { bank_id: 10, account_number: 123456 }, // missing branch_id
    };
    expect(() => validateMetadataSchema(invalid)).toThrow(ValidationError);
  });

  it('should throw ValidationError if document_type is not in approved enum', () => {
    const invalid = { ...validLoanMetadata, document_type: 'INVALID_ENUM' };
    expect(() => validateMetadataSchema(invalid)).toThrow(ValidationError);
  });

  describe('Compliance Retention Schema Tests', () => {
    const validRetention = {
      ...sharedBaseMetadata,
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

    it('should validate valid compliance_retention metadata with shared properties', () => {
      expect(() => validateMetadataSchema(validRetention)).not.toThrow();
    });

    it('should throw ValidationError if retention_schedule_code pattern is invalid', () => {
      const invalid = { ...validRetention, retention_schedule_code: 'invalid_code' };
      expect(() => validateMetadataSchema(invalid)).toThrow(ValidationError);
    });

    it('should throw ValidationError if shared business_area_code is missing', () => {
      const invalid = { ...validRetention };
      delete (invalid as any).business_area_code;
      expect(() => validateMetadataSchema(invalid)).toThrow(ValidationError);
    });
  });

  describe('Security Classification Schema Tests', () => {
    const validSecurity = {
      ...sharedBaseMetadata,
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

    it('should validate valid security_classification metadata with shared properties', () => {
      expect(() => validateMetadataSchema(validSecurity)).not.toThrow();
    });

    it('should throw ValidationError if confidentiality_tier is invalid', () => {
      const invalid = { ...validSecurity, confidentiality_tier: 'TOP_SECRET' };
      expect(() => validateMetadataSchema(invalid)).toThrow(ValidationError);
    });
  });

  describe('buildFullMetadata Builder Tests', () => {
    it('should automatically populate shared defaults when not provided by client', () => {
      const fullMeta = buildFullMetadata({
        documentId: '550e8400-e29b-41d4-a716-446655440000',
        documentClass: 'loan_agreement',
        filename: 'loan_doc.pdf',
        contentType: 'application/pdf',
        contentLength: 1024,
        checksum: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        userId: 'USER-123',
        clientMetadata: {},
      });

      expect(fullMeta.customer_id).toBe(1094827);
      expect(fullMeta.complete_customer_id_code).toEqual({ id_number: '123456789', id_type: 1 });
      expect(fullMeta.account_id).toEqual({ bank_id: 10, branch_id: 802, account_number: 123456 });
      expect(fullMeta.business_area_code).toBe(100);
      expect(fullMeta.business_sub_area_code).toBe(101);

      // Verify that this generated metadata passes validation cleanly
      expect(() => validateMetadataSchema(fullMeta)).not.toThrow();
    });
  });

  it('should throw ValidationError for unsupported document_class', () => {
    const invalid = { ...validLoanMetadata, document_class: 'unknown_class' };
    expect(() => validateMetadataSchema(invalid)).toThrow(ValidationError);
  });
});
