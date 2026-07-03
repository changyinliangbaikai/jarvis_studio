import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, ClipboardList, ExternalLink, PlayCircle, Plus, Save, Search, Settings, ScrollText } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';

interface Agent {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'archived';
  defaultPromptId?: string;
  defaultPromptVersionId?: string;
  defaultModelProviderId?: string;
  defaultModel?: string;
  defaultRuntimeId?: string;
  defaultContextStrategyId?: string;
  defaultToolPolicyId?: string;
  outputMode?: string;
  tags?: string[];
  updatedAt: string;
}
interface Prompt { id: string; agentId?: string; name: string; version: string; status: string; updatedAt?: string }
interface Run { id: string; agentId?: string; status: string; startedAt: string }
interface CaseItem { id: string; agentId: string }
interface EvalSuite { id: string; agentId: string; latestRun?: { passRate: number } }

export function AgentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agentId: routeAgentId } = useParams();
  const [selectedId, setSelectedId] = useState(routeAgentId ?? '');
  const [keyword, setKeyword] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    defaultPromptVersionId: '',
    defaultModelProviderId: 'builtin-deterministic',
    defaultModel: 'deterministic-local',
    defaultRuntimeId: 'local-runtime',
    defaultContextStrategyId: 'balanced-v1',
    defaultToolPolicyId: 'default-local-policy',
    outputMode: 'markdown',
    tags: ''
  });
  const load = useCallback(async (signal: AbortSignal) => {
    const [agents, prompts, runs, cases, suites] = await Promise.all([
      api<Agent[]>('/api/agents', { signal }),
      api<Prompt[]>('/api/prompts', { signal }),
      api<Run[]>('/api/runs', { signal }),
      api<CaseItem[]>('/api/cases', { signal }),
      api<EvalSuite[]>('/api/eval-suites', { signal })
    ]);
    return { agents, prompts, runs, cases, suites };
  }, []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['agents-v06'] });
  const agents = resource.data?.agents ?? [];
  const prompts = resource.data?.prompts ?? [];
  const runs = resource.data?.runs ?? [];
  const cases = resource.data?.cases ?? [];
  const suites = resource.data?.suites ?? [];
  const filteredAgents = useMemo(() => agents.filter((agent) => {
    const text = `${agent.name} ${agent.description ?? ''} ${(agent.tags ?? []).join(' ')}`.toLowerCase();
    return !keyword.trim() || text.includes(keyword.trim().toLowerCase());
  }), [agents, keyword]);
  const selected = agents.find((agent) => agent.id === selectedId) ?? filteredAgents[0] ?? agents[0];
  const selectedPrompts = prompts.filter((prompt) => prompt.agentId === selected?.id);
  const selectedRuns = runs.filter((run) => run.agentId === selected?.id);
  const selectedCases = cases.filter((item) => item.agentId === selected?.id);
  const selectedSuites = suites.filter((suite) => suite.agentId === selected?.id);
  const currentPrompt = prompts.find((prompt) => prompt.id === (selected?.defaultPromptVersionId ?? selected?.defaultPromptId));
  const latestRun = selectedRuns[0];
  const latestEval = selectedSuites.find((suite) => suite.latestRun)?.latestRun;

  useEffect(() => {
    if (routeAgentId) setSelectedId(routeAgentId);
  }, [routeAgentId]);
  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setForm({
      name: selected.name,
      description: selected.description ?? '',
      defaultPromptVersionId: selected.defaultPromptVersionId ?? selected.defaultPromptId ?? '',
      defaultModelProviderId: selected.defaultModelProviderId ?? 'builtin-deterministic',
      defaultModel: selected.defaultModel ?? 'deterministic-local',
      defaultRuntimeId: selected.defaultRuntimeId ?? 'local-runtime',
      defaultContextStrategyId: selected.defaultContextStrategyId ?? 'balanced-v1',
      defaultToolPolicyId: selected.defaultToolPolicyId ?? 'default-local-policy',
      outputMode: selected.outputMode ?? 'markdown',
      tags: (selected.tags ?? []).join(', ')
    });
  }, [selected?.id]);

  const create = async () => {
    const item = await post<Agent>('/api/agents', {
      name: 'New Agent',
      description: t('pages.agents.string_23'),
      defaultModelProviderId: 'builtin-deterministic',
      defaultModel: 'deterministic-local',
      defaultRuntimeId: 'local-runtime',
      defaultContextStrategyId: 'balanced-v1',
      defaultToolPolicyId: 'default-local-policy',
      outputMode: 'markdown',
      tags: ['v0.6']
    });
    setMessage(t('pages.agents.string_24'));
    await resource.reload();
    navigate(`/agents/${item.id}`);
  };
  const save = async () => {
    if (!selected) return;
    const item = await api<Agent>(`/api/agents/${selected.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...form,
        defaultPromptVersionId: form.defaultPromptVersionId || undefined,
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      })
    });
    setMessage(t('pages.agents.string_25'));
    await resource.reload();
    navigate(`/agents/${item.id}`);
  };
  const archive = async () => {
    if (!selected || !confirm(t('pages.agents.string_26'))) return;
    await post(`/api/agents/${selected.id}/archive`, {});
    setMessage(t('pages.agents.string_27'));
    await resource.reload();
  };

  if (!resource.data) return <Loading />;
  return <section>
    <PageHeader
      eyebrow="01 / Agents"
      title="Agent"
      description={t('pages.agents.string_1')}
      actions={<button onClick={() => void create()}><Plus size={15} />{t('pages.agents.string_3')}</button>}
    />
    {(resource.error || message) && <div className="notice warning">{resource.error || message}</div>}
    {agents.length === 0 ? <Empty>{t('pages.agents.string_4')}</Empty> : <div className="workbench-grid">
      <div className="panel tool-list">
        <div className="panel-title"><Bot size={15} />Agents<span>{filteredAgents.length}</span></div>
        <label className="search-box"><Search size={14} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t('pages.agents.string_2')} /></label>
        {filteredAgents.map((agent) => {
          const prompt = prompts.find((item) => item.id === (agent.defaultPromptVersionId ?? agent.defaultPromptId));
          return <button key={agent.id} className={selected?.id === agent.id ? 'active' : ''} onClick={() => navigate(`/agents/${agent.id}`)}>
            <div><strong>{agent.name}</strong><span>{agent.description || t('pages.agents.string_28')}</span></div>
            <b>{prompt ? `${prompt.version} · ${prompt.status}` : 'no prompt'}</b>
          </button>;
        })}
      </div>
      <div className="panel editor-panel">
        <div className="editor-toolbar">
          <div><span className="eyebrow">Agent Overview</span><h2>{selected?.name}</h2></div>
          <div className="page-actions">
            <Link className="primary-link" to={`/playground?agentId=${selected?.id ?? ''}`}><PlayCircle size={14} />Playground</Link>
            <button onClick={() => void save()}><Save size={15} />{t('common.save')}</button>
            <button onClick={() => void archive()}>{t('pages.agents.string_5')}</button>
          </div>
        </div>
        <div className="metric-grid compact">
          <Metric label="PROMPT" value={currentPrompt ? `${currentPrompt.name}@${currentPrompt.version}` : t('common.unbound')} />
          <Metric label="RUN" value={latestRun?.status ?? 'no runs'} tone={latestRun?.status === 'success' ? 'green' : 'amber'} />
          <Metric label="VERSIONED CASES" value={selectedCases.length} tone="cyan" />
          <Metric label="LATEST PASS RATE" value={latestEval ? `${Math.round(latestEval.passRate * 100)}%` : '-'} tone="green" />
        </div>
        <div className="editor-meta">
          <span>ID <b>{selected?.id}</b></span>
          <span>{t('common.status')}<b><StatusBadge status={selected?.status ?? 'active'} /></b></span>
          <span>{t('pages.agents.string_6')}<b>{selected?.updatedAt?.slice(0, 19)}</b></span>
        </div>
        <div className="mini-form">
          <label>{t('pages.agents.string_7')}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>{t('pages.agents.string_8')}<textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label>{t('pages.agents.string_9')}<select value={form.defaultPromptVersionId} onChange={(event) => setForm({ ...form, defaultPromptVersionId: event.target.value })}>
            <option value="">{t('pages.agents.string_10')}</option>
            {selectedPrompts.map((prompt) => <option value={prompt.id} key={prompt.id}>{prompt.name}@{prompt.version} · {prompt.status}</option>)}
          </select></label>
          <label>{t('pages.agents.string_11')}<input value={form.defaultModelProviderId} onChange={(event) => setForm({ ...form, defaultModelProviderId: event.target.value })} /></label>
          <label>{t('pages.agents.string_12')}<input value={form.defaultModel} onChange={(event) => setForm({ ...form, defaultModel: event.target.value })} /></label>
          <label>{t('pages.agents.string_13')}<input value={form.defaultRuntimeId} onChange={(event) => setForm({ ...form, defaultRuntimeId: event.target.value })} /></label>
          <label>{t('pages.agents.string_14')}<input value={form.defaultContextStrategyId} onChange={(event) => setForm({ ...form, defaultContextStrategyId: event.target.value })} /></label>
          <label>{t('pages.agents.string_15')}<input value={form.defaultToolPolicyId} onChange={(event) => setForm({ ...form, defaultToolPolicyId: event.target.value })} /></label>
          <label>{t('pages.agents.string_16')}<select value={form.outputMode} onChange={(event) => setForm({ ...form, outputMode: event.target.value })}>
            <option value="markdown">Markdown</option>
            <option value="json">JSON</option>
            <option value="text">Plain Text</option>
          </select></label>
          <label>{t('common.tags')}<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="coding, office" /></label>
        </div>
        <div className="workbench-split">
          <div><h3>{t('pages.agents.string_17')}</h3>
            <p><Link to={`/prompts?agentId=${selected?.id ?? ''}`}><ScrollText size={14} />{t('pages.agents.string_18')}</Link></p>
            <p><Link to={`/runs?agentId=${selected?.id ?? ''}`}><ExternalLink size={14} />{t('pages.agents.string_19')}</Link></p>
            <p><Link to={`/cases?agentId=${selected?.id ?? ''}`}><ClipboardList size={14} />{t('pages.agents.string_20')}</Link></p>
            <p><Link to="/settings"><Settings size={14} />{t('pages.agents.string_21')}</Link></p>
          </div>
          <div><h3>{t('pages.agents.string_22')}</h3>{selectedPrompts.slice(0, 6).map((prompt) => <p key={prompt.id}><StatusBadge status={prompt.status} /> {prompt.name}@{prompt.version}</p>)}</div>
        </div>
      </div>
    </div>}
  </section>;
}
