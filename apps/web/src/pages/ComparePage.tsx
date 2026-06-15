import { useEffect, useState } from 'react';
import { ArrowRight, GitCompareArrows, TrendingDown, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, formatDuration, formatNumber, post } from '../api.ts';
import { Empty, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import type { EvalCaseResult, EvalRun } from '../evalTypes.ts';

interface CaseDiff { caseId: string; name: string; classification: string; scoreDelta: number; latencyDelta: number; tokensDelta: number; costDelta: number; baseline?: EvalCaseResult; candidate?: EvalCaseResult }
interface CompareResult { baseline: EvalRun; candidate: EvalRun; delta: { passRate: number; avgScore: number; avgLatencyMs: number; avgTotalTokens: number; totalCost: number; failedCases: number }; summary: { improved: number; regressed: number; unchanged: number; newFailures: number }; cases: CaseDiff[] }
export function ComparePage() {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [result, setResult] = useState<CompareResult>();
  useEffect(() => { void api<EvalRun[]>('/api/eval/runs').then((items) => { const completed = items.filter((item) => item.status === 'completed'); setRuns(completed); setLeft(completed[1]?.id ?? completed[0]?.id ?? ''); setRight(completed[0]?.id ?? ''); }); }, []);
  return <section><PageHeader eyebrow="08 / REGRESSION COMPARE" title="Baseline Decision Room" description="对比两个 Eval Run 的总体指标、成本、失败变化和 Case 级证据。" />
    <div className="compare-controls panel"><label>BASELINE<select value={left} onChange={(event) => setLeft(event.target.value)}>{runs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><ArrowRight size={22} /><label>CANDIDATE<select value={right} onChange={(event) => setRight(event.target.value)}>{runs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><button className="primary" disabled={!left || !right || left === right} onClick={() => void post<CompareResult>('/api/eval/compare', { baselineEvalRunId: left, candidateEvalRunId: right }).then(setResult)}><GitCompareArrows size={15} />运行对比</button></div>
    {!result ? <Empty>至少完成两个 Eval Run 后，可执行 Baseline 与 Candidate 回归对比。</Empty> : <><div className="comparison-head"><RunHead label="BASELINE" item={result.baseline} /><div className="versus">VS</div><RunHead label="CANDIDATE" item={result.candidate} /></div><div className="metric-grid"><Delta label="PASS RATE" value={result.delta.passRate} format={(value) => `${(value * 100).toFixed(1)}%`} positive /><Delta label="AVG SCORE" value={result.delta.avgScore} format={(value) => value.toFixed(2)} positive /><Delta label="AVG LATENCY" value={result.delta.avgLatencyMs} format={formatDuration} /><Delta label="TOTAL COST" value={result.delta.totalCost} format={(value) => value.toFixed(6)} /></div><div className="metric-grid compact"><Metric label="IMPROVED" value={result.summary.improved} tone="green" /><Metric label="REGRESSED" value={result.summary.regressed} tone="red" /><Metric label="UNCHANGED" value={result.summary.unchanged} /><Metric label="NEW FAILURES" value={result.summary.newFailures} tone="amber" /></div><div className="table-wrap"><table><thead><tr><th>CASE</th><th>CLASSIFICATION</th><th>SCORE Δ</th><th>LATENCY Δ</th><th>TOKENS Δ</th><th>COST Δ</th><th>BASELINE</th><th>CANDIDATE</th></tr></thead><tbody>{result.cases.map((item) => <tr key={item.caseId}><td className="run-name"><strong>{item.name}</strong><span>{item.caseId}</span></td><td><StatusBadge status={item.classification} /></td><td className="score">{item.scoreDelta.toFixed(2)}</td><td>{formatDuration(item.latencyDelta)}</td><td>{formatNumber(item.tokensDelta)}</td><td>{item.costDelta.toFixed(6)}</td><td>{item.baseline && <Link to={`/evals/results/${item.baseline.id}`}>{item.baseline.totalScore.toFixed(2)} ↗</Link>}</td><td>{item.candidate && <Link to={`/evals/results/${item.candidate.id}`}>{item.candidate.totalScore.toFixed(2)} ↗</Link>}</td></tr>)}</tbody></table></div></>}
  </section>;
}
function RunHead({ label, item }: { label: string; item: EvalRun }) { return <div><span>{label}</span><h2>{item.name}</h2><b>{item.modelName} · {(item.passRate * 100).toFixed(0)}%</b></div>; }
function Delta({ label, value, format, positive = false }: { label: string; value: number; format: (value: number) => string; positive?: boolean }) {
  const good = positive ? value >= 0 : value <= 0;
  return <div className="delta-card"><span>{label}</span><div><strong>{format(value)}</strong></div><em className={good ? 'positive' : 'negative'}>{good ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{value >= 0 ? '+' : ''}{format(value)}</em></div>;
}
