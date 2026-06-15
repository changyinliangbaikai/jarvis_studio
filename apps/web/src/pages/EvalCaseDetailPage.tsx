import { useEffect, useState } from 'react';
import { ArrowLeft, Play } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { JsonView, Loading, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import type { EvalCase, EvalRun, ModelProviderOption } from '../evalTypes.ts';

export function EvalCaseDetailPage() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<EvalCase>();
  const [providers, setProviders] = useState<ModelProviderOption[]>([]);
  const [providerId, setProviderId] = useState('');
  const [judge, setJudge] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void Promise.all([api<EvalCase>(`/api/eval/cases/${caseId}`), api<ModelProviderOption[]>('/api/model-providers')]).then(([evalCase, items]) => {
      const enabled = items.filter((provider) => provider.enabled);
      setItem(evalCase); setProviders(enabled); setProviderId(enabled[0]?.id ?? '');
    });
  }, [caseId]);
  if (!item) return <Loading />;
  const execute = async () => {
    try {
      const result = await post<{ runs: EvalRun[] }>('/api/eval/runs', {
        datasetId: item.datasetId, caseIds: [item.id], modelProviderId: providerId,
        enableLlmJudge: judge, name: `Single Case · ${item.name}`
      });
      navigate(`/evals/runs/${result.runs[0]!.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '运行失败');
    }
  };
  return <section>
    <Link className="back-link" to="/evals"><ArrowLeft size={13} />返回 Eval Cases</Link>
    <PageHeader eyebrow="EVAL CASE / FIXED CONTRACT" title={item.name} description={`${item.id} · ${item.datasetId} · ${item.version}`}
      actions={<div className="single-run-controls"><select value={providerId} onChange={(event) => setProviderId(event.target.value)}>{providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name} · {provider.defaultModel}</option>)}</select><label><input type="checkbox" checked={judge} onChange={(event) => setJudge(event.target.checked)} />Judge</label><button className="primary" disabled={!providerId} onClick={() => void execute()}><Play size={14} />单独运行</button></div>} />
    {error && <div className="notice warning">{error}</div>}
    <div className="eval-case-contract">
      <article className="panel"><div className="panel-title">CASE IDENTITY <StatusBadge status={item.priority} /></div><dl><dt>CATEGORY</dt><dd>{item.category}</dd><dt>TAGS</dt><dd>{item.tags.join(' / ')}</dd><dt>INPUT</dt><dd>{item.input.message}</dd><dt>FILES</dt><dd>{item.input.files.map((file) => file.path).join(', ') || 'none'}</dd></dl></article>
      <article className="panel"><div className="panel-title">EXPECTED BEHAVIOR</div><JsonView value={item.expected} /></article>
      <article className="panel"><div className="panel-title">SCORING PROFILE</div><JsonView value={item.scoring} /></article>
      <article className="panel"><div className="panel-title">PASS CRITERIA</div><JsonView value={item.passCriteria} /></article>
    </div>
  </section>;
}
