import { useCallback, useEffect, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { ArrowRight, GitCompareArrows, TrendingDown, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import type { EvalCaseResult, EvalRun } from '../evalTypes.ts';
import { formatDuration, formatNumber } from '../utils/format.ts';

interface CaseDiff { caseId: string; name: string; classification: string; scoreDelta: number; latencyDelta: number; tokensDelta: number; costDelta: number; baseline?: EvalCaseResult; candidate?: EvalCaseResult }
interface CompareResult { baseline: EvalRun; candidate: EvalRun; delta: { passRate: number; avgScore: number; avgLatencyMs: number; avgTotalTokens: number; totalCost: number; failedCases: number }; summary: { improved: number; regressed: number; unchanged: number; newFailures: number }; cases: CaseDiff[] }
export function ComparePage() {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [result, setResult] = useState<CompareResult>();
  const loadRuns = useCallback(async (signal: AbortSignal) => {
    const items = await api<EvalRun[]>('/api/eval/runs', { signal });
    return items.filter((item) => item.status === 'completed');
  }, []);
  const runResource = useAsyncResource(loadRuns, [], true, { queryKey: ['compare-runs'] });
  useEffect(() => {
    const completedRuns = runResource.data;
    if (!completedRuns) return;
    setRuns(completedRuns);
    setLeft((current) => current || completedRuns[1]?.id || completedRuns[0]?.id || '');
    setRight((current) => current || completedRuns[0]?.id || '');
  }, [runResource.data]);
  return <section><PageHeader eyebrow="08 / 回归对比 (Regression Compare)" title="Baseline 决策室" description="对比两个 Eval Run 的总体指标、成本、失败变化和 Case 级证据。" />
    {runResource.error && <div className="notice warning">{runResource.error}</div>}
    <div className="compare-controls panel"><label>基线 (Baseline)<ThemedSelect value={left} onChange={(event) => setLeft(event.target.value)}>{runs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</ThemedSelect></label><ArrowRight size={22} /><label>候选 (Candidate)<ThemedSelect value={right} onChange={(event) => setRight(event.target.value)}>{runs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</ThemedSelect></label><button className="primary" disabled={!left || !right || left === right} onClick={() => void post<CompareResult>('/api/eval/compare', { baselineEvalRunId: left, candidateEvalRunId: right }).then(setResult)}><GitCompareArrows size={15} />运行对比</button></div>
    {!result ? <Empty>至少完成两个 Eval Run 后，可执行 Baseline 与 Candidate 回归对比。</Empty> : <><div className="comparison-head"><RunHead label="基线 (Baseline)" item={result.baseline} /><div className="versus">VS</div><RunHead label="候选 (Candidate)" item={result.candidate} /></div><div className="metric-grid"><Delta label="通过率 Δ" value={result.delta.passRate} format={(value) => `${(value * 100).toFixed(1)}%`} positive /><Delta label="平均分 Δ" value={result.delta.avgScore} format={(value) => value.toFixed(2)} positive /><Delta label="耗时 Δ" value={result.delta.avgLatencyMs} format={formatDuration} /><Delta label="总成本 Δ" value={result.delta.totalCost} format={(value) => value.toFixed(6)} /></div><div className="metric-grid compact"><Metric label="IMPROVED" value={result.summary.improved} tone="green" /><Metric label="REGRESSED" value={result.summary.regressed} tone="red" /><Metric label="UNCHANGED" value={result.summary.unchanged} /><Metric label="NEW FAILURES" value={result.summary.newFailures} tone="amber" /></div><div className="table-wrap"><table><thead><tr><th>用例</th><th>分类</th><th>得分 Δ</th><th>耗时 Δ</th><th>Token Δ</th><th>成本 Δ</th><th>基线</th><th>候选</th></tr></thead><tbody>{result.cases.map((item) => <tr key={item.caseId}><td className="run-name"><strong>{item.name}</strong><span>{item.caseId}</span></td><td><StatusBadge status={item.classification} /></td><td className="score">{item.scoreDelta.toFixed(2)}</td><td>{formatDuration(item.latencyDelta)}</td><td>{formatNumber(item.tokensDelta)}</td><td>{item.costDelta.toFixed(6)}</td><td>{item.baseline && <Link to={`/evals/results/${item.baseline.id}`}>{item.baseline.totalScore.toFixed(2)} ↗</Link>}</td><td>{item.candidate && <Link to={`/evals/results/${item.candidate.id}`}>{item.candidate.totalScore.toFixed(2)} ↗</Link>}</td></tr>)}</tbody></table></div></>}
  </section>;
}
function RunHead({ label, item }: { label: string; item: EvalRun }) {
  const contextStrategy = item.contextStrategyVersion ?? item.config?.contextStrategy ?? 'balanced-v1';
  const toolPolicy = item.config?.toolPolicy ?? 'default-local-policy@0.4.0';
  return <div><span>{label}</span><h2>{item.name}</h2><b>{item.modelName} · {(item.passRate * 100).toFixed(0)}%</b><p>Context {contextStrategy} · Tool Policy {toolPolicy}</p></div>;
}
function Delta({ label, value, format, positive = false }: { label: string; value: number; format: (value: number) => string; positive?: boolean }) {
  const good = positive ? value >= 0 : value <= 0;
  const isUp = value >= 0;
  const formatted = format(value);
  return <div className="delta-card"><span>{label}</span><div><strong>{formatted}</strong></div><em className={good ? 'positive' : 'negative'}>{isUp ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{isUp ? '+' : ''}{formatted}</em></div>;
}
