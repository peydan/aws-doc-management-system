import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import { runReactUiTests } from '../test/e2e/react-ui-test';

const region = process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1';
const account = process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID;

if (!account) {
  console.error('❌ Error: Missing AWS Account ID. Please set CDK_DEFAULT_ACCOUNT or AWS_ACCOUNT_ID environment variable.');
  process.exit(1);
}

const bucketName = `doc-platform-react-ui-${account}-${region}`;

const s3 = new S3Client({ region });

function getContentType(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function uploadDirectory(dir: string, prefix = '') {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const s3Key = prefix ? `${prefix}/${file}` : file;
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      await uploadDirectory(fullPath, s3Key);
    } else {
      const fileContent = fs.readFileSync(fullPath);
      const contentType = getContentType(fullPath);

      console.log(`Uploading s3://${bucketName}/${s3Key} (${contentType})...`);
      await s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
          Body: fileContent,
          ContentType: contentType,
        })
      );
    }
  }
}

async function verifyDeployment(): Promise<void> {
  console.log('\n--- Verifying React S3 Bucket Objects & Integrity ---');
  const requiredKeys = ['index.html', 'config.json'];
  for (const key of requiredKeys) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
      console.log(`  ✓ Verified s3://${bucketName}/${key} exists`);
    } catch (err: any) {
      console.warn(`  ⚠️ Warning: Could not verify s3://${bucketName}/${key}: ${err.message}`);
    }
  }

  console.log('\n--- Running React UI Test Suite ---');
  const testResults = await runReactUiTests();
  if (testResults.failed > 0) {
    throw new Error(`React UI verification suite reported ${testResults.failed} failures`);
  }
}

async function main() {
  console.log(`Starting React frontend asset upload to ${bucketName}...`);
  const distDir = path.join(__dirname, '../frontend-react/dist');

  if (!fs.existsSync(distDir)) {
    throw new Error(`frontend-react/dist not found at ${distDir}. Please run "npm run build:react" first.`);
  }

  await uploadDirectory(distDir);
  console.log(`✅ All React frontend assets uploaded successfully to s3://${bucketName}/`);

  await verifyDeployment();
  console.log('🎉 React frontend deployment and automated verification complete!');
}

main().catch((err) => {
  console.error('❌ React frontend asset upload failed:', err);
  process.exit(1);
});
