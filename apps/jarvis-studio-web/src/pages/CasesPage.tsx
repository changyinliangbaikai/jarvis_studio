import { useTranslation } from 'react-i18next';
import { useCallback, useState } from 'react';
import { ClipboardList, ExternalLink, PlayCircle, Plus, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, Loading, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';

interface Agent { id: string; name: string; defaultPromptVersionId?: string; defaultPromptId?: string }
interface CaseItem {
  id: string;
  agentId: string;
  agentName?: string;
  sourceRunId?: string;
  sourceTraceId?: string;
  promptVersionId?: string;
  name: string;
  description?: string;
  input: string;
  expectedOutput?: string;
  assertionType: string;
  assertionConfig: unknown;
  priority: string;
  status: string;
  tags: string[];
  latestResult?: { status: string; passed: boolean | null; runId: string };
}

export function CasesPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [agentId, setAgentId] = useState(searchParams.get('agentId') ?? '');
  const [priority, setPriority] = useState('');
  const [assertionType, setAssertionType] = useState('');
  const [keyword, setKeyword] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    name: t('pages.cases.string_26'),
    input: t('pages.cases.string_27'),
    expectedOutput: 'OK',
    assertionType: 'keyword',
    assertionConfig: '{"mustInclude":["OK"],"matchMode":"all"}',
    priority: 'P1',
    tags: 'manual'
  });
  const load = useCallback(async (signal: AbortSignal) => {
    const query = new URLSearchParams();
    if (agentId) query.set('agentId', agentId);
    if (priority) query.set('priority', priority);
    if (assertionType) query.set('assertionType', assertionType);
    if (keyword) query.set('keyword', keyword);
    const [cases, agents] = await Promise.all([
      api<CaseItem[]>(`/api/cases${query.size ? `?${query}` : ''}`, { signal }),
      api<Agent[]>('/api/agents', { signal })
    ]);
    return { cases, agents };
  }, [agentId, priority, assertionType, keyword]);
  const resource = useAsyncResource(load, [agentId, priority, assertionType, keyword], true, { queryKey: ['cases-v06', agentId, priority, assertionType, keyword] });
  const cases = resource.data?.cases ?? [];
  const agents = resource.data?.agents ?? [];
  const create = async () => {
    const targetAgentId = agentId || agents[0]?.id;
    if (!targetAgentId) return;
    const item = await post<CaseItem>('/api/cases', {
      agentId: targetAgentId,
      name: form.name,
      input: form.input,
      expectedOutput: form.expectedOutput,
      assertionType: form.assertionType,
      assertionConfig: JSON.parse(form.assertionConfig || '{}'),
      priority: form.priority,
      status: 'active',
      tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
    });
    setMessage(t('pages.cases.string_28'));
    setShowCreate(false);
    await resource.reload();
  };
  const run = async (item: CaseItem) => {
    const agent = agents.find((candidate) => candidate.id === item.agentId);
    const result = await post<{ runId: string; status: string; passed: boolean | null }>(`/api/cases/${item.id}/run`, {
      promptVersionId: item.promptVersionId ?? agent?.defaultPromptVersionId ?? agent?.defaultPromptId
    });
    setMessage(t('pages.cases.string_29'));
    await resource.reload();
  };

  if (!resource.data) return <Loading />;
  return <section>
    <PageHeader eyebrow="05 / Cases" title={t('pages.cases.string_1')} description={t('pages.cases.string_2')} actions={<button onClick={() => setShowCreate(true)}><Plus size={15} />{t('pages.cases.string_4')}</button>} />
    {(resource.error || message) && <div className="notice warning">{resource.error || message}</div>}
    <div className="section-bar">
      <div><ClipboardList size={16} /><strong>Case Registry</strong><span>{cases.length} 个用例</span></div>
      <div className="filter-row">
        <select value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">{t('pages.cases.string_5')}</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
        <select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="">{t('pages.cases.string_6')}</option><option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option></select>
        <select value={assertionType} onChange={(event) => setAssertionType(event.target.value)}><option value="">{t('pages.cases.string_7')}</option><option value="manual">Manual</option><option value="keyword">Keyword</option><option value="json_schema">JSON Schema</option><option value="tool_call">Tool Call</option></select>
        <label className="search-box"><Search size={14} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t('pages.cases.string_3')} /></label>
      </div>
    </div>
    {cases.length === 0 ? <Empty>{t('pages.cases.string_8')}</Empty> : <div className="table-wrap"><table><thead><tr><th>{t('pages.cases.string_9')}</th><th>Agent</th><th>{t('pages.cases.string_10')}</th><th>{t('pages.cases.string_11')}</th><th>{t('pages.cases.string_12')}</th><th>{t('common.status')}</th><th>{t('pages.cases.string_13')}</th><th>{t('pages.cases.string_14')}</th><th>{t('common.actions')}</th></tr></thead><tbody>{cases.map((item) => <tr key={item.id}>
      <td className="run-name"><strong>{item.name}</strong><span>{item.description ?? item.id}</span></td>
      <td>{item.agentName ?? item.agentId}</td>
      <td>{item.input.slice(0, 80)}</td>
      <td>{item.assertionType}</td>
      <td><StatusBadge status={item.priority.toLowerCase()} /></td>
      <td><StatusBadge status={item.status} /></td>
      <td>{item.sourceTraceId ? <Link className="icon-link" to={`/runs/${item.sourceTraceId}`}><ExternalLink size={14} /></Link> : '-'}</td>
      <td>{item.latestResult ? <StatusBadge status={item.latestResult.status} /> : <span className="status status-draft">{t('pages.cases.string_15')}</span>}</td>
      <td><div className="page-actions"><button onClick={() => void run(item)}><PlayCircle size={14} />{t('pages.cases.string_16')}</button></div></td>
    </tr>)}</tbody></table></div>}
    {showCreate && <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <span className="eyebrow">Case Editor</span><h2>{t('pages.cases.string_17')}</h2>
        <div className="mini-form">
          <label>{t('pages.cases.string_18')}<select value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">{t('pages.cases.string_19')}</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
          <label>{t('common.name')}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>{t('pages.cases.string_20')}<textarea rows={4} value={form.input} onChange={(event) => setForm({ ...form, input: event.target.value })} /></label>
          <label>{t('pages.cases.string_21')}<textarea rows={3} value={form.expectedOutput} onChange={(event) => setForm({ ...form, expectedOutput: event.target.value })} /></label>
          <label>{t('pages.cases.string_22')}<select value={form.assertionType} onChange={(event) => setForm({ ...form, assertionType: event.target.value })}><option value="manual">Manual</option><option value="keyword">Keyword</option><option value="json_schema">JSON Schema</option><option value="tool_call">Tool Call</option></select></label>
          <label>{t('pages.cases.string_23')}<textarea rows={4} value={form.assertionConfig} onChange={(event) => setForm({ ...form, assertionConfig: event.target.value })} /></label>
          <label>{t('pages.cases.string_24')}<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option></select></label>
          <label>{t('common.tags')}<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /></label>
        </div>
        <div className="modal-actions"><button onClick={() => setShowCreate(false)}>{t('common.cancel')}</button><button className="primary" disabled={!(agentId || agents[0])} onClick={() => void create()}>{t('pages.cases.string_25')}</button></div>
      </div>
    </div>}
  </section>;
}
