import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import './db/database.ts';
import { importTraceJsonl } from './services/traceImportService.ts';
import { createPrompt, listPrompts } from './services/promptService.ts';
import { importEvalDatasetYaml, importEvalDatasetDirectory, importReleaseGateYaml } from './services/evalService.ts';

const root = resolve(import.meta.dirname, '../../..');
importTraceJsonl(readFileSync(resolve(root, 'fixtures/data-analysis/sample-trace.jsonl'), 'utf8'));

if (listPrompts().length === 0) {
  createPrompt({
    name: 'excel-analysis',
    version: 'v0.1',
    linkedSkill: 'excel-data-analysis@v0.1',
    content: '你是 Excel 数据分析专家。请分析 {{file_name}}，先给出数据概况，再识别异常客户，最后给出营销建议。',
    changelog: '初始基线版本'
  });
  createPrompt({
    name: 'excel-analysis',
    version: 'v0.2',
    linkedSkill: 'excel-data-analysis@v0.1',
    content: '你是严谨的数据分析专家。检查 {{file_name}} 的字段与质量，明确数据概况、异常客户依据和可执行营销建议。不得编造字段。',
    changelog: '加强异常依据和防编造约束'
  });
}
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
console.log('Jarvis Studio v0.3 datasets, release gate, prompts, and trace data seeded.');
