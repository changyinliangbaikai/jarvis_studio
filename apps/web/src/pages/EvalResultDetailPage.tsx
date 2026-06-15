import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Save } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { JsonView, Loading, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import type { EvalCase, EvalCaseResult, EvalRun } from '../evalTypes.ts';

const tags = ['skill_selection_error', 'tool_missing', 'tool_wrong', 'tool_error', 'tool_timeout', 'model_error', 'model_timeout', 'context_overflow', 'context_missing', 'context_pollution', 'hallucinated_field', 'hallucinated_fact', 'format_error', 'artifact_missing', 'artifact_invalid', 'permission_denied', 'unsafe_action', 'incomplete_answer', 'low_quality', 'unknown'];
interface Detail extends EvalCaseResult { evalCase: EvalCase; evalRun: EvalRun }
export function EvalResultDetailPage() {
  const { resultId = '' } = useParams();
  const [item, setItem] = useState<Detail>();
  const [score, setScore] = useState(4);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => { const detail = await api<Detail>(`/api/eval/results/${resultId}`); setItem(detail); setScore(detail.humanScore ?? 4); setSelectedTags((detail.humanReview?.issueTags as string[] | undefined) ?? []); setComment(String(detail.humanReview?.comment ?? '')); };
  useEffect(() => { void load(); }, [resultId]);
  if (!item) return <Loading />;
  const save = async () => { await post(`/api/eval/results/${item.id}/human-review`, { score, issueTags: selectedTags, comment }); setNotice('人工 Review 已保存并重新聚合 Eval Run 指标。'); await load(); };
  return <section>
    <Link className="back-link" to={`/evals/runs/${item.evalRunId}`}><ArrowLeft size={13} />返回 Eval Run</Link>
    <PageHeader eyebrow="CASE RESULT / HUMAN CALIBRATION" title={item.evalCaseName} description={`${item.evalCaseId} · ${item.category} · 关联真实 Run ${item.runId ?? '—'}`} actions={item.runId && <Link className="icon-link wide-link" to={`/runs/${item.runId}`}>查看 Trace ↗</Link>} />
    {notice && <div className="notice"><Check size={14} />{notice}</div>}
    <div className="result-detail-grid">
      <div className="panel result-evidence"><div className="panel-title">CASE CONTRACT <StatusBadge status={item.priority} /></div><h3>USER INPUT</h3><p>{item.evalCase.input.message}</p><h3>EXPECTED</h3><JsonView value={item.evalCase.expected} /><h3>FINAL OUTPUT</h3><pre>{item.finalOutput || item.error || 'No output.'}</pre></div>
      <div className="panel result-evidence"><div className="panel-title">AUTOMATED SCORING <b className="score">{item.totalScore.toFixed(2)}</b></div><h3>RULE CHECKS</h3><div className="rule-checks">{item.ruleResults.checks?.map((check, index) => <div key={`${check.checkId}-${index}`} className={check.passed ? 'passed' : 'failed'}><b>{check.passed ? 'PASS' : 'FAIL'}</b><span>{check.label}</span><p>{check.reason}</p></div>)}</div><h3>LLM JUDGE</h3><JsonView value={item.judgeResult ?? { status: 'disabled' }} /></div>
    </div>
    <div className="panel human-review"><div className="panel-title">HUMAN REVIEW / FINAL CALIBRATION</div><div className="review-score">{[1, 2, 3, 4, 5].map((value) => <button key={value} className={score === value ? 'active' : ''} onClick={() => setScore(value)}>{value}</button>)}</div><div className="tag-cloud">{tags.map((tag) => <button key={tag} className={selectedTags.includes(tag) ? 'active' : ''} onClick={() => setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}>{tag}</button>)}</div><textarea rows={5} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="填写评语、问题复现线索和改进建议。" /><div className="modal-actions"><button className="primary" onClick={() => void save()}><Save size={14} />保存人工评分</button></div></div>
  </section>;
}
