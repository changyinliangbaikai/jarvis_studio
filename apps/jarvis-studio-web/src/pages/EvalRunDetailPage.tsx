import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, FileDown, RefreshCcw, ShieldCheck, ShieldX, StopCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import type { EvalRun } from '../evalTypes.ts';
import { formatDuration, formatNumber } from '../utils/format.ts';
import { useTranslation } from 'react-i18next';

export function EvalRunDetailPage() {
  const { t } = useTranslation();
  const { evalRunId = '' } = useParams();
  const [notice, setNotice] = useState('');
  const load = useCallback((signal: AbortSignal) => api<EvalRun>(`/api/eval/runs/${evalRunId}`, { signal }), [evalRunId]);
  const resource = useAsyncResource(load, [evalRunId], Boolean(evalRunId), { queryKey: ['eval-run-detail', evalRunId] });
  const item = resource.data;
  useEffect(() => {
    if (!item || !['created', 'running', 'scoring'].includes(item.status)) return;
    const timer = window.setInterval(() => void resource.reload(), 1000);
    return () => window.clearInterval(timer);
  }, [item?.id, item?.status, resource.reload]);
  if (!item) return <Loading />;
  const generate = async () => { await post(`/api/reports/eval/${item.id}/generate`, {}); setNotice(t('pages.evalRunDetail.string_17')); await resource.reload(); };
  return <section>
    <Link className="back-link" to="/evals?tab=runs"><ArrowLeft size={13} />{t('pages.evalRunDetail.string_2')}</Link>
    <PageHeader eyebrow={t('pages.evalRunDetail.string_1')} title={String(item.name)} description={`${item.datasetName} @ ${item.datasetVersion} · ${item.modelName} · ${item.promptVersion}`}
      actions={<><button onClick={() => void post(`/api/eval/runs/${item.id}/rescore`, {}).then(() => resource.reload())}><RefreshCcw size={14} />{t('pages.evalRunDetail.string_3')}</button>{['created', 'running'].includes(item.status) && <button onClick={() => void post(`/api/eval/runs/${item.id}/cancel`, {}).then(() => resource.reload())}><StopCircle size={14} />{t('common.cancel')}</button>}<button className="primary" onClick={() => void generate()}><FileDown size={14} />{t('pages.evalRunDetail.string_4')}</button></>} />
    {resource.error && <div className="notice warning">{resource.error}</div>}
    {notice && <div className="notice">{notice}</div>}
    <div className="metric-grid"><Metric label="PASS RATE" value={`${(item.passRate * 100).toFixed(0)}%`} tone={item.passRate >= .85 ? 'green' : 'red'} /><Metric label="AVG SCORE" value={item.avgScore.toFixed(2)} tone="amber" /><Metric label="AVG LATENCY" value={formatDuration(item.avgLatencyMs)} /><Metric label="AVG TOKENS / COST" value={`${formatNumber(item.avgTotalTokens)} / ${item.totalCost.toFixed(5)} ${item.currency}`} tone="cyan" /></div>
    <div className="eval-run-meta panel">
      <span>{t('common.status')}<b><StatusBadge status={item.status} /></b></span>
      <span>Runtime<b>{item.runtimeVersion}</b></span>
      <span>{t('pages.evalRunDetail.string_5')}<b>{t('pages.evalRunDetail.casesSummary', { passed: item.passedCases, failed: item.failedCases })}</b></span>
      <span>LLM Judge<b>{item.enableLlmJudge ? t('common.yes') : t('common.no')}</b></span>
    </div>
    {item.gateResult && <div className={`gate-card ${item.gateResult.passed ? 'gate-pass' : 'gate-fail'}`}><div className="gate-decision">{item.gateResult.passed ? <ShieldCheck size={32} /> : <ShieldX size={32} />}<div><span>{t('pages.evalRunDetail.string_6')}</span><h2>{item.gateResult.passed ? t('pages.evalRunDetail.string_20') : t('pages.evalRunDetail.string_21')}</h2><p>{item.gateResult.gateName}</p></div></div><div className="gate-checks">{item.gateResult.failedCriteria.length ? item.gateResult.failedCriteria.map((check) => <div key={check.label}><span>{check.label}</span><strong>{check.actual} / {check.expected}</strong><b>{t('common.failed')}</b></div>) : <div><span>{t('pages.evalRunDetail.string_7')}</span><strong>{t('pages.evalRunDetail.string_8')}</strong><b>{t('pages.evalRunDetail.string_9')}</b></div>}</div></div>}
    <div className="failure-ledger">{item.failureStats?.map((stat) => <span key={stat.tag}>{stat.tag}<b>{stat.count}</b></span>)}</div>
    {!item.results?.length ? <Empty>{t('pages.evalRunDetail.string_10')}</Empty> : <div className="table-wrap"><table><thead><tr><th>{t('pages.evalRunDetail.string_11')}</th><th>{t('common.status')}</th><th>{t('pages.evalRunDetail.string_12')}</th><th>{t('pages.evalRunDetail.string_13')}</th><th>{t('pages.evalRunDetail.string_14')}</th><th>{t('pages.evalRunDetail.string_15')}</th><th>{t('pages.evalRunDetail.string_16')}</th><th>Trace</th></tr></thead><tbody>{item.results.map((result) => <tr key={result.id}>
      <td className="run-name"><Link to={`/evals/results/${result.id}`}><strong>{result.evalCaseName}</strong><span>{result.evalCaseId} · {result.priority}</span></Link></td><td><StatusBadge status={result.passed ? 'success' : result.status} /></td><td className="score">{result.totalScore.toFixed(2)} / {result.ruleScore.toFixed(2)}</td><td>{result.llmJudgeScore?.toFixed(2) ?? '—'} / {result.humanScore?.toFixed(2) ?? '—'}</td><td>{formatDuration(result.latencyMs)}</td><td>{formatNumber(result.totalTokens)} / {result.cost.toFixed(5)}</td><td>{result.issueTags.join(', ') || '—'}</td><td>{result.runId ? <Link className="icon-link" to={`/runs/${result.runId}`}>↗</Link> : '—'}</td>
    </tr>)}</tbody></table></div>}
  </section>;
}
