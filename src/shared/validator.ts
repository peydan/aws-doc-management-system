import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import * as loanAgreementSchema from '../../schemas/loan_agreement-v1.json';
import { ValidationError, ErrorDetail } from './errors';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validateLoanAgreement = ajv.compile(loanAgreementSchema);

export function validateMetadataSchema(metadata: Record<string, any>): void {
  const valid = validateLoanAgreement(metadata);
  if (!valid && validateLoanAgreement.errors) {
    const details: ErrorDetail[] = validateLoanAgreement.errors.map((err) => ({
      field: err.instancePath ? `metadata${err.instancePath.replace(/\//g, '.')}` : err.params?.missingProperty || 'metadata',
      error: err.message || 'invalid',
    }));
    throw new ValidationError('Metadata validation failed against schema bank.document-metadata/1', details);
  }
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
