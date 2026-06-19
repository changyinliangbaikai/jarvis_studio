import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, FileDown, RefreshCcw, ShieldCheck, ShieldX, StopCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import type { EvalRun } from '../evalTypes.ts';
import { formatDuration, formatNumber } from '../utils/format.ts';

export function EvalRunDetailPage() {
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
  const generate = async () => { await post(`/api/reports/eval/${item.id}/generate`, {}); setNotice('Markdown Eval Report 已生成。'); await resource.reload(); };
  return <section>
    <Link className="back-link" to="/evals?tab=runs"><ArrowLeft size={13} />返回评测运行列表</Link>
    <PageHeader eyebrow="评测运行 / 可追溯质量记录" title={String(item.name)} description={`${item.datasetName} @ ${item.datasetVersion} · ${item.modelName} · ${item.promptVersion}`}
      actions={<><button onClick={() => void post(`/api/eval/runs/${item.id}/rescore`, {}).then(() => resource.reload())}><RefreshCcw size={14} />重新评分</button>{['created', 'running'].includes(item.status) && <button onClick={() => void post(`/api/eval/runs/${item.id}/cancel`, {}).then(() => resource.reload())}><StopCircle size={14} />取消</button>}<button className="primary" onClick={() => void generate()}><FileDown size={14} />生成报告</button></>} />
    {resource.error && <div className="notice warning">{resource.error}</div>}
    {notice && <div className="notice">{notice}</div>}
    <div className="metric-grid"><Metric label="PASS RATE" value={`${(item.passRate * 100).toFixed(0)}%`} tone={item.passRate >= .85 ? 'green' : 'red'} /><Metric label="AVG SCORE" value={item.avgScore.toFixed(2)} tone="amber" /><Metric label="AVG LATENCY" value={formatDuration(item.avgLatencyMs)} /><Metric label="AVG TOKENS / COST" value={`${formatNumber(item.avgTotalTokens)} / ${item.totalCost.toFixed(5)} ${item.currency}`} tone="cyan" /></div>
    <div className="eval-run-meta panel"><span>状态<b><StatusBadge status={item.status} /></b></span><span>Runtime<b>{item.runtimeVersion}</b></span><span>用例<b>{item.passedCases} 通过 / {item.failedCases} 失败</b></span><span>LLM Judge<b>{item.enableLlmJudge ? '启用' : '停用'}</b></span></div>
    {item.gateResult && <div className={`gate-card ${item.gateResult.passed ? 'gate-pass' : 'gate-fail'}`}><div className="gate-decision">{item.gateResult.passed ? <ShieldCheck size={32} /> : <ShieldX size={32} />}<div><span>发布门禁</span><h2>{item.gateResult.passed ? 'PASS / 可准入' : 'BLOCK / 不准入'}</h2><p>{item.gateResult.gateName}</p></div></div><div className="gate-checks">{item.gateResult.failedCriteria.length ? item.gateResult.failedCriteria.map((check) => <div key={check.label}><span>{check.label}</span><strong>{check.actual} / {check.expected}</strong><b>失败</b></div>) : <div><span>全部门禁项</span><strong>符合预期</strong><b>通过</b></div>}</div></div>}
    <div className="failure-ledger">{item.failureStats?.map((stat) => <span key={stat.tag}>{stat.tag}<b>{stat.count}</b></span>)}</div>
    {!item.results?.length ? <Empty>评测正在运行或尚无 Case Result。</Empty> : <div className="table-wrap"><table><thead><tr><th>用例结果</th><th>状态</th><th>总分 / 规则分</th><th>Judge / 人工</th><th>耗时</th><th>Token / 成本</th><th>问题标签</th><th>Trace</th></tr></thead><tbody>{item.results.map((result) => <tr key={result.id}>
      <td className="run-name"><Link to={`/evals/results/${result.id}`}><strong>{result.evalCaseName}</strong><span>{result.evalCaseId} · {result.priority}</span></Link></td><td><StatusBadge status={result.passed ? 'success' : result.status} /></td><td className="score">{result.totalScore.toFixed(2)} / {result.ruleScore.toFixed(2)}</td><td>{result.llmJudgeScore?.toFixed(2) ?? '—'} / {result.humanScore?.toFixed(2) ?? '—'}</td><td>{formatDuration(result.latencyMs)}</td><td>{formatNumber(result.totalTokens)} / {result.cost.toFixed(5)}</td><td>{result.issueTags.join(', ') || '—'}</td><td>{result.runId ? <Link className="icon-link" to={`/runs/${result.runId}`}>↗</Link> : '—'}</td>
    </tr>)}</tbody></table></div>}
  </section>;
}
