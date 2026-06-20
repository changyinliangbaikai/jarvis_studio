import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitCommitVertical, Plus, Rocket, Save } from 'lucide-react';
import { api, post } from '../api.ts';
import { Empty, Loading, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';

interface Agent { id: string; name: string; defaultPromptId?: string }
interface Prompt {
  id: string;
  agentId?: string;
  name: string;
  version: string;
  status: 'draft' | 'active' | 'archived';
  content: string;
  systemPrompt?: string;
  developerPrompt?: string;
  userTemplate?: string;
  variables: string[];
  linkedSkill?: string;
  changelog?: string;
  outputSchema?: unknown;
  toolPolicy?: unknown;
  successCriteria?: unknown;
  riskNotes?: string;
  updatedAt: string;
}

function pretty(value: unknown) {
  try { return JSON.stringify(value ?? {}, null, 2); } catch { return '{}'; }
}
function parseJson(text: string) {
  try { return JSON.parse(text || '{}'); } catch { throw new Error('JSON 格式不正确'); }
}

export function PromptLabPage() {
  const [selectedId, setSelectedId] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    name: '', agentId: '', systemPrompt: '', developerPrompt: '', userTemplate: '', changelog: '',
    outputSchema: '{}', toolPolicy: '{}', successCriteria: '{}', riskNotes: ''
  });
  const loadPrompts = useCallback((signal: AbortSignal) => api<Prompt[]>('/api/prompts', { signal }), []);
  const loadAgents = useCallback((signal: AbortSignal) => api<Agent[]>('/api/agents', { signal }), []);
  const promptsResource = useAsyncResource(loadPrompts, [], true, { queryKey: ['prompts'] });
  const agentsResource = useAsyncResource(loadAgents, [], true, { queryKey: ['agents', 'prompt-page'] });
  const prompts = promptsResource.data;
  const agents = agentsResource.data ?? [];
  const selected = prompts?.find((prompt) => prompt.id === selectedId) ?? prompts?.[0];
  const versions = useMemo(() => prompts?.filter((prompt) => prompt.name === selected?.name) ?? [], [prompts, selected?.name]);

  useEffect(() => {
    if (prompts) setSelectedId((value) => value || prompts[0]?.id || '');
  }, [prompts]);
  useEffect(() => {
    if (selected) setForm({
      name: selected.name,
      agentId: selected.agentId ?? '',
      systemPrompt: selected.systemPrompt ?? selected.content,
      developerPrompt: selected.developerPrompt ?? '',
      userTemplate: selected.userTemplate ?? '',
      changelog: selected.changelog ?? '',
      outputSchema: pretty(selected.outputSchema),
      toolPolicy: pretty(selected.toolPolicy),
      successCriteria: pretty(selected.successCriteria),
      riskNotes: selected.riskNotes ?? ''
    });
  }, [selected?.id]);

  const createPrompt = async () => {
    const item = await post<Prompt>('/api/prompts', {
      name: 'new-agent-prompt',
      agentId: agents[0]?.id,
      status: 'draft',
      systemPrompt: '你是一个可靠的 AI Agent，请先理解任务，再给出可执行结果。',
      developerPrompt: '遵循工具边界，输出需要可复盘。',
      userTemplate: '{{input}}',
      changelog: 'v0.6 Prompt 管理新建'
    });
    await promptsResource.reload();
    setSelectedId(item.id);
  };
  const saveVersion = async (status: 'draft' | 'active' = 'draft') => {
    if (!selected) return;
    try {
      const item = await post<Prompt>(`/api/prompts/${selected.id}/new-version`, {
        name: form.name,
        agentId: form.agentId || undefined,
        status,
        systemPrompt: form.systemPrompt,
        developerPrompt: form.developerPrompt,
        userTemplate: form.userTemplate,
        changelog: form.changelog || `由 ${selected.version} 创建`,
        outputSchema: parseJson(form.outputSchema),
        toolPolicy: parseJson(form.toolPolicy),
        successCriteria: parseJson(form.successCriteria),
        riskNotes: form.riskNotes
      });
      await promptsResource.reload();
      await agentsResource.reload();
      setSelectedId(item.id);
      setMessage(status === 'active' ? `已发布 ${item.name}@${item.version}` : `已保存草稿 ${item.name}@${item.version}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    }
  };
  const activate = async () => {
    if (!selected) return;
    const item = await post<Prompt>(`/api/prompts/${selected.id}/activate`, {});
    await promptsResource.reload();
    await agentsResource.reload();
    setSelectedId(item.id);
    setMessage(`已发布 ${item.name}@${item.version}`);
  };
  const archive = async () => {
    if (!selected) return;
    const item = await post<Prompt>(`/api/prompts/${selected.id}/archive`, {});
    await promptsResource.reload();
    setSelectedId(item.id);
    setMessage(`已归档 ${item.name}@${item.version}`);
  };

  if (!prompts || !agentsResource.data) return <Loading />;
  return <section>
    <PageHeader eyebrow="02 / Prompts" title="Prompt 管理" description="Prompt 是 Agent 的第一入口。这里管理 System / Developer / User Template、工具策略、输出规范和版本状态。" actions={<button onClick={() => void createPrompt()}><Plus size={15} />新建 Prompt</button>} />
    {(promptsResource.error || agentsResource.error || message) && <div className="notice warning">{promptsResource.error || agentsResource.error || message}</div>}
    {prompts.length === 0 ? <Empty>还没有 Prompt 版本。</Empty> : <div className="prompt-layout">
      <div className="panel prompt-list"><div className="panel-title"><GitCommitVertical size={15} />版本谱系<span>{versions.length || prompts.length}</span></div>{prompts.map((prompt) =>
        <button key={prompt.id} className={selected?.id === prompt.id ? 'active' : ''} onClick={() => setSelectedId(prompt.id)}>
          <div><strong>{prompt.name}</strong><span>{prompt.changelog || '无版本说明'}</span></div><b>{prompt.version}</b>
        </button>)}</div>
      <div className="panel editor-panel"><div className="editor-toolbar"><div><span className="eyebrow">正在编辑</span><h2>{selected?.name}@{selected?.version}</h2></div><div className="page-actions"><button onClick={() => void archive()}>归档</button><button onClick={() => void saveVersion('draft')}><Save size={15} />另存草稿</button><button className="primary" onClick={() => void (selected?.status === 'active' ? saveVersion('active') : activate())}><Rocket size={15} />发布 Active</button></div></div>
        <div className="editor-meta"><span>状态 <b><StatusBadge status={selected?.status ?? 'draft'} /></b></span><span>Agent <b>{agents.find((agent) => agent.id === (form.agentId || selected?.agentId))?.name ?? '未绑定'}</b></span><span>变量 <b>{selected?.variables?.join(', ') || '无'}</b></span></div>
        <div className="mini-form">
          <label>Prompt 名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>绑定 Agent<select value={form.agentId} onChange={(event) => setForm({ ...form, agentId: event.target.value })}><option value="">不绑定</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
          <label>System Prompt<textarea rows={7} value={form.systemPrompt} onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })} /></label>
          <label>Developer Prompt<textarea rows={4} value={form.developerPrompt} onChange={(event) => setForm({ ...form, developerPrompt: event.target.value })} /></label>
          <label>User Template<textarea rows={3} value={form.userTemplate} onChange={(event) => setForm({ ...form, userTemplate: event.target.value })} /></label>
          <label>工具策略 JSON<textarea rows={4} value={form.toolPolicy} onChange={(event) => setForm({ ...form, toolPolicy: event.target.value })} /></label>
          <label>输出规范 JSON<textarea rows={4} value={form.outputSchema} onChange={(event) => setForm({ ...form, outputSchema: event.target.value })} /></label>
          <label>成功标准 JSON<textarea rows={4} value={form.successCriteria} onChange={(event) => setForm({ ...form, successCriteria: event.target.value })} /></label>
          <label>风险点 / 版本说明<textarea rows={3} value={form.riskNotes} onChange={(event) => setForm({ ...form, riskNotes: event.target.value })} /></label>
        </div>
      </div>
    </div>}
  </section>;
}
