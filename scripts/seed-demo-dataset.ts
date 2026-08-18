import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface SyntheticDocument {
  document_id: string;
  document_class: string;
  document_type: string;
  customer_id: string;
  loan_number: string;
  loan_amount_minor_units: number;
  currency: string;
  loan_type: string;
  branch_code: string;
  signed_date: string;
  filename: string;
  content_type: string;
  content_length: number;
  metadata_revision: number;
  application_version: number;
}

const DOCUMENT_TYPES = ['SIGNED_AGREEMENT', 'APPLICATION', 'DISCLOSURE', 'PROMISSORY_NOTE'];
const LOAN_TYPES = ['MORTGAGE', 'PERSONAL', 'COMMERCIAL', 'AUTO'];
const BRANCH_CODES = ['TLV-01', 'TLV-02', 'TLV-04', 'HAIFA-01', 'BEER-02'];
const CURRENCIES = ['ILS', 'USD', 'EUR'];
const EXTENSIONS = [
  { ext: 'pdf', mime: 'application/pdf' },
  { ext: 'tiff', mime: 'image/tiff' },
  { ext: 'jpg', mime: 'image/jpeg' },
  { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
];

export function generateSyntheticDataset(count = 100): SyntheticDocument[] {
  const dataset: SyntheticDocument[] = [];
  const baseDate = new Date('2026-01-01').getTime();

  for (let i = 1; i <= count; i++) {
    const docId = uuidv4();
    const custId = `IL-${Math.floor(1000000 + Math.random() * 9000000)}`;
    const loanNum = `LN-2026-${Math.floor(10000 + Math.random() * 90000)}`;
    const amount = Math.floor(5000000 + Math.random() * 95000000); // 50,000 to 1,000,000 minor units
    const fileType = EXTENSIONS[i % EXTENSIONS.length];
    const isLarge = i % 10 === 0;
    const contentLength = isLarge ? 5242880 + i * 1024 : 102400 + (i % 20) * 10240; // Some >4MB

    const randomTimestamp = new Date(baseDate + Math.random() * (180 * 24 * 60 * 60 * 1000)).toISOString().substring(0, 10);

    dataset.push({
      document_id: docId,
      document_class: 'loan_agreement',
      document_type: DOCUMENT_TYPES[i % DOCUMENT_TYPES.length],
      customer_id: custId,
      loan_number: loanNum,
      loan_amount_minor_units: amount,
      currency: CURRENCIES[i % CURRENCIES.length],
      loan_type: LOAN_TYPES[i % LOAN_TYPES.length],
      branch_code: BRANCH_CODES[i % BRANCH_CODES.length],
      signed_date: randomTimestamp,
      filename: `loan_${loanNum}.${fileType.ext}`,
      content_type: fileType.mime,
      content_length: contentLength,
      metadata_revision: 1,
      application_version: 1,
    });
  }

  return dataset;
}

if (require.main === module) {
  const dataset = generateSyntheticDataset(100);
  const outDir = path.join(__dirname, '../dist');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outFile = path.join(outDir, 'demo_dataset.json');
  fs.writeFileSync(outFile, JSON.stringify(dataset, null, 2));
  console.log(`Generated ${dataset.length} synthetic loan agreement records at ${outFile}`);
}
