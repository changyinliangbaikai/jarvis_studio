import { useTranslation } from 'react-i18next';
import { useCallback } from 'react';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';

interface EvalRun {
  id: string;
  suiteId: string;
  agentId: string;
  promptVersionId: string;
  model?: string;
  status: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  startedAt: string;
  endedAt?: string;
  results: Array<{ id: string; caseId: string; runId?: string; status: string; passed: boolean; assertionType?: string; output?: string; error?: string }>;
}

export function LightEvalRunDetailPage() {
  const { t } = useTranslation();
  const { evalRunId = '' } = useParams();
  const load = useCallback((signal: AbortSignal) => api<EvalRun>(`/api/eval-runs/${evalRunId}`, { signal }), [evalRunId]);
  const resource = useAsyncResource(load, [evalRunId], Boolean(evalRunId), { queryKey: ['light-eval-run', evalRunId] });
  const run = resource.data;
  if (!run) return <Loading />;
  return <section>
    <Link to={`/evaluations/${run.suiteId}`} className="back-link"><ChevronLeft size={14} />{t('pages.lightEvalRunDetail.string_2')}</Link>
    <PageHeader eyebrow="06 / Eval Run" title={t('pages.lightEvalRunDetail.string_1')} description={`Prompt Version · ${run.promptVersionId}`} actions={<StatusBadge status={run.status} />} />
    {resource.error && <div className="notice warning">{resource.error}</div>}
    <div className="metric-grid compact">
      <Metric label="PASS RATE" value={`${Math.round(run.passRate * 100)}%`} tone="green" />
      <Metric label="VERSIONED CASES" value={run.totalCases} tone="cyan" />
      <Metric label="RUN" value={`${run.passedCases}/${run.failedCases}`} />
      <Metric label="MODEL" value={run.model ?? '-'} />
    </div>
    {run.results.length === 0 ? <Empty>{t('pages.lightEvalRunDetail.string_3')}</Empty> : <div className="table-wrap"><table><thead><tr><th>Case</th><th>{t('common.status')}</th><th>{t('pages.lightEvalRunDetail.string_4')}</th><th>{t('pages.lightEvalRunDetail.string_5')}</th><th>Run / Trace</th><th>{t('common.error')}</th></tr></thead><tbody>{run.results.map((result) => <tr key={result.id}>
      <td>{result.caseId}</td>
      <td><StatusBadge status={result.status} /></td>
      <td>{result.assertionType ?? '-'}</td>
      <td>{result.output?.slice(0, 100) ?? '-'}</td>
      <td>{result.runId ? <Link className="icon-link" to={`/runs/${result.runId}`}><ExternalLink size={14} /></Link> : '-'}</td>
      <td>{result.error ?? '-'}</td>
    </tr>)}</tbody></table></div>}
  </section>;
}
