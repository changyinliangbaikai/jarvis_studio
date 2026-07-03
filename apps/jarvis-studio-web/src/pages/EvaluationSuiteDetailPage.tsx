import { useTranslation } from 'react-i18next';
import { useCallback } from 'react';
import { Beaker, ChevronLeft, ExternalLink, PlayCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';

interface EvalSuiteDetail {
  id: string;
  agentId: string;
  agentName?: string;
  name: string;
  description?: string;
  caseCount: number;
  cases: Array<{ id: string; name: string; priority: string; assertionType: string; latestResult?: { status: string } }>;
  runs: Array<{ id: string; status: string; promptVersionId: string; totalCases: number; passedCases: number; failedCases: number; passRate: number; startedAt: string }>;
}
interface Agent { id: string; defaultPromptVersionId?: string; defaultPromptId?: string }
interface Prompt { id: string; agentId?: string; status: string }

export function EvaluationSuiteDetailPage() {
  const { t } = useTranslation();
  const { suiteId = '' } = useParams();
  const load = useCallback(async (signal: AbortSignal) => {
    const [suite, agents, prompts] = await Promise.all([
      api<EvalSuiteDetail>(`/api/eval-suites/${suiteId}`, { signal }),
      api<Agent[]>('/api/agents', { signal }),
      api<Prompt[]>('/api/prompts', { signal })
    ]);
    return { suite, agents, prompts };
  }, [suiteId]);
  const resource = useAsyncResource(load, [suiteId], Boolean(suiteId), { queryKey: ['eval-suite-detail', suiteId] });
  const suite = resource.data?.suite;
  const runSuite = async () => {
    if (!suite || !resource.data) return;
    const agent = resource.data.agents.find((item) => item.id === suite.agentId);
    const prompt = resource.data.prompts.find((item) => item.agentId === suite.agentId && item.status === 'active')
      ?? resource.data.prompts.find((item) => item.id === (agent?.defaultPromptVersionId ?? agent?.defaultPromptId));
    if (!prompt) return;
    await post(`/api/eval-suites/${suite.id}/run`, { promptVersionId: prompt.id, runScope: 'all', continueOnFailure: true, maxParallel: 1 });
    await resource.reload();
  };

  if (!suite) return <Loading />;
  const latest = suite.runs[0];
  return <section>
    <Link to="/evaluations" className="back-link"><ChevronLeft size={14} />{t('pages.evaluationSuiteDetail.string_1')}</Link>
    <PageHeader eyebrow="06 / Eval Suite" title={suite.name} description={suite.description ?? t('pages.evaluationSuiteDetail.string_10')} actions={<button className="primary" onClick={() => void runSuite()}><PlayCircle size={14} />{t('pages.evaluationSuiteDetail.string_2')}</button>} />
    {resource.error && <div className="notice warning">{resource.error}</div>}
    <div className="metric-grid compact">
      <Metric label="VERSIONED CASES" value={suite.caseCount} tone="cyan" />
      <Metric label="LATEST PASS RATE" value={latest ? `${Math.round(latest.passRate * 100)}%` : '-'} tone="green" />
      <Metric label="PROMPT" value={latest?.promptVersionId ?? '-'} />
      <Metric label="RUN" value={latest?.status ?? '-'} />
    </div>
    <div className="workbench-grid">
      <div className="panel">
        <div className="panel-title">{t('pages.evaluationSuiteDetail.string_3')}<span>{suite.cases.length}</span></div>
        {suite.cases.length === 0 ? <Empty>{t('pages.evaluationSuiteDetail.string_4')}</Empty> : <div className="table-wrap"><table><thead><tr><th>Case</th><th>{t('pages.evaluationSuiteDetail.string_5')}</th><th>{t('pages.evaluationSuiteDetail.string_6')}</th><th>{t('pages.evaluationSuiteDetail.string_7')}</th></tr></thead><tbody>{suite.cases.map((item) => <tr key={item.id}>
          <td>{item.name}</td><td><StatusBadge status={item.priority.toLowerCase()} /></td><td>{item.assertionType}</td><td>{item.latestResult ? <StatusBadge status={item.latestResult.status} /> : '-'}</td>
        </tr>)}</tbody></table></div>}
      </div>
      <div className="panel">
        <div className="panel-title">{t('pages.evaluationSuiteDetail.string_8')}<span>{suite.runs.length}</span></div>
        {suite.runs.length === 0 ? <Empty>{t('pages.evaluationSuiteDetail.string_9')}</Empty> : suite.runs.map((run) => <div className="history-row" key={run.id}>
          <div><StatusBadge status={run.status} /><strong>{Math.round(run.passRate * 100)}%</strong><span>{run.passedCases}/{run.totalCases} 通过 · {run.promptVersionId}</span></div>
          <Link className="icon-link" to={`/evaluations/runs/${run.id}`}><ExternalLink size={14} /></Link>
        </div>)}
      </div>
    </div>
  </section>;
}
