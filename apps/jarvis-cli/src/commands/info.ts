import { listSkills, toolDefinitions } from '../runtime.ts';
import { loadConfig } from '../config/loader.ts';
import type { LoadedConfig } from '../types.ts';

// jarvis skill list
export function cmdSkillList(json: boolean): void {
  const skills = listSkills();
  if (json) {
    process.stdout.write(`${JSON.stringify(skills, null, 2)}\n`);
    return;
  }
  console.log(`\n已加载 ${skills.length} 个 Skill:\n`);
  for (const skill of skills) {
    const status = skill.status !== 'enabled' ? ` [${skill.status}]` : '';
    console.log(`  ${skill.id}@${skill.version}${status}`);
    console.log(`    ${skill.description}`);
    console.log(`    tools: ${skill.requiredTools.join(', ')}`);
  }
}

// jarvis tool list
export function cmdToolList(json: boolean): void {
  const tools = toolDefinitions;
  if (json) {
    process.stdout.write(`${JSON.stringify(tools, null, 2)}\n`);
    return;
  }
  console.log(`\n已加载 ${tools.length} 个工具:\n`);
  for (const tool of tools) {
    console.log(`  ${tool.name} [${tool.riskLevel ?? 'medium'}] (默认策略: ${tool.defaultPolicy ?? 'approve'})`);
    console.log(`    ${tool.description}`);
  }
}

// jarvis config list
// json 模式下静默加载，避免污染 JSON 输出；人类可读模式保留解析日志。
export function cmdConfigList(json: boolean): void {
  let config: LoadedConfig;
  try {
    config = loadConfig({ silent: json });
  } catch (err) {
    console.error(`[config] 加载失败: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  if (json) {
    // API Key 脱敏后输出
    const safe = {
      ...config,
      modelProfiles: config.modelProfiles.map((p) => ({ ...p, _apiKeyEnv: p.apiKeyEnv, apiKeyResolved: p.apiKeyEnv ? Boolean(process.env[p.apiKeyEnv]) : false }))
    };
    process.stdout.write(`${JSON.stringify(safe, null, 2)}\n`);
    return;
  }
  console.log(`\n配置目录: ${config.configDir}`);
  console.log(`\n工作空间:`);
  console.log(`  id        : ${config.workspace.workspace.id}`);
  console.log(`  root      : ${config.workspace.workspace.root}`);
  console.log(`  artifacts : ${config.workspace.workspace.artifactDir}`);
  console.log(`  traces    : ${config.workspace.workspace.traceDir}`);
  console.log(`  默认模型  : ${config.workspace.defaults.modelProfile}`);

  console.log(`\n模型服务商 (${config.modelProfiles.length} 个):\n`);
  for (const p of config.modelProfiles) {
    const keyOk = p.apiKeyEnv ? (process.env[p.apiKeyEnv] ? '✓' : '✗') : '-';
    console.log(`  [${p.id}]`);
    console.log(`    provider  : ${p.provider}  model: ${p.model}`);
    console.log(`    baseUrl   : ${p.baseUrl ?? '(none)'}`);
    console.log(`    apiKeyEnv : ${p.apiKeyEnv ?? '(none)'}  resolved: ${keyOk}`);
  }

  console.log(`\n权限策略 (${config.permissionPolicies.length} 个):`);
  for (const policy of config.permissionPolicies) {
    console.log(`  [${policy.id}]  approval_required_for: ${policy.approvalRequiredFor.join(', ') || '(none)'}`);
  }

  console.log(`\n上下文策略 (${config.contextPolicies.length} 个):`);
  for (const policy of config.contextPolicies) {
    console.log(`  [${policy.id}]  max_prompt_tokens: ${policy.maxPromptTokens ?? '(default)'}`);
  }
}
