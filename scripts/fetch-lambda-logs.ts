import * as https from "https";
import * as aws4 from "aws4";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

async function callLogsApi(action: string, body: any): Promise<any> {
  const credentials = await defaultProvider()();
  const region = process.env.AWS_REGION || "us-east-1";
  const host = `logs.${region}.amazonaws.com`;

  const bodyStr = JSON.stringify(body);
  const opts: any = {
    host,
    method: "POST",
    path: "/",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `Logs_20140328.${action}`,
    },
    body: bodyStr,
    service: "logs",
    region,
  };

  aws4.sign(opts, credentials);

  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

async function checkLogGroup(prefix: string) {
  const groups = await callLogsApi("DescribeLogGroups", { logGroupNamePrefix: prefix });
  if (!groups.logGroups || groups.logGroups.length === 0) {
    console.log(`No log group for prefix: ${prefix}`);
    return;
  }
  const name = groups.logGroups[0].logGroupName;
  console.log(`\n================ ${name} ================`);
  const streams = await callLogsApi("DescribeLogStreams", {
    logGroupName: name,
    orderBy: "LastEventTime",
    descending: true,
    limit: 3,
  });

  for (const s of streams.logStreams || []) {
    console.log(`--- Stream: ${s.logStreamName} ---`);
    const events = await callLogsApi("GetLogEvents", { logGroupName: name, logStreamName: s.logStreamName, limit: 30 });
    for (const e of events.events || []) {
      console.log(e.message);
    }
  }
}

async function main() {
  await checkLogGroup("/aws/lambda/DocPlatformComputeStack-BackgroundWorkerFunction");
  await checkLogGroup("/aws/lambda/DocPlatformComputeStack-IndexerFunction");
}

if (require.main === module) {
  main().catch(console.error);
}
