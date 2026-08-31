import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface SyntheticDocument {
  document_id: string;
  document_class: string;
  document_type: string;
  customer_id: number;
  complete_customer_id_code: {
    id_number: string;
    id_type: number;
  };
  account_id: {
    bank_id: number;
    branch_id: number;
    account_number: number;
  };
  account_subscription_num?: number;
  transaction_id?: string;
  document_int?: string;
  document_ext?: string;
  a_content_type?: string;
  document_form_id?: string;
  legacy_document_entry_dttm?: string;
  r_creation_date?: string;
  r_modify_date?: string;
  business_area_code: number;
  business_sub_area_code: number;
  document_group_id?: string;
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
    const custId = 1000000 + (i % 50) * 137;
    const nationalId = String(300000000 + i * 1111);
    const bankId = (i % 3 === 0) ? 10 : (i % 3 === 1) ? 12 : 31;
    const branchId = 800 + (i % 15);
    const accountNum = 100000 + i * 23;
    const loanNum = `LN-2026-${Math.floor(10000 + Math.random() * 90000)}`;
    const amount = Math.floor(5000000 + Math.random() * 95000000); // 50,000 to 1,000,000 minor units
    const fileType = EXTENSIONS[i % EXTENSIONS.length];
    const isLarge = i % 10 === 0;
    const contentLength = isLarge ? 5242880 + i * 1024 : 102400 + (i % 20) * 10240; // Some >4MB

    const randomTimestamp = new Date(baseDate + Math.random() * (180 * 24 * 60 * 60 * 1000)).toISOString();
    const signedDate = randomTimestamp.substring(0, 10);

    dataset.push({
      document_id: docId,
      document_class: 'loan_agreement',
      document_type: DOCUMENT_TYPES[i % DOCUMENT_TYPES.length],
      customer_id: custId,
      complete_customer_id_code: {
        id_number: nationalId,
        id_type: 1,
      },
      account_id: {
        bank_id: bankId,
        branch_id: branchId,
        account_number: accountNum,
      },
      account_subscription_num: 880000 + i,
      transaction_id: `TX-2026-${10000 + i}`,
      document_int: `0901234580${String(i).padStart(6, '0')}`,
      document_ext: `EXT-${2026000 + i}`,
      a_content_type: fileType.mime,
      document_form_id: `FORM-${1000 + (i % 10)}`,
      legacy_document_entry_dttm: randomTimestamp,
      r_creation_date: randomTimestamp,
      r_modify_date: randomTimestamp,
      business_area_code: 100 + (i % 5),
      business_sub_area_code: 10 + (i % 3),
      document_group_id: `GRP-FIN-${Math.floor(i / 10)}`,
      loan_number: loanNum,
      loan_amount_minor_units: amount,
      currency: CURRENCIES[i % CURRENCIES.length],
      loan_type: LOAN_TYPES[i % LOAN_TYPES.length],
      branch_code: BRANCH_CODES[i % BRANCH_CODES.length],
      signed_date: signedDate,
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
