import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

interface TemplateField {
  label: string;
  value: string;
}

interface DocumentTemplate {
  name: string;
  title: string;
  documentClass: string;
  documentType: string;
  classFields: TemplateField[];
}

// 15 Shared Banking & DCTM Domain Traits (Inherited by all document classes)
const SHARED_TEMPLATE_FIELDS: TemplateField[] = [
  { label: 'Customer Number (customer_id):', value: '1094827' },
  { label: 'Complete Customer ID Code:', value: 'ID Number: 123456789 | ID Type: 1 (National ID)' },
  { label: 'Compound Account ID (account_id):', value: 'Bank: 10 | Branch: 802 | Account Number: 123456' },
  { label: 'Account Subscription Number:', value: '884920' },
  { label: 'Transaction / Box Identifier:', value: 'TX-2026-99482' },
  { label: 'DCTM Internal Chronicle ID (document_int):', value: '0901234580001094' },
  { label: 'Legacy External System ID (document_ext):', value: 'EXT-2026-0091' },
  { label: 'DCTM Content Format (a_content_type):', value: 'pdf' },
  { label: 'Document Form Template Code (document_form_id):', value: 'FORM-1001' },
  { label: 'Legacy Ingestion Timestamp (legacy_document_entry_dttm):', value: '2026-09-12T10:00:00.000Z' },
  { label: 'Documentum Creation Date (r_creation_date):', value: '2026-09-12T10:00:00.000Z' },
  { label: 'Documentum Modification Date (r_modify_date):', value: '2026-09-12T10:00:00.000Z' },
  { label: 'Business Area Code (business_area_code):', value: '100' },
  { label: 'Business Sub-Area Code (business_sub_area_code):', value: '101' },
  { label: 'Document Group ID (document_group_id):', value: 'GRP-FIN-001' },
];

const templates: DocumentTemplate[] = [
  {
    name: 'loan_agreement',
    title: 'Loan Agreement Document',
    documentClass: 'loan_agreement',
    documentType: 'SIGNED_AGREEMENT',
    classFields: [
      { label: 'Document Class:', value: 'loan_agreement' },
      { label: 'Document Type:', value: 'SIGNED_AGREEMENT' },
      { label: 'Loan Account Number (loan_number):', value: 'LN-2026-88821' },
      { label: 'Loan Principal Amount (minor units):', value: '15,000,000 ($150,000.00)' },
      { label: 'Currency Code (currency):', value: 'USD' },
      { label: 'Loan Facility Type (loan_type):', value: 'MORTGAGE' },
      { label: 'Originating Branch Code (branch_code):', value: 'TLV-01' },
      { label: 'Agreement Signed Date (signed_date):', value: '2026-09-12' },
    ],
  },
  {
    name: 'compliance_retention',
    title: 'Compliance & Retention Record',
    documentClass: 'compliance_retention',
    documentType: 'FINANCIAL_LEDGER',
    classFields: [
      { label: 'Document Class:', value: 'compliance_retention' },
      { label: 'Document Type:', value: 'FINANCIAL_LEDGER' },
      { label: 'Retention Schedule Code:', value: 'RET-FIN-001' },
      { label: 'Retention Period (years):', value: '7 Years' },
      { label: 'Regulatory Framework:', value: 'SOX' },
      { label: 'Retention Start Date:', value: '2026-01-01' },
      { label: 'Retention Expiry Date:', value: '2033-01-01' },
      { label: 'Legal Hold Active Status:', value: 'false (No Active Litigation)' },
      { label: 'Mandated Disposal Action:', value: 'PERMANENT_DELETE' },
      { label: 'Compliance Officer ID:', value: 'USR-COMP-9912' },
    ],
  },
  {
    name: 'security_classification',
    title: 'Governance & Security Document',
    documentClass: 'security_classification',
    documentType: 'BOARD_RESOLUTION',
    classFields: [
      { label: 'Document Class:', value: 'security_classification' },
      { label: 'Document Type:', value: 'BOARD_RESOLUTION' },
      { label: 'Confidentiality Tier:', value: 'HIGHLY_CONFIDENTIAL' },
      { label: 'Contains PII:', value: 'true' },
      { label: 'PII Categories Present:', value: 'NATIONAL_ID, FINANCIAL_ACCOUNT' },
      { label: 'Minimum Clearance Role:', value: 'Document.Admin' },
      { label: 'Encryption Requirement:', value: 'SSE_KMS_DEFAULT' },
      { label: 'Export Restricted Flag:', value: 'false' },
      { label: 'Security Classification Owner:', value: 'CISO_OFFICE' },
    ],
  },
];

function drawField(
  page: any,
  label: string,
  value: string,
  x: number,
  y: number,
  fontBold: any,
  fontRegular: any,
  fontSize = 8.5
) {
  page.drawText(label, {
    x,
    y,
    size: fontSize,
    font: fontBold,
    color: rgb(0.12, 0.15, 0.22),
  });
  const labelWidth = fontBold.widthOfTextAtSize(label, fontSize);
  page.drawText(value, {
    x: x + labelWidth + 5,
    y,
    size: fontSize,
    font: fontRegular,
    color: rgb(0.25, 0.28, 0.35),
  });
}

