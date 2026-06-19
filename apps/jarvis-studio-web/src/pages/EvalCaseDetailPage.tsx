import { useCallback, useEffect, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { ArrowLeft, Play } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { JsonView, Loading, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import type { EvalCase, EvalRun, ModelProviderOption } from '../evalTypes.ts';

export function EvalCaseDetailPage() {
  const { caseId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [providerId, setProviderId] = useState('');
  const [judge, setJudge] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (signal: AbortSignal) => {
    const [item, providers] = await Promise.all([api<EvalCase>(`/api/eval/cases/${caseId}`, { signal }), api<ModelProviderOption[]>('/api/model-providers', { signal })]);
    return { item, providers: providers.filter((provider) => provider.enabled) };
  }, [caseId]);
  const resource = useAsyncResource(load, [caseId], Boolean(caseId), { queryKey: ['eval-case-detail', caseId] });
  const item = resource.data?.item;
  const providers = resource.data?.providers ?? [];
  useEffect(() => {
    setProviderId((current) => current || providers[0]?.id || '');
  }, [providers]);
  if (!item) return <Loading />;
  const fallbackBackTo = item.datasetId ? `/evals?tab=cases&datasetId=${encodeURIComponent(item.datasetId)}` : '/evals?tab=cases';
  const backTo = readBackTarget(location.state) ?? fallbackBackTo;
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
    <Link className="back-link" to={backTo}><ArrowLeft size={13} />返回当前用例列表</Link>
    <PageHeader eyebrow="评测用例 / 固定契约 (Eval Case)" title={item.name} description={`${item.id} · ${item.datasetId} · ${item.version}`}
      actions={<div className="single-run-controls"><ThemedSelect value={providerId} onChange={(event) => setProviderId(event.target.value)}>{providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name} · {provider.defaultModel}</option>)}</ThemedSelect><label><input type="checkbox" checked={judge} onChange={(event) => setJudge(event.target.checked)} />启用 Judge</label><button className="primary" disabled={!providerId} onClick={() => void execute()}><Play size={14} />单独运行</button></div>} />
    {(resource.error || error) && <div className="notice warning">{resource.error || error}</div>}
    <div className="eval-case-contract">
      <article className="panel"><div className="panel-title">用例身份 (Case Identity) <StatusBadge status={item.priority} /></div><dl><dt>分类</dt><dd>{item.category}</dd><dt>标签</dt><dd>{item.tags.join(' / ')}</dd><dt>用户任务</dt><dd>{item.input.message}</dd><dt>文件</dt><dd>{item.input.files.map((file) => file.path).join(', ') || '无'}</dd></dl></article>
      <article className="panel"><div className="panel-title">期望行为 (Expected Behavior)</div><JsonView value={item.expected} /></article>
      <article className="panel"><div className="panel-title">评分配置 (Scoring Profile)</div><JsonView value={item.scoring} /></article>
      <article className="panel"><div className="panel-title">通过标准 (Pass Criteria)</div><JsonView value={item.passCriteria} /></article>
    </div>
  </section>;
}

function readBackTarget(state: unknown) {
  if (!state || typeof state !== 'object') return undefined;
  const from = (state as { from?: unknown }).from;
  return typeof from === 'string' && from.startsWith('/evals?tab=cases') ? from : undefined;
}
