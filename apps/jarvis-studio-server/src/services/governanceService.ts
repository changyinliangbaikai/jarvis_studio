import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { defaultPolicyVersion, listSkills, toolDefinitions, type ModelProfile } from '@jarvis/agent-runtime';
import { all, get, json, parseJson, run, storageRoot } from '../db/database.ts';
import { executeRuntimeRun, runtimeWorkspace } from '../runtime/runtimeService.ts';
import { resolveModelProvider } from './modelProviderService.ts';
import { getRun, listArtifacts, listRuns, listTools } from './queryService.ts';

export function syncSkillRegistry() {
  const now = new Date().toISOString();
  for (const skill of listSkills()) {
    const manifest = { ...skill, instructions: undefined };
    run(`INSERT INTO skills (id, name, version, status, category, description, manifest_json, instruction_text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version, category=excluded.category,
      description=excluded.description, manifest_json=excluded.manifest_json, instruction_text=excluded.instruction_text,
      updated_at=excluded.updated_at`,
    skill.id, skill.name, skill.version, skill.status ?? 'enabled', skill.category ?? null, skill.description,
    json(manifest), skill.instructions, now, now);
    run(`INSERT OR IGNORE INTO skill_versions (id, skill_id, version, manifest_json, instruction_text, changelog, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    `${skill.id}@${skill.version}`, skill.id, skill.version, json(manifest), skill.instructions, 'Imported from Runtime Lite manifest', now);
  }
}

export function listSkillRegistry() {
  syncSkillRegistry();
  const runs = listRuns();
  return all<Record<string, unknown>>(`SELECT * FROM skills ORDER BY status, category, id`).map((row) => {
    const skillId = String(row.id);
    const boundRuns = runs.filter((item) => Array.isArray(item.skillVersions) && item.skillVersions.some((version) => String(version).startsWith(`${skillId}@`)));
    const failures = all<{ n: number }>(`SELECT COUNT(*) AS n FROM failures WHERE skill_id=? OR run_id IN (
      SELECT run_id FROM skill_selection_events WHERE selected_skill_id=?
    )`, skillId, skillId)[0]?.n ?? 0;
    const scores = boundRuns.map((item) => Number(item.score)).filter(Number.isFinite);
    return {
      ...normalizeSkill(row),
      hitCount: Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM skill_selection_events WHERE selected_skill_id=?`, skillId)?.n ?? boundRuns.length),
      successRate: boundRuns.length ? boundRuns.filter((item) => item.status === 'success').length / boundRuns.length : 0,
      avgScore: scores.length ? scores.reduce((sum, item) => sum + item, 0) / scores.length : 0,
      toolErrorRate: toolErrorRateForSkill(skillId),
      failureCount: Number(failures),
      lastUsedAt: get<{ created_at: string }>(`SELECT created_at FROM skill_selection_events WHERE selected_skill_id=? ORDER BY created_at DESC LIMIT 1`, skillId)?.created_at
    };
  });
}

export function getSkillRegistryItem(id: string) {
  syncSkillRegistry();
  const row = get<Record<string, unknown>>(`SELECT * FROM skills WHERE id=?`, id);
  if (!row) return undefined;
  const runs = listRuns().filter((item) => Array.isArray(item.skillVersions) && item.skillVersions.some((version) => String(version).startsWith(`${id}@`))).slice(0, 20);
  return {
    ...normalizeSkill(row),
    versions: all<Record<string, unknown>>(`SELECT * FROM skill_versions WHERE skill_id=? ORDER BY created_at DESC`, id).map((item) => ({
      id: item.id,
      skillId: item.skill_id,
      version: item.version,
      manifest: parseJson(item.manifest_json, {}),
      changelog: item.changelog,
      createdAt: item.created_at
    })),
    selectionEvents: all<Record<string, unknown>>(`SELECT * FROM skill_selection_events WHERE selected_skill_id=? ORDER BY created_at DESC LIMIT 30`, id).map((item) => ({
      id: item.id,
      runId: item.run_id,
      turnId: item.turn_id,
      selectedSkillId: item.selected_skill_id,
      candidates: parseJson(item.candidates_json, []),
      createdAt: item.created_at
    })),
    runs,
    failures: all<Record<string, unknown>>(`SELECT * FROM failures WHERE skill_id=? ORDER BY updated_at DESC LIMIT 20`, id).map((item) => ({
      id: item.id,
      type: item.type,
      severity: item.severity,
      summary: item.summary,
      status: item.status,
      updatedAt: item.updated_at
    }))
  };
}