export async function generatePdfs() {
  const outputDir = path.join(__dirname, '..', 'sample_pdfs');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const template of templates) {
    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    const page = pdfDoc.addPage([595.28, 841.89]); // Standard A4
    const { width, height } = page.getSize();

    const leftMargin = 45;
    const rightMargin = width - 45;
    const contentWidth = rightMargin - leftMargin;

    // Header Band
    page.drawRectangle({
      x: leftMargin,
      y: height - 60,
      width: contentWidth,
      height: 2,
      color: rgb(0.08, 0.24, 0.52),
    });

    page.drawText('AWS DOCUMENT MANAGEMENT PLATFORM — SAMPLE SPECIFICATION', {
      x: leftMargin,
      y: height - 52,
      size: 9,
      font: helveticaBold,
      color: rgb(0.35, 0.42, 0.52),
    });

    // Main Title
    page.drawText(template.title, {
      x: leftMargin,
      y: height - 90,
      size: 20,
      font: helveticaBold,
      color: rgb(0.06, 0.18, 0.4),
    });

    page.drawText(`Class: ${template.documentClass}  |  Type: ${template.documentType}  |  Format: Canonical PDF Sample`, {
      x: leftMargin,
      y: height - 108,
      size: 9.5,
      font: helveticaOblique,
      color: rgb(0.3, 0.35, 0.45),
    });

    // Section 1: Shared Banking & DCTM Metadata (Inherited Traits)
    let yPos = height - 135;
    page.drawText('1. SHARED BANKING & DCTM DOMAIN TRAITS (Inherited by All Classes)', {
      x: leftMargin,
      y: yPos,
      size: 11,
      font: helveticaBold,
      color: rgb(0.08, 0.24, 0.52),
    });

    page.drawLine({
      start: { x: leftMargin, y: yPos - 5 },
      end: { x: rightMargin, y: yPos - 5 },
      thickness: 0.75,
      color: rgb(0.8, 0.84, 0.9),
    });

    yPos -= 20;
    const lineHeight = 14.5;
    for (const field of SHARED_TEMPLATE_FIELDS) {
      drawField(page, field.label, field.value, leftMargin + 8, yPos, helveticaBold, helvetica, 8.5);
      yPos -= lineHeight;
    }

    // Section 2: Class-Specific Domain Metadata
    yPos -= 8;
    page.drawText(`2. CLASS-SPECIFIC METADATA ATTRIBUTES (${template.documentClass})`, {
      x: leftMargin,
      y: yPos,
      size: 11,
      font: helveticaBold,
      color: rgb(0.08, 0.24, 0.52),
    });

    page.drawLine({
      start: { x: leftMargin, y: yPos - 5 },
      end: { x: rightMargin, y: yPos - 5 },
      thickness: 0.75,
      color: rgb(0.8, 0.84, 0.9),
    });

    yPos -= 20;
    for (const field of template.classFields) {
      drawField(page, field.label, field.value, leftMargin + 8, yPos, helveticaBold, helvetica, 8.5);
      yPos -= lineHeight;
    }

    // Notice Callout Box
    yPos -= 10;
    const boxHeight = 72;
    page.drawRectangle({
      x: leftMargin,
      y: yPos - boxHeight,
      width: contentWidth,
      height: boxHeight,
      color: rgb(0.96, 0.97, 0.99),
      borderColor: rgb(0.82, 0.86, 0.92),
      borderWidth: 1,
    });

    page.drawText('Tri-Partite Source of Truth & Architectural Authority Invariants', {
      x: leftMargin + 12,
      y: yPos - 16,
      size: 9,
      font: helveticaBold,
      color: rgb(0.08, 0.24, 0.52),
    });

    page.drawText('• Content Authority: Stored in S3 WORM Object Storage with immutable binary versioning.', {
      x: leftMargin + 12,
      y: yPos - 30,
      size: 8,
      font: helvetica,
      color: rgb(0.25, 0.28, 0.35),
    });

    page.drawText('• Metadata Authority: Full JSON payload attached directly as S3 Object Annotation (document-metadata).', {
      x: leftMargin + 12,
      y: yPos - 43,
      size: 8,
      font: helvetica,
      color: rgb(0.25, 0.28, 0.35),
    });

    page.drawText('• Control Plane: DynamoDB single-table enforces active version pointers and optimistic concurrency control.', {
      x: leftMargin + 12,
      y: yPos - 56,
      size: 8,
      font: helvetica,
      color: rgb(0.25, 0.28, 0.35),
    });

    // Footer
    page.drawLine({
      start: { x: leftMargin, y: 45 },
      end: { x: rightMargin, y: 45 },
      thickness: 0.5,
      color: rgb(0.82, 0.85, 0.88),
    });

    page.drawText('Generated by AWS Document Management Platform Build Suite  |  Confidential & Proprietary', {
      x: leftMargin,
      y: 32,
      size: 8,
      font: helvetica,
      color: rgb(0.5, 0.55, 0.62),
    });

    page.drawText('Page 1 of 1', {
      x: rightMargin - 45,
      y: 32,
      size: 8,
      font: helvetica,
      color: rgb(0.5, 0.55, 0.62),
    });

    const pdfBytes = await pdfDoc.save();
    const outputPath = path.join(outputDir, `${template.name}-sample.pdf`);
    fs.writeFileSync(outputPath, pdfBytes);

    console.log(`Generated: ${outputPath} (${pdfBytes.length} bytes)`);
  }
}

if (require.main === module) {
  generatePdfs().catch(console.error);
}
