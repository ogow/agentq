export {defineEval, isDefinedEval} from './definition';
export {readJsonFixture} from './fixtures';
export {
  createEvalRunPaths,
  evalPackNameFromPath,
  resolveEvalPackPath,
  resolveEvalRunDir,
} from './paths';
export {formatEvalRunInspection, formatEvalRunSummary} from './render';
export {inspectEvalRun, loadEvalPack, runEval} from './runner';
export type * from './types';
export const graders = {
  changedFilesContains: (path: string) => ({
    path,
    type: 'changed_files_contains' as const,
  }),
  exitCode: (expected: number) => ({expected, type: 'exit_code' as const}),
  fileExists: (path: string) => ({path, type: 'file_exists' as const}),
  harnessStatus: (
    expected: 'success' | 'failed' | 'blocked' | 'timed_out' | 'interrupted',
  ) => ({expected, type: 'harness_status' as const}),
  outputContains: (value: string) => ({
    type: 'output_contains' as const,
    value,
  }),
  outputJsonPathEquals: (path: string, expected: unknown) => ({
    expected,
    path,
    type: 'output_json_path_equals' as const,
  }),
  runStatus: (
    expected: 'running' | 'succeeded' | 'failed' | 'timed_out' | 'interrupted',
  ) => ({expected, type: 'run_status' as const}),
  stderrContains: (value: string) => ({
    type: 'stderr_contains' as const,
    value,
  }),
  stdoutContains: (value: string) => ({
    type: 'stdout_contains' as const,
    value,
  }),
};