export function setSkillStatus(id: string, status: 'enabled' | 'disabled' | 'deprecated') {
  syncSkillRegistry();
  if (!getSkillRegistryItem(id)) throw new Error('Skill 不存在');
  run(`UPDATE skills SET status=?, updated_at=? WHERE id=?`, status, new Date().toISOString(), id);
  recordAuditLog({ action: `skill.${status}`, targetType: 'skill', targetId: id, payload: { status } });
  return getSkillRegistryItem(id);
}

export async function testSkill(id: string, input: { message?: string; files?: string[]; modelProviderId?: string; modelName?: string; temperature?: number } = {}) {
  syncSkillRegistry();
  const row = get<Record<string, unknown>>(`SELECT * FROM skills WHERE id=?`, id);
  if (!row) throw new Error('Skill 不存在');
  const manifest = parseJson<Record<string, unknown>>(row.manifest_json, {});
  const provider = resolveModelProvider(input.modelProviderId ?? 'builtin-deterministic');
  const result = await executeRuntimeRun({
    name: `Skill Test · ${row.name}`,
    message: input.message ?? String(manifest.defaultTask ?? row.description ?? `测试 ${id}`),
    skill: id,
    files: input.files ?? (Array.isArray(manifest.defaultFiles) ? manifest.defaultFiles.map(String) : []),
    modelProfile: { ...provider.profile, model: input.modelName ?? provider.profile.model, temperature: input.temperature ?? 0.2 }
  });
  recordAuditLog({
    action: 'skill.test',
    targetType: 'skill',
    targetId: id,
    runId: result.ids.runId,
    payload: { status: result.status, modelProviderId: provider.id, model: input.modelName ?? provider.profile.model }
  });
  return {
    skillId: id,
    runId: result.ids.runId,
    status: result.status,
    output: result.output,
    toolCalls: result.toolCalls.map((tool) => ({ name: tool.name, success: tool.success })),
    eventCount: result.events.length,
    error: result.error
  };
}

