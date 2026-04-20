import type {EvalRunRecord} from './types';

export function formatEvalRunSummary(record: EvalRunRecord): string {
  const caseSummary = [
    `cases: ${record.counts.passed} passed`,
    `${record.counts.failed} failed`,
  ];
  if (record.counts.blocked > 0) {
    caseSummary.push(`${record.counts.blocked} blocked`);
  }
  const failedCase = record.cases.find(
    caseResult => caseResult.status !== 'success',
  );
  return [
    `Eval ${record.evalName}: ${record.status}`,
    caseSummary.join(', '),
    record.error ? `error: ${record.error}` : undefined,
    failedCase ? `failed case: ${failedCase.id}` : undefined,
    `run: ${record.runDir}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
}

export function formatEvalRunInspection(record: EvalRunRecord): string {
  const lines = [formatEvalRunSummary(record)];
  const failures = record.cases.filter(
    caseResult => caseResult.status !== 'success',
  );

  if (failures.length > 0) {
    lines.push('', 'Failures');
    for (const caseResult of failures) {
      lines.push(`  ${caseResult.id}`);
      for (const grader of caseResult.graders) {
        if (grader.status === 'passed') {
          continue;
        }
        lines.push(`    ${grader.message}`);
      }
      if (caseResult.nestedRunDir) {
        lines.push(`    nested run: ${caseResult.nestedRunDir}`);
      }
    }
  }

  lines.push('', 'Run', `  ${record.runDir}`);
  return lines.join('\n');
}
