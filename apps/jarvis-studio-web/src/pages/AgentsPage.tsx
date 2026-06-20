import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Plus, Save } from 'lucide-react';
import { api, post } from '../api.ts';
import { Empty, Loading, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';

interface Agent {
  id: string;
  name: string;
  description?: string;
  defaultPromptId?: string;
  defaultModelProviderId?: string;
  defaultContextStrategyId?: string;
  defaultToolPolicyId?: string;
  outputMode?: string;
  updatedAt: string;
}
interface Prompt { id: string; agentId?: string; name: string; version: string; status: string; changelog?: string }

export function AgentsPage() {
  const loadAgents = useCallback((signal: AbortSignal) => api<Agent[]>('/api/agents', { signal }), []);
  const loadPrompts = useCallback((signal: AbortSignal) => api<Prompt[]>('/api/prompts', { signal }), []);
  const agentsResource = useAsyncResource(loadAgents, [], true, { queryKey: ['agents'] });
  const promptsResource = useAsyncResource(loadPrompts, [], true, { queryKey: ['prompts', 'agents-page'] });
  const agents = agentsResource.data;
  const prompts = promptsResource.data ?? [];
  const [selectedId, setSelectedId] = useState('');
  const selected = agents?.find((agent) => agent.id === selectedId) ?? agents?.[0];
  const [form, setForm] = useState({ name: '', description: '', defaultPromptId: '', outputMode: 'markdown' });

  useEffect(() => {
    if (agents) setSelectedId((value) => value || agents[0]?.id || '');
  }, [agents]);
  useEffect(() => {
    if (selected) setForm({
      name: selected.name,
      description: selected.description ?? '',
      defaultPromptId: selected.defaultPromptId ?? '',
      outputMode: selected.outputMode ?? 'markdown'
    });
  }, [selected?.id]);

  const selectedPrompts = useMemo(() => prompts.filter((prompt) => !selected || !prompt.agentId || prompt.agentId === selected.id), [prompts, selected?.id]);
  const create = async () => {
    const item = await post<Agent>('/api/agents', {
      name: 'New Agent',
      description: '从 Prompt 开始设计的轻量 Agent。',
      outputMode: 'markdown'
    });
    await agentsResource.reload();
    setSelectedId(item.id);
  };
  const save = async () => {
    if (!selected) return;
    const item = await api<Agent>(`/api/agents/${selected.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...form, defaultPromptId: form.defaultPromptId || undefined })
    });
    await agentsResource.reload();
    setSelectedId(item.id);
  };

  if (!agents || !promptsResource.data) return <Loading />;
  return <section>
    <PageHeader eyebrow="01 / Agents" title="Agent 工作台" description="Agent 是 Studio 的设计对象，用于绑定默认 Prompt、模型、工具策略和输出偏好。v0.6 从这里进入 Prompt-first 调试闭环。" actions={<button onClick={() => void create()}><Plus size={15} />新建 Agent</button>} />
    {(agentsResource.error || promptsResource.error) && <div className="notice warning">{agentsResource.error || promptsResource.error}</div>}
    {agents.length === 0 ? <Empty>还没有 Agent。</Empty> : <div className="workbench-grid">
      <div className="panel tool-list">
        <div className="panel-title"><Bot size={15} />Agents<span>{agents.length}</span></div>
        {agents.map((agent) => <button key={agent.id} className={selected?.id === agent.id ? 'active' : ''} onClick={() => setSelectedId(agent.id)}>
          <div><strong>{agent.name}</strong><span>{agent.description || '无描述'}</span></div><b>{agent.outputMode ?? 'markdown'}</b>
        </button>)}
      </div>
      <div className="panel editor-panel">
        <div className="editor-toolbar"><div><span className="eyebrow">Agent Profile</span><h2>{selected?.name}</h2></div><button className="primary" onClick={() => void save()}><Save size={15} />保存 Agent</button></div>
        <div className="editor-meta"><span>ID <b>{selected?.id}</b></span><span>状态 <b>可运行</b></span><span>更新时间 <b>{selected?.updatedAt?.slice(0, 19)}</b></span></div>
        <div className="mini-form">
          <label>名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>描述<textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label>默认 Prompt<select value={form.defaultPromptId} onChange={(event) => setForm({ ...form, defaultPromptId: event.target.value })}>
            <option value="">未绑定，运行时手动选择</option>
            {selectedPrompts.map((prompt) => <option value={prompt.id} key={prompt.id}>{prompt.name}@{prompt.version} · {prompt.status}</option>)}
          </select></label>
          <label>输出模式<select value={form.outputMode} onChange={(event) => setForm({ ...form, outputMode: event.target.value })}>
            <option value="markdown">Markdown</option>
            <option value="json">JSON</option>
            <option value="text">纯文本</option>
          </select></label>
        </div>
        <div className="workbench-split">
          <div><h3>绑定 Prompt</h3>{selectedPrompts.slice(0, 8).map((prompt) => <p key={prompt.id}><StatusBadge status={prompt.status} /> {prompt.name}@{prompt.version}</p>)}</div>
          <div><h3>设计说明</h3><p>Agent 只负责承载默认配置；真正能力从 Prompt 版本开始沉淀。Playground 运行后会生成 Run 和 Trace。</p></div>
        </div>
      </div>
    </div>}
  </section>;
}