export function syncToolRegistry() {
  const now = new Date().toISOString();
  for (const tool of toolDefinitions) {
    const manifest = {
      id: tool.name,
      name: tool.name,
      version: tool.version ?? '0.4.0',
      category: tool.category ?? 'runtime',
      riskLevel: tool.riskLevel ?? 'medium',
      defaultPolicy: tool.defaultPolicy ?? 'approve',
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema ?? {},
      permissions: tool.permissions ?? { required: [tool.permission] },
      runtime: tool.runtime ?? {},
      contextInjection: tool.contextInjection ?? {}
    };
    run(`INSERT INTO tools (id, name, version, category, risk_level, default_policy, manifest_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version, category=excluded.category,
      manifest_json=excluded.manifest_json, updated_at=excluded.updated_at`,
    tool.name, tool.name, tool.version ?? '0.4.0', tool.category ?? 'runtime', tool.riskLevel ?? 'medium',
    tool.defaultPolicy ?? 'approve', json(manifest), now, now);
    run(`INSERT OR IGNORE INTO tool_versions (id, tool_id, version, manifest_json, changelog, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    `${tool.name}@${tool.version ?? '0.4.0'}`, tool.name, tool.version ?? '0.4.0', json(manifest), 'Imported from Runtime Lite tool definition', now);
  }
}

export function listToolRegistry() {
  syncToolRegistry();
  return all<Record<string, unknown>>(`SELECT * FROM tools ORDER BY risk_level DESC, id`).map((row) => toolWithStats(row));
}

export function getToolRegistryItem(id: string) {
  syncToolRegistry();
  const row = get<Record<string, unknown>>(`SELECT * FROM tools WHERE id=?`, id);
  return row ? {
    ...toolWithStats(row),
    versions: all<Record<string, unknown>>(`SELECT * FROM tool_versions WHERE tool_id=? ORDER BY created_at DESC`, id).map((item) => ({
      id: item.id,
      toolId: item.tool_id,
      version: item.version,
      manifest: parseJson(item.manifest_json, {}),
      changelog: item.changelog,
      createdAt: item.created_at
    })),
    calls: listTools().filter((item) => item.toolName === id).slice(0, 50),
    failures: all<Record<string, unknown>>(`SELECT * FROM failures WHERE tool_id=? ORDER BY updated_at DESC LIMIT 20`, id)
  } : undefined;
}

export function updateToolPolicy(id: string, input: { riskLevel?: string; defaultPolicy?: string; enabled?: boolean }) {
  syncToolRegistry();
  if (!getToolRegistryItem(id)) throw new Error('Tool 不存在');
  const current = get<Record<string, unknown>>(`SELECT * FROM tools WHERE id=?`, id)!;
  const risk = String(input.riskLevel ?? current.risk_level);
  const policy = String(input.defaultPolicy ?? current.default_policy);
  if (!['low', 'medium', 'high', 'critical'].includes(risk)) throw new Error('不支持的风险等级');
  if (!['allow', 'approve', 'deny'].includes(policy)) throw new Error('不支持的默认策略');
  run(`UPDATE tools SET risk_level=?, default_policy=?, enabled=?, updated_at=? WHERE id=?`,
    risk, policy, input.enabled === undefined ? Number(current.enabled ?? 1) : input.enabled ? 1 : 0, new Date().toISOString(), id);
  recordAuditLog({
    action: 'tool.policy.update',
    targetType: 'tool',
    targetId: id,
    payload: { riskLevel: risk, defaultPolicy: policy, enabled: input.enabled === undefined ? Boolean(current.enabled) : input.enabled }
  });
  return getToolRegistryItem(id);
}

export function setToolEnabled(id: string, enabled: boolean) {
  return updateToolPolicy(id, { enabled });
}

export function listPermissionPolicies() {
  return all<Record<string, unknown>>(`SELECT * FROM permission_policies ORDER BY enabled DESC, updated_at DESC`).map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    enabled: Boolean(row.enabled),
    config: parseJson(row.config_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function savePermissionPolicy(input: { id: string; name: string; version?: string; config: unknown; enabled?: boolean }) {
  if (!input.id || !input.name) throw new Error('Permission Policy 缺少 id/name');
  const now = new Date().toISOString();
  run(`INSERT INTO permission_policies (id, name, version, config_json, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version, config_json=excluded.config_json,
    enabled=excluded.enabled, updated_at=excluded.updated_at`,
  input.id, input.name, input.version ?? '0.4.0', json(input.config), input.enabled === false ? 0 : 1, now, now);
  recordAuditLog({ action: 'permission_policy.save', targetType: 'permission_policy', targetId: input.id, payload: { version: input.version ?? '0.4.0', enabled: input.enabled !== false } });
  return listPermissionPolicies().find((item) => item.id === input.id);
}

export function listPermissionDecisions(filters: Record<string, unknown> = {}) {
  const clauses: string[] = [];
  const params: string[] = [];
  for (const [column, key] of [['decision', 'decision'], ['tool_id', 'toolId'], ['run_id', 'runId']] as const) {
    if (typeof filters[key] === 'string' && filters[key]) {
      clauses.push(`${column}=?`);
      params.push(filters[key]);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all<Record<string, unknown>>(`SELECT * FROM permission_decisions ${where} ORDER BY created_at DESC`, ...params).map(normalizePermissionDecision);
}

export function setPermissionDecision(id: string, decision: 'allow' | 'deny', approvedBy = 'local-user') {
  const row = get<Record<string, unknown>>(`SELECT * FROM permission_decisions WHERE id=?`, id);
  if (!row) throw new Error('Permission Decision 不存在');
  run(`UPDATE permission_decisions SET decision=?, approved_by=? WHERE id=?`, decision, approvedBy, id);
  recordAuditLog({
    action: `permission.${decision}`,
    actor: approvedBy,
    targetType: 'permission_decision',
    targetId: id,
    runId: String(row.run_id ?? ''),
    decisionId: id,
    payload: { previousDecision: row.decision, decision, toolId: row.tool_id, riskLevel: row.risk_level }
  });
  return normalizePermissionDecision(get<Record<string, unknown>>(`SELECT * FROM permission_decisions WHERE id=?`, id)!);
}

export function listContextStrategies() {
  return all<Record<string, unknown>>(`SELECT * FROM context_strategies ORDER BY enabled DESC, updated_at DESC`).map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    enabled: Boolean(row.enabled),
    config: parseJson(row.config_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function saveContextStrategy(input: { id: string; name: string; version?: string; config: unknown; enabled?: boolean }) {
  const now = new Date().toISOString();
  if (!input.id || !input.name) throw new Error('Context Strategy 缺少 id/name');
  run(`INSERT INTO context_strategies (id, name, version, config_json, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version, config_json=excluded.config_json,
    enabled=excluded.enabled, updated_at=excluded.updated_at`,
  input.id, input.name, input.version ?? '0.4.0', json(input.config), input.enabled === false ? 0 : 1, now, now);
  recordAuditLog({ action: 'context_strategy.save', targetType: 'context_strategy', targetId: input.id, payload: { version: input.version ?? '0.4.0', enabled: input.enabled !== false } });
  return listContextStrategies().find((item) => item.id === input.id);
}

export function getRunGovernance(runId: string) {
  const runItem = getRun(runId);
  if (!runItem) return undefined;
  const skillEvent = get<Record<string, unknown>>(`SELECT * FROM skill_selection_events WHERE run_id=? ORDER BY created_at DESC LIMIT 1`, runId);
  const permissions = listPermissionDecisions({ runId });
  const context = get<Record<string, unknown>>(`SELECT * FROM context_snapshots WHERE run_id=? ORDER BY created_at DESC LIMIT 1`, runId);
  const failures = all<Record<string, unknown>>(`SELECT * FROM failures WHERE run_id=? ORDER BY severity DESC, updated_at DESC`, runId);
  const snapshot = get<Record<string, unknown>>(`SELECT * FROM replay_snapshots WHERE run_id=? ORDER BY created_at DESC LIMIT 1`, runId);
  return {
    run: runItem,
    skill: skillEvent ? {
      selectedSkillId: skillEvent.selected_skill_id,
      candidates: parseJson(skillEvent.candidates_json, [])
    } : undefined,
    permissions: {
      total: permissions.length,
      allow: permissions.filter((item) => item.decision === 'allow').length,
      approve: permissions.filter((item) => item.decision === 'approve').length,
      deny: permissions.filter((item) => item.decision === 'deny').length,
      decisions: permissions.slice(0, 8)
    },
    context: context ? {
      snapshotId: context.id,
      budgetStrategy: context.budget_strategy,
      beforeTokens: Number(context.total_tokens_before_budget ?? context.total_tokens ?? 0),
      afterTokens: Number(context.total_tokens_after_budget ?? context.total_tokens ?? 0),
      maxContextTokens: Number(context.max_context_tokens ?? 0),
      risks: parseJson(context.risk_json, [])
    } : undefined,
    failures: failures.map((item) => ({
      id: item.id,
      type: item.type,
      severity: item.severity,
      status: item.status,
      summary: item.summary
    })),
    replay: snapshot ? { snapshotId: snapshot.id, createdAt: snapshot.created_at } : undefined
  };
}

export function getRunSnapshot(runId: string) {
  const row = get<Record<string, unknown>>(`SELECT * FROM replay_snapshots WHERE run_id=? ORDER BY created_at DESC LIMIT 1`, runId);
  return row ? normalizeSnapshot(row) : createRunSnapshot(runId);
}

export function createRunSnapshot(runId: string) {
  const runItem = getRun(runId);
  if (!runItem) throw new Error('Run 不存在');
  const turn = get<Record<string, unknown>>(`SELECT * FROM turns WHERE id=?`, String(runItem.turnId ?? ''));
  const files = snapshotInputFiles(runId);
  const snapshot = {
    input: {
      userMessage: turn?.user_message ?? runItem.name,
      files
    },
    versions: {
      promptVersion: runItem.promptVersion,
      skillVersion: Array.isArray(runItem.skillVersions) ? runItem.skillVersions[0] : undefined,
      toolVersions: Object.fromEntries(listTools(runId).map((tool) => [tool.toolName, '0.4.0'])),
      runtimeVersion: runItem.runtimeVersion,
      contextStrategy: runItem.contextStrategyVersion,
      policyVersion: defaultPolicyVersion
    },
    modelConfig: {
      provider: runItem.modelProvider,
      model: runItem.model,
      temperature: 0.2,
      maxTokens: 2048
    }
  };
  const id = `snap_${randomUUID()}`;
  run(`INSERT INTO replay_snapshots VALUES (?, ?, NULL, ?, ?)`, id, runId, json(snapshot), new Date().toISOString());
  recordAuditLog({ action: 'replay.snapshot.create', targetType: 'run', targetId: runId, runId, payload: { snapshotId: id, fileCount: files.length } });
  return normalizeSnapshot(get<Record<string, unknown>>(`SELECT * FROM replay_snapshots WHERE id=?`, id)!);
}

export async function replayRun(runId: string, overrides: { modelProviderId?: string; modelName?: string; promptVersion?: string; skillVersion?: string; contextStrategy?: string; toolPolicy?: string } = {}) {
  const snapshot = getRunSnapshot(runId);
  const snapshotPayload = asRecord(snapshot.snapshot);
  const modelConfig = asRecord(snapshotPayload.modelConfig);
  const input = asRecord(snapshotPayload.input);
  const versions = asRecord(snapshotPayload.versions);
  const provider = overrides.modelProviderId
    ? resolveModelProvider(overrides.modelProviderId)
    : String(modelConfig.provider ?? '').includes('deterministic')
      ? resolveModelProvider('builtin-deterministic')
      : resolveModelProvider();
  const profile: ModelProfile = { ...provider.profile, model: overrides.modelName ?? String(modelConfig.model ?? provider.profile.model) };
  const result = await executeRuntimeRun({
    name: `Replay · ${snapshot.runId}`,
    message: String(input.userMessage ?? 'Replay this run'),
    skill: overrides.skillVersion ?? String(versions.skillVersion ?? ''),
    files: snapshotFiles(input.files),
    promptVersion: overrides.promptVersion ?? String(versions.promptVersion ?? ''),
    contextStrategy: overrides.contextStrategy ?? String(versions.contextStrategy ?? 'balanced-v1'),
    policyVersion: overrides.toolPolicy ?? String(versions.policyVersion ?? defaultPolicyVersion),
    modelProfile: profile
  });
  run(`UPDATE replay_snapshots SET original_run_id=? WHERE run_id=?`, runId, result.ids.runId);
  recordAuditLog({
    action: 'replay.run',
    targetType: 'run',
    targetId: runId,
    runId: result.ids.runId,
    payload: {
      originalRunId: runId,
      changedDimensions: Object.keys(overrides).filter((key) => overrides[key as keyof typeof overrides]),
      overrides
    }
  });
  return {
    originalRunId: runId,
    replayRunId: result.ids.runId,
    status: result.status,
    changedDimensions: Object.keys(overrides).filter((key) => overrides[key as keyof typeof overrides]),
    output: result.output
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function snapshotFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const file = asRecord(item);
    const path = file.originalPath ?? file.original_path;
    return typeof path === 'string' && path.trim() ? [path] : [];
  });
}

export function listAuditLogs(filters: Record<string, unknown> = {}) {
  const clauses: string[] = [];
  const params: string[] = [];
  for (const [column, key] of [['target_type', 'targetType'], ['target_id', 'targetId'], ['run_id', 'runId'], ['decision_id', 'decisionId']] as const) {
    if (typeof filters[key] === 'string' && filters[key]) {
      clauses.push(`${column}=?`);
      params.push(filters[key]);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all<Record<string, unknown>>(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT 200`, ...params).map((row) => ({
    id: row.id,
    action: row.action,
    actor: row.actor,
    targetType: row.target_type,
    targetId: row.target_id,
    runId: row.run_id,
    decisionId: row.decision_id,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at
  }));
}

function recordAuditLog(input: { action: string; actor?: string; targetType?: string; targetId?: string; runId?: string; decisionId?: string; payload?: unknown }) {
  run(`INSERT INTO audit_logs (id, action, actor, target_type, target_id, run_id, decision_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  `audit_${randomUUID()}`, input.action, input.actor ?? 'local-user', input.targetType ?? null,
  input.targetId ?? null, input.runId ?? null, input.decisionId ?? null, json(input.payload ?? {}), new Date().toISOString());
}

function inputFilesForRun(runId: string): string[] {
  const row = get<{ raw_json: string }>(`SELECT raw_json FROM raw_trace_events WHERE run_id=? AND event_type='turn.start' ORDER BY timestamp LIMIT 1`, runId);
  const event = parseJson<{ payload?: { files?: unknown } } | null>(row?.raw_json, null);
  const files = event?.payload?.files;
  if (Array.isArray(files)) return files.map(String).filter(Boolean);
  return listArtifacts(runId).map((artifact) => String(artifact.path));
}

function snapshotInputFiles(runId: string) {
  return inputFilesForRun(runId).map((file) => {
    const source = resolve(runtimeWorkspace, file);
    const snapshotPath = resolve(storageRoot, 'snapshots', runId, file);
    if (!source.startsWith(runtimeWorkspace) || !snapshotPath.startsWith(resolve(storageRoot, 'snapshots', runId))) {
      return { originalPath: file, snapshotPath: null, sha256: null, missing: true, reason: 'path_outside_workspace' };
    }
    if (!existsSync(source)) {
      return { originalPath: file, snapshotPath: null, sha256: null, missing: true, reason: 'source_missing' };
    }
    mkdirSync(dirname(snapshotPath), { recursive: true });
    copyFileSync(source, snapshotPath);
    const info = statSync(snapshotPath);
    return {
      originalPath: file,
      snapshotPath: relative(storageRoot, snapshotPath),
      sha256: shaBuffer(readFileSync(snapshotPath)),
      sizeBytes: info.size,
      missing: false
    };
  });
}

function normalizeSkill(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    category: row.category,
    description: row.description,
    manifest: parseJson(row.manifest_json, {}),
    instructionText: row.instruction_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toolWithStats(row: Record<string, unknown>) {
  const toolName = String(row.id);
  const calls = listTools().filter((item) => item.toolName === toolName);
  const errors = calls.filter((item) => !item.success);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    category: row.category,
    riskLevel: row.risk_level,
    defaultPolicy: row.default_policy,
    enabled: Boolean(row.enabled),
    manifest: parseJson(row.manifest_json, {}),
    callCount: calls.length,
    successRate: calls.length ? (calls.length - errors.length) / calls.length : 0,
    avgLatencyMs: calls.length ? calls.reduce((sum, item) => sum + Number(item.latencyMs ?? 0), 0) / calls.length : 0,
    avgOutputTokens: calls.length ? calls.reduce((sum, item) => sum + Number((item.contextInjection as { tokens?: number })?.tokens ?? 0), 0) / calls.length : 0,
    errorRate: calls.length ? errors.length / calls.length : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizePermissionDecision(row: Record<string, unknown>) {
  return {
    id: row.id,
    runId: row.run_id,
    toolCallId: row.tool_call_id,
    toolId: row.tool_id,
    riskLevel: row.risk_level,
    requestedPermissions: parseJson(row.requested_permissions_json, []),
    decision: row.decision,
    reason: row.reason,
    policyId: row.policy_id,
    approvedBy: row.approved_by,
    argumentsSummary: parseJson(row.arguments_summary_json, {}),
    createdAt: row.created_at
  };
}

function normalizeSnapshot(row: Record<string, unknown>) {
  return {
    id: row.id,
    runId: row.run_id,
    originalRunId: row.original_run_id,
    snapshot: parseJson<Record<string, unknown>>(row.snapshot_json, {}),
    createdAt: row.created_at
  };
}

function toolErrorRateForSkill(skillId: string) {
  const selectedRunIds = all<{ run_id: string }>(`SELECT run_id FROM skill_selection_events WHERE selected_skill_id=?`, skillId).map((item) => item.run_id);
  if (!selectedRunIds.length) return 0;
  const calls = selectedRunIds.flatMap((runId) => listTools(runId));
  return calls.length ? calls.filter((item) => !item.success).length / calls.length : 0;
}

function sha(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function shaBuffer(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}
