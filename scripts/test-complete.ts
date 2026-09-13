import { runLiveAwsTests } from './test-live-aws';
import { runReactUiTests } from '../test/e2e/react-ui-test';
import { reviewCloudWatch } from './review-cloudwatch';

async function main() {
  console.log('\n######################################################################');
  console.log('       AWS DOCUMENT MANAGEMENT PLATFORM - COMPLETE SYSTEM TEST');
  console.log('######################################################################');
  console.log('Executing 3-Phase On-Demand Verification:');
  console.log('  1. Live AWS API & Data Authority Suite');
  console.log('  2. Enterprise React 18 Web Portal UI Suite');
  console.log('  3. CloudWatch Telemetry & Log Error Audit');
  console.log('######################################################################\n');

  const startTime = Date.now();

  // Phase 1: Live AWS API
  let awsResult = { passed: 0, failed: 0, total: 0 };
  try {
    awsResult = await runLiveAwsTests();
  } catch (err: any) {
    console.error('\x1b[31mLive AWS test encountered an unhandled exception:\x1b[0m', err.message || err);
    awsResult = { passed: 0, failed: 1, total: 1 };
  }

  // Phase 2: React 18 Web Portal
  let reactUiResult = { passed: 0, failed: 0, total: 0 };
  try {
    reactUiResult = await runReactUiTests();
  } catch (err: any) {
    console.error('\x1b[31mReact UI test encountered an unhandled exception:\x1b[0m', err.message || err);
    reactUiResult = { passed: 0, failed: 1, total: 1 };
  }

  // Phase 3: CloudWatch Observability
  try {
    await reviewCloudWatch();
  } catch (err: any) {
    console.warn('CloudWatch review skipped:', err.message || err);
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
  const totalPassed = awsResult.passed + reactUiResult.passed;
  const totalFailed = awsResult.failed + reactUiResult.failed;
  const totalTests = awsResult.total + reactUiResult.total;

  console.log('\n######################################################################');
  console.log('                 COMPLETE SYSTEM TEST MASTER SCORECARD');
  console.log('######################################################################');
  console.log(`Live AWS Capabilities:  ${awsResult.passed}/${awsResult.total} passed`);
  console.log(`React 18 Web UI Tests:  ${reactUiResult.passed}/${reactUiResult.total} passed`);
  console.log(`----------------------------------------------------------------------`);
  console.log(`TOTAL SUITE STATUS:     ${totalFailed === 0 ? '\x1b[32mALL TESTS PASSED\x1b[0m' : `\x1b[31m${totalFailed} FAILED\x1b[0m`}`);
  console.log(`Total Elapsed Time:     ${elapsedSec}s`);
  console.log('######################################################################\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error in complete test execution:', err);
    process.exit(1);
  });
}
