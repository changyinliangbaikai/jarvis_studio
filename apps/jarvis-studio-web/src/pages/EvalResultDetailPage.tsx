import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, Save } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { JsonView, Loading, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import type { EvalCase, EvalCaseResult, EvalRun } from '../evalTypes.ts';

const tags = ['skill_selection_error', 'tool_missing', 'tool_wrong', 'tool_error', 'tool_timeout', 'model_error', 'model_timeout', 'context_overflow', 'context_missing', 'context_pollution', 'hallucinated_field', 'hallucinated_fact', 'format_error', 'artifact_missing', 'artifact_invalid', 'permission_denied', 'unsafe_action', 'incomplete_answer', 'low_quality', 'unknown'];
interface Detail extends EvalCaseResult { evalCase: EvalCase; evalRun: EvalRun }
export function EvalResultDetailPage() {
  const { t } = useTranslation();
  const { resultId = '' } = useParams();
  const [score, setScore] = useState(4);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback((signal: AbortSignal) => api<Detail>(`/api/eval/results/${resultId}`, { signal }), [resultId]);
  const resource = useAsyncResource(load, [resultId], Boolean(resultId), { queryKey: ['eval-result-detail', resultId] });
  const item = resource.data;
  useEffect(() => {
    if (!item) return;
    setScore(item.humanScore ?? 4);
    setSelectedTags((item.humanReview?.issueTags as string[] | undefined) ?? []);
    setComment(String(item.humanReview?.comment ?? ''));
  }, [item?.id]);
  if (!item) return <Loading />;
  const save = async () => { await post(`/api/eval/results/${item.id}/human-review`, { score, issueTags: selectedTags, comment }); setNotice(t('pages.evalResultDetail.string_13')); await resource.reload(); };
  return <section>
    <Link className="back-link" to={`/evals/runs/${item.evalRunId}`}><ArrowLeft size={13} />{t('pages.evalResultDetail.string_3')}</Link>
    <PageHeader eyebrow={t('pages.evalResultDetail.string_1')} title={item.evalCaseName} description={`${item.evalCaseId} · ${item.category} · 关联真实 Run ${item.runId ?? '—'}`} actions={item.runId && <Link className="icon-link wide-link" to={`/runs/${item.runId}`}>{t('pages.evalResultDetail.string_4')}</Link>} />
    {resource.error && <div className="notice warning">{resource.error}</div>}
    {notice && <div className="notice"><Check size={14} />{notice}</div>}
    <div className="result-detail-grid">
      <div className="panel result-evidence"><div className="panel-title">{t('pages.evalResultDetail.string_5')}<StatusBadge status={item.priority} /></div><h3>{t('pages.evalResultDetail.string_6')}</h3><p>{item.evalCase.input.message}</p><h3>{t('pages.evalResultDetail.string_7')}</h3><JsonView value={item.evalCase.expected} /><h3>{t('pages.evalResultDetail.string_8')}</h3><pre>{item.finalOutput || item.error || t('pages.evalResultDetail.string_14')}</pre></div>
      <div className="panel result-evidence"><div className="panel-title">{t('pages.evalResultDetail.string_9')}<b className="score">{item.totalScore.toFixed(2)}</b></div><h3>{t('pages.evalResultDetail.string_10')}</h3><div className="rule-checks">{item.ruleResults.checks?.map((check, index) => <div key={`${check.checkId}-${index}`} className={check.passed ? 'passed' : 'failed'}><b>{check.passed ? t('pages.evalResultDetail.string_15') : t('common.failed')}</b><span>{check.label}</span><p>{check.reason}</p></div>)}</div><h3>LLM Judge</h3><JsonView value={item.judgeResult ?? { status: 'disabled' }} /></div>
    </div>
    <div className="panel human-review"><div className="panel-title">{t('pages.evalResultDetail.string_11')}</div><div className="review-score">{[1, 2, 3, 4, 5].map((value) => <button key={value} className={score === value ? 'active' : ''} onClick={() => setScore(value)}>{value}</button>)}</div><div className="tag-cloud">{tags.map((tag) => <button key={tag} className={selectedTags.includes(tag) ? 'active' : ''} onClick={() => setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}>{tag}</button>)}</div><textarea rows={5} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t('pages.evalResultDetail.string_2')} /><div className="modal-actions"><button className="primary" onClick={() => void save()}><Save size={14} />{t('pages.evalResultDetail.string_12')}</button></div></div>
  </section>;
}
