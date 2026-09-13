import { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calculator } from 'lucide-react';

const PRICING_IL = {
  s3_storage_gb_mo: 0.025,
  s3_put_1k: 0.0055,
  s3_get_1k: 0.00044,
  dynamo_wru_million: 0.625,
  dynamo_rru_million: 0.125,
  dynamo_storage_gb_mo: 0.285,
  aoss_ocu_hr: 0.26,
  lambda_invocations_million: 0.20,
  lambda_gb_sec: 0.0000166667,
  api_gw_million: 3.50,
  kms_cmk_mo: 1.0,
  usd_to_ils_rate: 3.70,
};

export function CostCalculator() {
  const [currency, setCurrency] = useState<'USD' | 'ILS'>('ILS');

  // Workload Input Sliders
  const [docsMonthly, setDocsMonthly] = useState<number>(10000);
  const [avgSizeMb, setAvgSizeMb] = useState<number>(1.0);
  const [docsCumulative, setDocsCumulative] = useState<number>(50000);
  const [queriesMonthly, setQueriesMonthly] = useState<number>(50000);

  // Math Calculations (Memoized)
  const {
    primaryStorageGb,
    derivativeStorageGb,
    totalStorageGb,
    totalS3Cost,
    totalDynamoCost,
    ocuCount,
    aossCost,
    lambdaInvocations,
    lambdaCost,
    apiGwCost,
    cloudfrontSpaCost,
    logsAndKms,
    totalMonthlyUsd,
    costPerDocUsd,
  } = useMemo(() => {
    const primaryStorageGb = (docsCumulative * avgSizeMb) / 1024;
    const derivativeStorageGb = (queriesMonthly * 0.25 * 0.35 * (14 / 30)) / 1024;
    const totalStorageGb = primaryStorageGb + derivativeStorageGb;

    const s3StorageCost = totalStorageGb * PRICING_IL.s3_storage_gb_mo;
    const s3PutCost = ((docsMonthly * 2 + queriesMonthly * 0.25 * 0.2) * PRICING_IL.s3_put_1k) / 1000;
    const s3GetCost = (queriesMonthly * PRICING_IL.s3_get_1k) / 1000;
    const totalS3Cost = s3StorageCost + s3PutCost + s3GetCost;

    const dynamoWruCost = ((docsMonthly * 4) / 1000000) * PRICING_IL.dynamo_wru_million;
    const dynamoRruCost = ((queriesMonthly * 2) / 1000000) * PRICING_IL.dynamo_rru_million;
    const dynamoStorageCost = Math.max(0.5, (docsCumulative * 2) / 1024 / 1024) * PRICING_IL.dynamo_storage_gb_mo;
    const totalDynamoCost = dynamoWruCost + dynamoRruCost + dynamoStorageCost;

    const ocuCount = docsMonthly > 500000 ? 4.0 : 2.0;
    const aossCost = ocuCount * 730 * PRICING_IL.aoss_ocu_hr;

    const lambdaInvocations = docsMonthly * 3 + queriesMonthly;
    const lambdaCost =
      (lambdaInvocations / 1000000) * PRICING_IL.lambda_invocations_million +
      lambdaInvocations * 0.15 * 0.5 * PRICING_IL.lambda_gb_sec;

    const apiGwCost = ((docsMonthly * 2 + queriesMonthly) / 1000000) * PRICING_IL.api_gw_million;
    const cloudfrontSpaCost = 0.01;
    const logsAndKms = PRICING_IL.kms_cmk_mo + 5.0;

    const totalMonthlyUsd =
      totalS3Cost + totalDynamoCost + aossCost + lambdaCost + apiGwCost + cloudfrontSpaCost + logsAndKms;
    const costPerDocUsd = totalMonthlyUsd / Math.max(1, docsCumulative);

    return {
      primaryStorageGb,
      derivativeStorageGb,
      totalStorageGb,
      s3StorageCost,
      s3PutCost,
      s3GetCost,
      totalS3Cost,
      dynamoWruCost,
      dynamoRruCost,
      dynamoStorageCost,
      totalDynamoCost,
      ocuCount,
      aossCost,
      lambdaInvocations,
      lambdaCost,
      apiGwCost,
      cloudfrontSpaCost,
      logsAndKms,
      totalMonthlyUsd,
      costPerDocUsd,
    };
  }, [docsMonthly, avgSizeMb, docsCumulative, queriesMonthly]);

  const formatCost = (valUsd: number) => {
    if (currency === 'ILS') {
      const valIls = valUsd * PRICING_IL.usd_to_ils_rate;
      return `₪${valIls.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `$${valUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Calculator className="w-5 h-5 text-aws-orange" /> AWS Israel Region (
            <span className="text-aws-orange">il-central-1</span>) Cost Calculator
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Interactive TCO calculation model based on Tel Aviv region pricing with multi-tier breakdown
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={currency === 'USD' ? 'default' : 'outline'}
            onClick={() => setCurrency('USD')}
            className="text-xs"
          >
            USD ($)
          </Button>
          <Button
            size="sm"
            variant={currency === 'ILS' ? 'default' : 'outline'}
            onClick={() => setCurrency('ILS')}
            className="text-xs"
          >
            ILS (₪ 3.70)
          </Button>
        </div>
      </div>

      {/* 4 Summary Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-900/60 border-aws-orange/30">
          <CardContent className="p-4 space-y-1">
            <div className="text-xs text-slate-400 font-medium">Total Monthly AWS Cost</div>
            <div className="text-2xl font-bold text-aws-orange">{formatCost(totalMonthlyUsd)}</div>
            <div className="text-[11px] text-slate-500 font-mono">
              {currency === 'USD'
                ? `₪${(totalMonthlyUsd * PRICING_IL.usd_to_ils_rate).toFixed(2)} ILS / mo`
                : `$${totalMonthlyUsd.toFixed(2)} USD / mo`}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60">
          <CardContent className="p-4 space-y-1">
            <div className="text-xs text-slate-400 font-medium">Cost per Managed Doc</div>
            <div className="text-2xl font-bold text-emerald-400 font-mono">{formatCost(costPerDocUsd)}</div>
            <div className="text-[11px] text-slate-500">Zero server idle waste</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60">
          <CardContent className="p-4 space-y-1">
            <div className="text-xs text-slate-400 font-medium">Cumulative Storage</div>
            <div className="text-2xl font-bold text-slate-100">{totalStorageGb.toFixed(1)} GB</div>
            <div className="text-[11px] text-slate-500">S3 Standard + Annotations</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/60">
          <CardContent className="p-4 space-y-1">
            <div className="text-xs text-slate-400 font-medium">Active OpenSearch OCUs</div>
            <div className="text-2xl font-bold text-sky-400 font-mono">{ocuCount.toFixed(1)} OCU</div>
            <div className="text-[11px] text-slate-500">1.0 Index + 1.0 Search</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sliders Control Panel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
              <span>🎚️</span> Operational Workload Sliders
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 text-xs">
            {/* Slider 1 */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label htmlFor="cost-slider-ingestion" className="text-slate-300 font-medium">Monthly Document Ingestion Count</label>
                <span className="font-bold text-white font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  {docsMonthly.toLocaleString()} docs
                </span>
              </div>
              <input
                id="cost-slider-ingestion"
                type="range"
                min={1000}
                max={2000000}
                step={5000}
                value={docsMonthly}
                aria-label="Monthly Document Ingestion Count"
                onChange={(e) => setDocsMonthly(parseInt(e.target.value, 10))}
                className="w-full accent-aws-orange cursor-pointer"
              />
            </div>

            {/* Slider 2 */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label htmlFor="cost-slider-filesize" className="text-slate-300 font-medium">Average Document File Size</label>
                <span className="font-bold text-white font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  {avgSizeMb.toFixed(1)} MB
                </span>
              </div>
              <input
                id="cost-slider-filesize"
                type="range"
                min={0.2}
                max={10.0}
                step={0.2}
                value={avgSizeMb}
                aria-label="Average Document File Size"
                onChange={(e) => setAvgSizeMb(parseFloat(e.target.value))}
                className="w-full accent-aws-orange cursor-pointer"
              />
            </div>

            {/* Slider 3 */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label htmlFor="cost-slider-cumulative" className="text-slate-300 font-medium">Cumulative Documents Stored</label>
                <span className="font-bold text-white font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  {docsCumulative.toLocaleString()} docs
                </span>
              </div>
              <input
                id="cost-slider-cumulative"
                type="range"
                min={5000}
                max={15000000}
                step={25000}
                value={docsCumulative}
                aria-label="Cumulative Documents Stored"
                onChange={(e) => setDocsCumulative(parseInt(e.target.value, 10))}
                className="w-full accent-aws-orange cursor-pointer"
              />
            </div>

            {/* Slider 4 */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label htmlFor="cost-slider-queries" className="text-slate-300 font-medium">Monthly Read &amp; Search Queries</label>
                <span className="font-bold text-white font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  {queriesMonthly.toLocaleString()} queries
                </span>
              </div>
              <input
                id="cost-slider-queries"
                type="range"
                min={5000}
                max={5000000}
                step={25000}
                value={queriesMonthly}
                aria-label="Monthly Read and Search Queries"
                onChange={(e) => setQueriesMonthly(parseInt(e.target.value, 10))}
                className="w-full accent-aws-orange cursor-pointer"
              />
            </div>
          </CardContent>
        </Card>

        {/* Detailed Cost Breakdown Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
              <span>📋</span> Detailed Service Cost Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 px-3">AWS Service</th>
                    <th className="py-2.5 px-3">Billing Dimension</th>
                    <th className="py-2.5 px-3 text-right">Estimated Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  <tr className="hover:bg-slate-900/50">
                    <td className="py-2 px-3 font-semibold text-sky-400">OpenSearch Serverless</td>
                    <td className="py-2 px-3 text-slate-400">
                      {ocuCount} OCUs baseline ({ocuCount / 2} Index + {ocuCount / 2} Search)
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-200">
                      {formatCost(aossCost)}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-900/50">
                    <td className="py-2 px-3 font-semibold text-amber-400">Amazon S3 Standard</td>
                    <td className="py-2 px-3 text-slate-400">
                      {primaryStorageGb.toFixed(1)} GB WORM + {derivativeStorageGb.toFixed(1)} GB cached + Annotations
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-200">
                      {formatCost(totalS3Cost)}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-900/50">
                    <td className="py-2 px-3 font-semibold text-blue-400">DynamoDB (On-Demand)</td>
                    <td className="py-2 px-3 text-slate-400">
                      Pointers, sessions, versions, and OCC revision checks
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-200">
                      {formatCost(totalDynamoCost)}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-900/50">
                    <td className="py-2 px-3 font-semibold text-purple-400">API Gateway</td>
                    <td className="py-2 px-3 text-slate-400">
                      {((docsMonthly * 2 + queriesMonthly) / 1000).toFixed(0)}k REST requests / mo
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-200">
                      {formatCost(apiGwCost)}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-900/50">
                    <td className="py-2 px-3 font-semibold text-orange-400">AWS Lambda (ARM64)</td>
                    <td className="py-2 px-3 text-slate-400">
                      {(lambdaInvocations / 1000).toFixed(0)}k executions (Avg 150ms @ 512MB)
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-200">
                      {formatCost(lambdaCost)}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-900/50">
                    <td className="py-2 px-3 font-semibold text-emerald-400">Serverless UI (SPA)</td>
                    <td className="py-2 px-3 text-slate-400">
                      CloudFront Edge CDN + S3 Web Bucket (0 Idle Cost)
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-emerald-400 font-semibold">
                      {formatCost(cloudfrontSpaCost)}
                    </td>
                  </tr>

                  <tr className="hover:bg-slate-900/50">
                    <td className="py-2 px-3 font-semibold text-slate-300">AWS KMS &amp; Logs</td>
                    <td className="py-2 px-3 text-slate-400">
                      Platform CMK + Structured JSON telemetry logs
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-200">
                      {formatCost(logsAndKms)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
