import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import type { SkillCandidate, SkillDefinition } from '@jarvis/shared-types';

const skillsRoot = resolve(import.meta.dirname, '../../../skills');
const aliases: Record<string, string> = {
  'data-analysis-skill': 'excel-data-analysis',
  'excel-analysis': 'excel-data-analysis',
  'weekly-report-skill': 'weekly-report',
  'code-review-skill': 'code-review'
};

const inferredMetadata: Record<string, Pick<SkillDefinition, 'category' | 'triggers' | 'contextPolicy' | 'qualityGate' | 'defaultTask' | 'defaultFiles'>> = {
  'excel-data-analysis': {
    category: 'data-analysis',
    defaultTask: '分析客户清单，识别异常并给出营销建议。',
    defaultFiles: ['input/customer_data.xlsx'],
    triggers: {
      keywords: ['excel', 'xlsx', '表格', '客户', '数据分析', '异常'],
      fileTypes: ['.xlsx', '.xls', '.csv'],
      intentExamples: ['分析这个客户清单', '找出异常数据', '根据表格生成分析报告']
    },
    contextPolicy: { priority: 'high', maxTokens: 3000, progressiveDisclosure: true, reloadAfterCompaction: true },
    qualityGate: { minEvalScore: 4, minSuccessRate: 0.85, maxToolErrorRate: 0.1 }
  },
  'weekly-report': {
    category: 'office',
    defaultTask: '根据本周进展整理一份结构化周报，包含本周完成、问题与风险、下周计划。',
    defaultFiles: [],
    triggers: {
      keywords: ['周报', '报告', '总结', '计划'],
      fileTypes: ['.md', '.txt'],
      intentExamples: ['生成本周工作周报', '整理工作进展']
    },
    contextPolicy: { priority: 'medium', maxTokens: 2400, progressiveDisclosure: true },
    qualityGate: { minEvalScore: 4, minSuccessRate: 0.85, maxToolErrorRate: 0.1 }
  },
  'code-review': {
    category: 'coding',
    defaultTask: '审查示例代码，指出主要风险并给出测试建议。',
    defaultFiles: ['input/sample.ts'],
    triggers: {
      keywords: ['review', '代码', 'diff', '审查', 'bug', '修复'],
      fileTypes: ['.ts', '.tsx', '.js', '.py', '.swift'],
      intentExamples: ['审查这段代码', '找出风险和缺少的测试']
    },
    contextPolicy: { priority: 'high', maxTokens: 4000, progressiveDisclosure: true },
    qualityGate: { minEvalScore: 4, minSuccessRate: 0.85, maxToolErrorRate: 0.1 }
  }
};

export function listSkills(): SkillDefinition[] {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadSkill(entry.name));
}

export function loadSkill(id: string): SkillDefinition {
  const directory = resolve(skillsRoot, id);
  const manifest = YAML.parse(readFileSync(resolve(directory, 'skill.yaml'), 'utf8')) as Record<string, unknown>;
  const instructions = readFileSync(resolve(directory, 'SKILL.md'), 'utf8');
  const inferred = inferredMetadata[id] ?? {};
  return {
    id: String(manifest.id ?? id),
    name: String(manifest.name ?? id),
    version: String(manifest.version ?? '0.4.0'),
    description: String(manifest.description ?? ''),
    systemPrompt: String(manifest.systemPrompt ?? manifest.system_prompt ?? ''),
    instructions,
    requiredTools: Array.isArray(manifest.requiredTools) ? manifest.requiredTools.map(String)
      : Array.isArray(manifest.required_tools) ? manifest.required_tools.map(String) : [],
    permissions: normalizeSkillPermissions(manifest.permissions),
    outputFile: typeof manifest.outputFile === 'string' ? manifest.outputFile
      : typeof manifest.output_file === 'string' ? manifest.output_file : undefined,
    defaultTask: typeof manifest.defaultTask === 'string' ? manifest.defaultTask
      : typeof manifest.default_task === 'string' ? manifest.default_task : inferred.defaultTask,
    defaultFiles: arrayOfStrings(manifest.defaultFiles ?? manifest.default_files) ?? inferred.defaultFiles,
    status: (manifest.status === 'disabled' || manifest.status === 'deprecated' ? manifest.status : 'enabled') as SkillDefinition['status'],
    category: typeof manifest.category === 'string' ? manifest.category : inferred.category,
    triggers: normalizeTriggers(manifest.triggers) ?? inferred.triggers,
    contextPolicy: normalizeObject(manifest.context_policy ?? manifest.contextPolicy) as SkillDefinition['contextPolicy'] ?? inferred.contextPolicy,
    qualityGate: normalizeObject(manifest.quality_gate ?? manifest.qualityGate) as SkillDefinition['qualityGate'] ?? inferred.qualityGate
  };
}

