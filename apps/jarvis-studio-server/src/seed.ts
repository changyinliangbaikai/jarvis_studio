import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import './db/database.ts';
import { importTraceJsonl } from './services/traceImportService.ts';
import { importEvalDatasetYaml, importEvalDatasetDirectory, importReleaseGateYaml } from './services/evalService.ts';

const root = resolve(import.meta.dirname, '../../..');
importTraceJsonl(readFileSync(resolve(root, 'fixtures/data-analysis/sample-trace.jsonl'), 'utf8'));

importEvalDatasetDirectory(resolve(root, 'fixtures/evals/smoke'));
importEvalDatasetYaml(
  readFileSync(resolve(root, 'fixtures/evals/regression/dataset.yaml'), 'utf8'),
  [readFileSync(resolve(root, 'fixtures/evals/builtin.yaml'), 'utf8')],
  resolve(root, 'fixtures/evals/regression/dataset.yaml')
);
importReleaseGateYaml(
  readFileSync(resolve(root, 'fixtures/evals/release-gates/jarvis_regression_release_gate.yaml'), 'utf8'),
  resolve(root, 'fixtures/evals/release-gates/jarvis_regression_release_gate.yaml')
);
console.log('Jarvis Studio datasets, release gate, and trace data seeded.');
