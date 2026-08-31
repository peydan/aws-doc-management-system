import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';

const region = process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1';
const account = process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID;

if (!account) {
  console.error('❌ Error: Missing AWS Account ID. Please set CDK_DEFAULT_ACCOUNT or AWS_ACCOUNT_ID environment variable.');
  process.exit(1);
}

const bucketName = `doc-platform-serverless-ui-${account}-${region}`;

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

async function main() {
  console.log(`Starting frontend asset upload to ${bucketName}...`);
  const distDir = path.join(__dirname, '../frontend/dist');

  if (!fs.existsSync(distDir)) {
    throw new Error(`frontend/dist not found at ${distDir}`);
  }

  await uploadDirectory(distDir);
  console.log(`✅ All frontend assets uploaded successfully to s3://${bucketName}/`);
}

main().catch((err) => {
  console.error('❌ Frontend asset upload failed:', err);
  process.exit(1);
});