// 归一化 skill.yaml 的 permissions 字段到统一的字符串标识列表，
// 同时兼容两种声明形态：
//   1) 扁平字符串数组：['filesystem.read', 'filesystem.write', 'process.python']
//   2) 嵌套对象 + 子数组：
//      { filesystem: { read: [workspace], write: [workspace/output] }, process: [python], network: false }
//      → ['filesystem.read', 'filesystem.write', 'process.python']
// governance.ts 使用 includes(tool.permission) 进行严格匹配，故必须输出 'parent.child' 形式。
export function normalizeSkillPermissions(value: unknown): string[] {
  // 形态 1：扁平数组，去重直接返回。
  if (Array.isArray(value)) return [...new Set(value.map(String))];
  if (!value || typeof value !== 'object') return [];
  // 形态 2：嵌套对象，按 'parent.child' 拼接。
  const out = new Set<string>();
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === false || item === null || item === undefined) continue;
    if (item === true) { out.add(key); continue; }
    if (Array.isArray(item)) {
      // 子数组（如 process: [python, git]）：拼成 'process.python'、'process.git'
      for (const entry of item) {
        if (typeof entry === 'string' && entry) out.add(`${key}.${entry}`);
      }
      continue;
    }
    if (typeof item === 'object') {
      // 子对象（如 filesystem: { read: [...], write: [...] }）：取子 key 拼成 'filesystem.read' 等
      for (const subKey of Object.keys(item as Record<string, unknown>)) {
        const subValue = (item as Record<string, unknown>)[subKey];
        if (subValue === false || subValue === null || subValue === undefined) continue;
        out.add(`${key}.${subKey}`);
      }
    }
  }
  return [...out];
}

export function selectSkill(message: string, requested?: string): SkillDefinition {
  return explainSkillSelection(message, requested).skill;
}

export function explainSkillSelection(message: string, requested?: string, files: string[] = []) {
  const requestedId = requested ? normalizeSkillId(requested) : undefined;
  const candidates = scoreSkillCandidates(message, requestedId, files);
  const selected = candidates.find((candidate) => candidate.status === 'selected') ?? candidates[0];
  return {
    skill: loadSkill(selected?.skillId ?? 'weekly-report'),
    selectedSkillId: selected?.skillId ?? 'weekly-report',
    candidates
  };
}

export function scoreSkillCandidates(message: string, requested?: string, files: string[] = []): SkillCandidate[] {
  const lower = message.toLowerCase();
  const fileNames = files.map((file) => file.toLowerCase());
  const skills = listSkills();
  const scored = skills.map((skill) => {
    const matchedBy: string[] = [];
    let score = 0.08;
    if (requested && skill.id === requested) {
      score += 0.85;
      matchedBy.push('explicit_request');
    }
    for (const keyword of skill.triggers?.keywords ?? []) {
      if (lower.includes(keyword.toLowerCase())) {
        score += 0.2;
        matchedBy.push(`keyword:${keyword}`);
      }
    }
    for (const fileType of skill.triggers?.fileTypes ?? []) {
      if (fileNames.some((file) => file.endsWith(fileType.toLowerCase()))) {
        score += 0.25;
        matchedBy.push(`file_type:${fileType}`);
      }
    }
    for (const example of skill.triggers?.intentExamples ?? []) {
      if (overlapScore(lower, example.toLowerCase()) >= 0.4) {
        score += 0.12;
        matchedBy.push(`intent:${example.slice(0, 18)}`);
      }
    }
    if (!matchedBy.length && skill.id === 'weekly-report') {
      score += 0.08;
      matchedBy.push('fallback:general-writing');
    }
    return {
      skillId: skill.id,
      version: skill.version,
      score: Number(Math.min(score, 0.99).toFixed(2)),
      matchedBy,
      status: skill.status === 'disabled' ? 'disabled' : 'not_selected',
      description: skill.description
    } satisfies SkillCandidate;
  }).sort((left, right) => right.score - left.score);
  const selected = scored.find((candidate) => candidate.status !== 'disabled');
  return scored.map((candidate) => ({
    ...candidate,
    status: candidate.skillId === selected?.skillId ? 'selected' : candidate.status
  }));
}

function normalizeSkillId(value: string) {
  const normalized = value.replace(/@.*$/, '');
  const resolved = aliases[normalized] ?? normalized;
  return existsSync(resolve(skillsRoot, resolved, 'skill.yaml')) ? resolved : normalized;
}

function normalizeTriggers(value: unknown): SkillDefinition['triggers'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return {
    keywords: arrayOfStrings(record.keywords),
    fileTypes: arrayOfStrings(record.file_types ?? record.fileTypes),
    intentExamples: arrayOfStrings(record.intent_examples ?? record.intentExamples)
  };
}

function normalizeObject(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.map(String) : undefined;
}

function overlapScore(message: string, example: string) {
  const tokens = [...new Set(example.split(/[\s,，。；;]+/).filter(Boolean))];
  if (!tokens.length) return 0;
  return tokens.filter((token) => message.includes(token)).length / tokens.length;
}
