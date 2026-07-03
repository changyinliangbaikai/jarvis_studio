import { useTranslation } from 'react-i18next';
import { useCallback, useMemo, useState } from 'react';
import { Beaker, ExternalLink, PlayCircle, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';

interface Agent { id: string; name: string; defaultPromptVersionId?: string; defaultPromptId?: string }
interface CaseItem { id: string; agentId: string; name: string; priority: string; status: string }
interface Prompt { id: string; agentId?: string; name: string; version: string; status: string }
interface EvalSuite {
  id: string;
  agentId: string;
  agentName?: string;
  name: string;
  description?: string;
  caseIds: string[];
  caseCount: number;
  latestRun?: { id: string; status: string; passRate: number; promptVersionId: string; startedAt: string };
}
interface EvalRun { id: string; passRate: number; status: string; totalCases: number; passedCases: number; failedCases: number }

export function EvaluationsPage() {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [name, setName] = useState(t('pages.evaluations.string_15'));
  const [description, setDescription] = useState(t('pages.evaluations.string_16'));
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const load = useCallback(async (signal: AbortSignal) => {
    const [suites, agents, cases, prompts] = await Promise.all([
      api<EvalSuite[]>('/api/eval-suites', { signal }),
      api<Agent[]>('/api/agents', { signal }),
      api<CaseItem[]>('/api/cases?status=active', { signal }),
      api<Prompt[]>('/api/prompts', { signal })
    ]);
    return { suites, agents, cases, prompts };
  }, []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['light-evaluations'] });
  const suites = resource.data?.suites ?? [];
  const agents = resource.data?.agents ?? [];
  const cases = resource.data?.cases ?? [];
  const prompts = resource.data?.prompts ?? [];
  const latest = suites.find((suite) => suite.latestRun)?.latestRun;
  const caseOptions = useMemo(() => cases.filter((item) => !agentId || item.agentId === agentId), [cases, agentId]);
  const createSuite = async () => {
    const targetAgentId = agentId || agents[0]?.id;
    if (!targetAgentId) return;
    const ids = selectedCaseIds.length ? selectedCaseIds : cases.filter((item) => item.agentId === targetAgentId).slice(0, 5).map((item) => item.id);
    const suite = await post<EvalSuite>('/api/eval-suites', {
      agentId: targetAgentId,
      name,
      description,
      caseIds: ids,
      defaultAssertionMode: 'manual',
      tags: ['v0.6']
    });
    setMessage(t('pages.evaluations.string_17'));
    setShowCreate(false);
    await resource.reload();
  };
  const runSuite = async (suite: EvalSuite) => {
    const agent = agents.find((item) => item.id === suite.agentId);
    const prompt = prompts.find((item) => item.agentId === suite.agentId && item.status === 'active')
      ?? prompts.find((item) => item.id === (agent?.defaultPromptVersionId ?? agent?.defaultPromptId));
    if (!prompt) {
      setMessage(t('pages.evaluations.string_18'));
      return;
    }
    const run = await post<EvalRun>(`/api/eval-suites/${suite.id}/run`, {
      promptVersionId: prompt.id,
      runScope: 'all',
      continueOnFailure: true,
      maxParallel: 1
    });
    setMessage(t('pages.evaluations.string_19'));
    await resource.reload();
  };
  const toggleCase = (caseId: string) => setSelectedCaseIds((value) => value.includes(caseId) ? value.filter((id) => id !== caseId) : [...value, caseId]);

  if (!resource.data) return <Loading />;
  return <section>
    <PageHeader
      eyebrow="06 / Evaluations"
      title={t('pages.evaluations.string_1')}
      description={t('pages.evaluations.string_2')}
      actions={<><button onClick={() => setShowCreate(true)}><Plus size={15} />{t('pages.evaluations.string_3')}</button><Link className="primary-link" to="/evals/advanced"><Beaker size={14} />{t('pages.evaluations.string_4')}</Link></>}
    />
    {(resource.error || message) && <div className="notice warning">{resource.error || message}</div>}
    <div className="metric-grid compact">
      <Metric label="EVAL RUNS" value={suites.filter((suite) => suite.latestRun).length} tone="cyan" />
      <Metric label="LATEST PASS RATE" value={latest ? `${Math.round(latest.passRate * 100)}%` : '-'} tone="green" />
      <Metric label="VERSIONED CASES" value={cases.length} />
      <Metric label="PROMPT" value={latest?.promptVersionId ?? '-'} />
    </div>
    {suites.length === 0 ? <Empty>{t('pages.evaluations.string_5')}</Empty> : <div className="table-wrap"><table><thead><tr><th>Suite</th><th>Agent</th><th>{t('pages.evaluations.string_6')}</th><th>{t('pages.evaluations.string_7')}</th><th>{t('pages.evaluations.string_8')}</th><th>{t('common.actions')}</th></tr></thead><tbody>{suites.map((suite) => <tr key={suite.id}>
      <td className="run-name"><strong>{suite.name}</strong><span>{suite.description ?? suite.id}</span></td>
      <td>{suite.agentName ?? suite.agentId}</td>
      <td>{suite.caseCount}</td>
      <td>{suite.latestRun ? <StatusBadge status={suite.latestRun.status} /> : '-'}</td>
      <td className="score">{suite.latestRun ? `${Math.round(suite.latestRun.passRate * 100)}%` : '-'}</td>
      <td><div className="page-actions"><button onClick={() => void runSuite(suite)}><PlayCircle size={14} />{t('pages.evaluations.string_9')}</button><Link className="icon-link" to={`/evaluations/${suite.id}`}><ExternalLink size={14} /></Link>{suite.latestRun && <Link className="icon-link" to={`/evaluations/runs/${suite.latestRun.id}`}><Beaker size={14} /></Link>}</div></td>
    </tr>)}</tbody></table></div>}
    {showCreate && <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <span className="eyebrow">Eval Suite</span><h2>{t('pages.evaluations.string_10')}</h2>
        <div className="mini-form">
          <label>Agent<select value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">{t('pages.evaluations.string_11')}</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
          <label>{t('pages.evaluations.string_12')}<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>{t('pages.evaluations.string_13')}<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        </div>
        <div className="case-picker">{caseOptions.map((item) => <label key={item.id}><input type="checkbox" checked={selectedCaseIds.includes(item.id)} onChange={() => toggleCase(item.id)} /><span>{item.name}</span><em>{item.priority}</em></label>)}</div>
        <div className="modal-actions"><button onClick={() => setShowCreate(false)}>{t('common.cancel')}</button><button className="primary" disabled={!(agentId || agents[0])} onClick={() => void createSuite()}>{t('pages.evaluations.string_14')}</button></div>
      </div>
    </div>}
  </section>;
}
