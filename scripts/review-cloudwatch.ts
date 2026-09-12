import * as https from 'https';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const aws4 = require('aws4');

const REGION = process.env.AWS_REGION || 'us-east-1';

async function callAwsApi(service: string, action: string, body: any, targetPrefix?: string): Promise<any> {
  const credentials = await defaultProvider()();
  const host = `${service}.${REGION}.amazonaws.com`;
  const bodyStr = JSON.stringify(body);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-amz-json-1.1',
  };

  if (targetPrefix) {
    headers['X-Amz-Target'] = `${targetPrefix}.${action}`;
  }

  const opts: any = {
    host,
    method: 'POST',
    path: '/',
    headers,
    body: bodyStr,
    service,
    region: REGION,
  };

  aws4.sign(opts, credentials);

  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

export async function reviewCloudWatch(): Promise<void> {
  console.log('\n======================================================================');
  console.log('       AWS CLOUDWATCH ON-DEMAND OBSERVABILITY REVIEW (POC)');
  console.log('======================================================================');
  console.log(`Target Region: ${REGION}`);
  console.log(`Scan Window:   Last 1 Hour`);
  console.log(`Cost:          $0 (Zero standing cost, on-demand API queries only)`);
  console.log('----------------------------------------------------------------------\n');

  try {
    // 1. Scan Lambda Log Groups for Errors
    console.log('1. Scanning Lambda CloudWatch Log Groups:');
    const logGroupsRes = await callAwsApi('logs', 'DescribeLogGroups', {
      logGroupNamePrefix: '/aws/lambda/',
      limit: 50,
    }, 'Logs_20140328');

    const logGroups = (logGroupsRes.logGroups || []).filter((g: any) =>
      g.logGroupName.includes('doc-platform') ||
      g.logGroupName.includes('DocPlatform') ||
      g.logGroupName.includes('ApiStack')
    );

    if (logGroups.length === 0) {
      console.log('  No matching doc-platform log groups discovered in region.');
    } else {
      console.log(`  Found ${logGroups.length} platform log groups. Checking recent events...\n`);
      for (const group of logGroups.slice(0, 8)) {
        const shortName = group.logGroupName.split('/').pop();
        process.stdout.write(`  - ${shortName}: `);

        // Get latest stream
        const streamsRes = await callAwsApi('logs', 'DescribeLogStreams', {
          logGroupName: group.logGroupName,
          orderBy: 'LastEventTime',
          descending: true,
          limit: 1,
        }, 'Logs_20140328');

        const latestStream = streamsRes.logStreams?.[0];
        if (!latestStream) {
          console.log('\x1b[90m(No streams)\x1b[0m');
          continue;
        }

        const eventsRes = await callAwsApi('logs', 'GetLogEvents', {
          logGroupName: group.logGroupName,
          logStreamName: latestStream.logStreamName,
          limit: 20,
        }, 'Logs_20140328');

        const events = eventsRes.events || [];
        const errorEvents = events.filter((e: any) =>
          e.message && (e.message.includes('ERROR') || e.message.includes('Exception') || e.message.includes('Task timed out'))
        );

        if (errorEvents.length > 0) {
          console.log(`\x1b[31m${errorEvents.length} error(s) detected!\x1b[0m`);
          for (const err of errorEvents.slice(0, 2)) {
            console.log(`    \x1b[90m${err.message.trim().slice(0, 100)}...\x1b[0m`);
          }
        } else {
          console.log(`\x1b[32mOK\x1b[0m (last stream: ${new Date(latestStream.lastEventTimestamp || Date.now()).toLocaleTimeString()})`);
        }
      }
    }

    // 2. Query CloudWatch Metric Statistics for API Gateway
    console.log('\n2. Querying API Gateway CloudWatch Metrics (Last 1h):');
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 3600 * 1000);

    const metricsPayload = {
      MetricDataQueries: [
        {
          Id: 'api_requests',
          MetricStat: {
            Metric: {
              Namespace: 'AWS/ApiGateway',
              MetricName: 'Count',
              Dimensions: [{ Name: 'ApiName', Value: 'doc-platform-mvp-api' }],
            },
            Period: 3600,
            Stat: 'Sum',
          },
        },
        {
          Id: 'api_5xx',
          MetricStat: {
            Metric: {
              Namespace: 'AWS/ApiGateway',
              MetricName: '5XXError',
              Dimensions: [{ Name: 'ApiName', Value: 'doc-platform-mvp-api' }],
            },
            Period: 3600,
            Stat: 'Sum',
          },
        },
        {
          Id: 'api_4xx',
          MetricStat: {
            Metric: {
              Namespace: 'AWS/ApiGateway',
              MetricName: '4XXError',
              Dimensions: [{ Name: 'ApiName', Value: 'doc-platform-mvp-api' }],
            },
            Period: 3600,
            Stat: 'Sum',
          },
        },
        {
          Id: 'api_latency',
          MetricStat: {
            Metric: {
              Namespace: 'AWS/ApiGateway',
              MetricName: 'Latency',
              Dimensions: [{ Name: 'ApiName', Value: 'doc-platform-mvp-api' }],
            },
            Period: 3600,
            Stat: 'Average',
          },
        },
      ],
      StartTime: Math.floor(startTime.getTime() / 1000),
      EndTime: Math.floor(endTime.getTime() / 1000),
    };

    const metricRes = await callAwsApi('monitoring', 'GetMetricData', metricsPayload);
    const results = metricRes.MetricDataResults || [];

    const getVal = (id: string) => results.find((r: any) => r.Id === id)?.Values?.[0] || 0;
    const reqCount = getVal('api_requests');
    const err5xx = getVal('api_5xx');
    const err4xx = getVal('api_4xx');
    const latency = getVal('api_latency');

    console.log(`  - Total API Invocations:  ${reqCount}`);
    console.log(`  - 5XX Server Errors:      ${err5xx > 0 ? `\x1b[31m${err5xx}\x1b[0m` : `\x1b[32m0\x1b[0m`}`);
    console.log(`  - 4XX Client Errors:      ${err4xx}`);
    console.log(`  - Average API Latency:    ${latency ? `${Math.round(latency)}ms` : 'N/A'}`);

    console.log('\n======================================================================');
    console.log('              CLOUDWATCH OBSERVABILITY REVIEW COMPLETE');
    console.log('======================================================================\n');
  } catch (err: any) {
    console.log(`\n\x1b[33mNote on AWS Credentials:\x1b[0m Could not connect to CloudWatch API.`);
    console.log(`Reason: ${err.message || String(err)}`);
    console.log('To run this review against your live AWS environment, ensure AWS credentials');
    console.log('are set in your shell (e.g. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or aws configure).\n');
  }
}

if (require.main === module) {
  reviewCloudWatch().catch(console.error);
}
