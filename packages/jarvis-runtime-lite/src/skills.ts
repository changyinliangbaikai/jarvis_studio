import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import type { SkillDefinition } from './types.ts';

const skillsRoot = resolve(import.meta.dirname, '../skills');

export function listSkills(): SkillDefinition[] {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadSkill(entry.name));
}

export function loadSkill(id: string): SkillDefinition {
  const directory = resolve(skillsRoot, id);
  const manifest = YAML.parse(readFileSync(resolve(directory, 'manifest.yaml'), 'utf8')) as Omit<SkillDefinition, 'instructions'>;
  const instructions = readFileSync(resolve(directory, 'SKILL.md'), 'utf8');
  return { ...manifest, instructions };
}

export function selectSkill(message: string, requested?: string): SkillDefinition {
  if (requested) {
    const normalized = requested.replace(/@.*$/, '');
    const aliases: Record<string, string> = {
      'data-analysis-skill': 'excel-data-analysis',
      'excel-analysis': 'excel-data-analysis',
      'weekly-report-skill': 'weekly-report',
      'code-review-skill': 'code-review'
    };
    const resolved = aliases[normalized] ?? normalized;
    if (existsSync(resolve(skillsRoot, resolved, 'manifest.yaml'))) return loadSkill(resolved);
  }
  const lower = message.toLowerCase();
  if (/(xlsx|excel|表格|客户|数据分析|异常)/i.test(lower)) return loadSkill('excel-data-analysis');
  if (/(review|代码|diff|审查)/i.test(lower)) return loadSkill('code-review');
  return loadSkill('weekly-report');
}
