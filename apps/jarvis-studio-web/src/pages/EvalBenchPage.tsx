import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { Beaker, Boxes, DatabaseZap, FileInput, Filter, FlaskConical, Play, RefreshCcw, Rows3 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import type { EvalCase, EvalDataset, EvalRun, ModelProviderOption, ReleaseGate } from '../evalTypes.ts';
import { formatDate, formatDuration, formatNumber } from '../utils/format.ts';

type EvalTab = 'datasets' | 'cases' | 'runs';

export function EvalBenchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showImport, setShowImport] = useState(false);
  const [showRun, setShowRun] = useState(false);
  const [notice, setNotice] = useState('');

  const tab = parseEvalTab(searchParams.get('tab'));
  const datasetFilter = searchParams.get('datasetId') ?? '';
  const priorityFilter = searchParams.get('priority') ?? '';
  const setView = (next: Partial<{ tab: EvalTab; datasetId: string; priority: string }>) => {
    const nextTab = next.tab ?? tab;
    const params = new URLSearchParams(searchParams);
    if (nextTab === 'datasets') params.delete('tab');
    else params.set('tab', nextTab);
    if (nextTab === 'cases') {
      const nextDataset = next.datasetId ?? datasetFilter;
      const nextPriority = next.priority ?? priorityFilter;
      if (nextDataset) params.set('datasetId', nextDataset);
      else params.delete('datasetId');
      if (nextPriority) params.set('priority', nextPriority);
      else params.delete('priority');
    } else {
      params.delete('datasetId');
      params.delete('priority');
    }
    setSearchParams(params);
  };

  const load = useCallback(async (signal: AbortSignal) => {
    const [datasets, cases, runs, providers, gates] = await Promise.all([
      api<EvalDataset[]>('/api/eval/datasets', { signal }), api<EvalCase[]>('/api/eval/cases', { signal }),
      api<EvalRun[]>('/api/eval/runs', { signal }), api<ModelProviderOption[]>('/api/model-providers', { signal }),
      api<ReleaseGate[]>('/api/release-gates', { signal })
    ]);
    return { datasets, cases, runs, providers, gates };
  }, []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['eval-bench'] });
  const datasets = resource.data?.datasets;
  const cases = resource.data?.cases ?? [];
  const runs = resource.data?.runs ?? [];
  const providers = resource.data?.providers ?? [];
  const gates = resource.data?.gates ?? [];
  // 只依赖"是否还存在活动 run"这一稳定布尔；原写法依赖 runs 数组本身，每次 reload 都换引用，
  // 会让定时器在每个轮询周期被销毁→重建，导致定时器生存期抖动甚至并发争抢。
  const hasActiveRuns = useMemo(
    () => runs.some((item) => ['created', 'running', 'scoring'].includes(item.status)),
    [runs]
  );
  useEffect(() => {
    if (!hasActiveRuns) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      await resource.reload();
      if (!cancelled) timer = window.setTimeout(poll, 1200);
    };
    timer = window.setTimeout(poll, 1200);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [hasActiveRuns, resource.reload]);
  const filteredCases = useMemo(() => cases.filter((item) =>
    (!datasetFilter || item.datasetId === datasetFilter) && (!priorityFilter || item.priority === priorityFilter)), [cases, datasetFilter, priorityFilter]);
  if (!datasets && !resource.error) return <Loading />;
  if (!datasets) return <section>
    <PageHeader eyebrow="07 / 评测工作台 (Eval Bench 2.0)" title="质量保障靶场 (Quality Assurance Range)" description="按 Dataset -> Case -> Eval Run 串联真实 Runtime 评测，聚合规则、Judge、人工评分，并形成发布证据。"
      actions={<button onClick={() => void resource.reload()}><RefreshCcw size={15} />重试加载</button>} />
    <div className="notice warning">{resource.error}</div>
  </section>;
  const latest = runs[0];
  return <section>
    <PageHeader eyebrow="07 / 评测工作台 (Eval Bench 2.0)" title="质量保障靶场 (Quality Assurance Range)" description="按 Dataset -> Case -> Eval Run 串联真实 Runtime 评测，聚合规则、Judge、人工评分，并形成发布证据。"
      actions={<><button onClick={() => setShowImport(true)}><FileInput size={15} />导入数据集</button><button className="primary" onClick={() => setShowRun(true)}><Play size={15} />创建评测运行</button></>} />
    {resource.error && <div className="notice warning">{resource.error}</div>}
    {notice && <div className="notice">{notice}</div>}
    <div className="metric-grid">
      <Metric label="DATASETS" value={datasets.length} tone="cyan" />
      <Metric label="VERSIONED CASES" value={cases.length} />
      <Metric label="EVAL RUNS" value={runs.length} />
      <Metric label="LATEST PASS RATE" value={latest ? `${(latest.passRate * 100).toFixed(0)}%` : '—'} tone={Number(latest?.passRate ?? 0) >= .85 ? 'green' : 'amber'} />
    </div>
    <div className="eval-tabs">
      <button className={tab === 'datasets' ? 'active' : ''} onClick={() => setView({ tab: 'datasets' })}><DatabaseZap size={14} />数据集 (Datasets)</button>
      <button className={tab === 'cases' ? 'active' : ''} onClick={() => setView({ tab: 'cases' })}><Rows3 size={14} />用例 (Cases)</button>
      <button className={tab === 'runs' ? 'active' : ''} onClick={() => setView({ tab: 'runs' })}><FlaskConical size={14} />评测运行 (Eval Runs)</button>
    </div>
    {tab === 'datasets' && <DatasetGrid datasets={datasets} onReload={async (id) => { await post(`/api/eval/datasets/${id}/reload`, {}); setNotice(`Dataset ${id} 已重新加载。`); await resource.reload(); }} onCases={(id) => setView({ tab: 'cases', datasetId: id })} onRun={(id) => { setView({ tab: 'cases', datasetId: id }); setShowRun(true); }} />}
    {tab === 'cases' && <CasesTable cases={filteredCases} datasets={datasets} datasetFilter={datasetFilter} priorityFilter={priorityFilter} onDataset={(value) => setView({ tab: 'cases', datasetId: value })} onPriority={(value) => setView({ tab: 'cases', priority: value })} />}
    {tab === 'runs' && <RunsTable runs={runs} />}
    {showImport && <ImportDatasetModal onClose={() => setShowImport(false)} onDone={async () => { setShowImport(false); setNotice('Dataset 已导入并完成 schema 校验。'); await resource.reload(); }} />}
    {showRun && <CreateRunModal datasets={datasets} providers={providers.filter((item) => item.enabled)} gates={gates} preferredDataset={datasetFilter} onClose={() => setShowRun(false)}
      onDone={async (count) => { setShowRun(false); setView({ tab: 'runs' }); setNotice(`已创建 ${count} 个 Eval Run，后台开始执行。`); await resource.reload(); }} />}
  </section>;
}

function DatasetGrid({ datasets, onReload, onCases, onRun }: { datasets: EvalDataset[]; onReload: (id: string) => void; onCases: (id: string) => void; onRun: (id: string) => void }) {
  return <div className="dataset-grid">{datasets.map((item) => <article className="dataset-card" key={item.id}>
    <div className="dataset-index"><Boxes size={18} /><span>{item.category}</span><b>{item.version}</b></div>
    <h2>{item.name}</h2><code>{item.id}</code><p>{item.description}</p>
    <div className="dataset-stats"><span>用例 (Cases)<b>{item.caseCount}</b></span><span>最近通过率<b>{item.latestRun ? `${(item.latestRun.passRate * 100).toFixed(0)}%` : '—'}</b></span><span>平均分<b>{item.latestRun?.avgScore?.toFixed(2) ?? '—'}</b></span></div>
    <footer><span>{item.releaseGateId ?? '未绑定 Gate'}</span><button onClick={() => onReload(item.id)}><RefreshCcw size={13} /></button><button onClick={() => onCases(item.id)}>查看用例</button><button className="primary" onClick={() => onRun(item.id)}><Play size={13} />运行</button></footer>
  </article>)}</div>;
}

function CasesTable({ cases, datasets, datasetFilter, priorityFilter, onDataset, onPriority }: { cases: EvalCase[]; datasets: EvalDataset[]; datasetFilter: string; priorityFilter: string; onDataset: (value: string) => void; onPriority: (value: string) => void }) {
  const backParams = new URLSearchParams({ tab: 'cases' });
  if (datasetFilter) backParams.set('datasetId', datasetFilter);
  if (priorityFilter) backParams.set('priority', priorityFilter);
  const caseListPath = `/evals?${backParams.toString()}`;
  return <><div className="filter-strip panel"><Filter size={14} /><span className="flow-label">流程：数据集 → 用例列表 → 用例详情</span><ThemedSelect value={datasetFilter} onChange={(event) => onDataset(event.target.value)}><option value="">全部数据集 (All Datasets)</option>{datasets.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</ThemedSelect><ThemedSelect value={priorityFilter} onChange={(event) => onPriority(event.target.value)}><option value="">全部优先级</option>{['p0', 'p1', 'p2', 'p3'].map((item) => <option value={item} key={item}>{item.toUpperCase()}</option>)}</ThemedSelect><span>{cases.length} 个用例</span></div>
    <div className="table-wrap"><table><thead><tr><th>用例 (Case)</th><th>数据集</th><th>优先级</th><th>分类</th><th>最近结果</th><th>得分</th><th>失败原因</th></tr></thead><tbody>{cases.map((item) => <tr key={item.id}><td className="run-name"><Link to={`/evals/cases/${item.id}`} state={{ from: caseListPath }}><strong>{item.name}</strong><span>{item.id} · {item.tags.join(' / ')}</span></Link></td><td>{item.datasetId}</td><td><StatusBadge status={item.priority} /></td><td>{item.category}</td><td>{item.latestResult ? <StatusBadge status={item.latestResult.passed ? 'success' : item.latestResult.status} /> : '—'}</td><td className="score">{item.latestResult?.score.toFixed(2) ?? '—'}</td><td>{item.latestResult?.issueTags.join(', ') || '—'}</td></tr>)}</tbody></table></div></>;
}

function RunsTable({ runs }: { runs: EvalRun[] }) {
  if (!runs.length) return <Empty>尚未创建 Eval Run。</Empty>;
  return <div className="table-wrap"><table><thead><tr><th>评测运行</th><th>数据集 / 模型</th><th>状态</th><th>通过率</th><th>得分</th><th>耗时</th><th>Token / 成本</th><th>创建时间</th></tr></thead><tbody>{runs.map((item) => <tr key={item.id}>
    <td className="run-name"><Link to={`/evals/runs/${item.id}`}><strong>{item.name}</strong><span>{item.id}</span></Link></td>
    <td className="binding"><span>{item.datasetName}</span><b>{item.modelName}</b></td><td><StatusBadge status={item.status} /></td>
    <td className="score">{(item.passRate * 100).toFixed(0)}% <small>{item.passedCases}/{item.totalCases}</small></td><td className="score">{item.avgScore.toFixed(2)}</td>
    <td>{formatDuration(item.avgLatencyMs)}</td><td>{formatNumber(item.avgTotalTokens)} / {item.totalCost.toFixed(5)} {item.currency}</td><td>{formatDate(item.createdAt)}</td>
  </tr>)}</tbody></table></div>;
}

function ImportDatasetModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [dataset, setDataset] = useState('id: custom_dataset_v1\nname: Custom Dataset\nversion: 1.0.0\ncategory: regression\ndescription: Custom eval dataset\nowner: jarvis\n');
  const [cases, setCases] = useState('id: custom_001\nname: Custom case\ncategory: general\npriority: p1\ninput: { message: \"执行测试\", files: [] }\nexpected: { must_call_tools: [], must_include: [] }\nscoring: { max_score: 5 }\npass_criteria: { min_total_score: 4 }\n');
  const [error, setError] = useState('');
  const submit = async () => { try { await post('/api/eval/datasets/import', { content: dataset, cases: [cases] }); onDone(); } catch (caught) { setError(caught instanceof Error ? caught.message : '导入失败'); } };
  return <div className="modal-backdrop" onClick={onClose}><div className="modal eval-import-modal" onClick={(event) => event.stopPropagation()}><span className="eyebrow">Dataset + Case YAML</span><h2>导入版本化测试集</h2>{error && <div className="notice warning">{error}</div>}<div className="yaml-pair"><label>dataset.yaml<textarea rows={13} value={dataset} onChange={(event) => setDataset(event.target.value)} /></label><label>case yaml<textarea rows={13} value={cases} onChange={(event) => setCases(event.target.value)} /></label></div><div className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" onClick={() => void submit()}>校验并导入</button></div></div></div>;
}

function CreateRunModal({ datasets, providers, gates, preferredDataset, onClose, onDone }: { datasets: EvalDataset[]; providers: ModelProviderOption[]; gates: ReleaseGate[]; preferredDataset: string; onClose: () => void; onDone: (count: number) => void }) {
  const initialProvider = providers.find((item) => item.isDefault) ?? providers[0];
  const initialDefaults = providerEvalDefaults(initialProvider);
  const [form, setForm] = useState({ datasetId: preferredDataset || datasets[0]?.id || '', modelProviderId: initialProvider?.id || '', promptVersion: 'base-agent@v0.3', maxParallel: initialDefaults.maxParallel, retryCount: initialDefaults.retryCount, timeoutSeconds: 120, enableLlmJudge: false, releaseGateId: gates[0]?.id || '' });
  const [error, setError] = useState('');
  const selectedProvider = providers.find((item) => item.id === form.modelProviderId);
  const remoteProvider = selectedProvider?.providerType === 'openai-compatible';
  const submit = async () => { try { const result = await post<{ runs: EvalRun[] }>('/api/eval/runs', form); onDone(result.runs.length); } catch (caught) { setError(caught instanceof Error ? caught.message : '创建失败'); } };
  return <div className="modal-backdrop" onClick={onClose}><div className="modal run-create-modal" onClick={(event) => event.stopPropagation()}><span className="eyebrow">评测运行配置 (Eval Run Configuration)</span><h2>创建真实批量评测</h2>{error && <div className="notice warning">{error}</div>}<div className="run-form-grid">
    <label>数据集 (Dataset)<ThemedSelect value={form.datasetId} onChange={(event) => setForm({ ...form, datasetId: event.target.value })}>{datasets.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.caseCount} cases</option>)}</ThemedSelect></label>
    <label>模型服务商 (Model Provider)<ThemedSelect value={form.modelProviderId} onChange={(event) => { const provider = providers.find((item) => item.id === event.target.value); setForm({ ...form, modelProviderId: event.target.value, ...providerEvalDefaults(provider) }); }}>{providers.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.defaultModel}</option>)}</ThemedSelect></label>
    <label>Prompt 版本<input value={form.promptVersion} onChange={(event) => setForm({ ...form, promptVersion: event.target.value })} /></label>
    <label>发布门禁 (Release Gate)<ThemedSelect value={form.releaseGateId} onChange={(event) => setForm({ ...form, releaseGateId: event.target.value })}><option value="">运行后手动执行</option>{gates.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</ThemedSelect></label>
    <label>最大并发数<input type="number" min="1" max={remoteProvider ? 1 : 5} disabled={remoteProvider} value={form.maxParallel} onChange={(event) => setForm({ ...form, maxParallel: Number(event.target.value) })} /></label>
    <label>超时时间 / 秒<input type="number" min="1" max="900" value={form.timeoutSeconds} onChange={(event) => setForm({ ...form, timeoutSeconds: Number(event.target.value) })} /></label>
    <label>失败重试次数<input type="number" min="0" max="3" value={form.retryCount} onChange={(event) => setForm({ ...form, retryCount: Number(event.target.value) })} /></label>
    <label className="check-field"><input type="checkbox" checked={form.enableLlmJudge} onChange={(event) => setForm({ ...form, enableLlmJudge: event.target.checked })} /><span><b>LLM-as-Judge</b>对内容质量执行 1-5 分结构化评分</span></label>
  </div>{remoteProvider && <div className="notice">远程 OpenAI-compatible Provider 会在后端强制串行执行，并至少重试 2 次，避免批量 Eval 触发 503。</div>}<div className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" disabled={!form.datasetId || !form.modelProviderId} onClick={() => void submit()}><Beaker size={14} />开始评测</button></div></div></div>;
}

function providerEvalDefaults(provider?: ModelProviderOption) {
  return provider?.providerType === 'openai-compatible'
    ? { maxParallel: 1, retryCount: 2 }
    : { maxParallel: 2, retryCount: 0 };
}

function parseEvalTab(value: string | null): EvalTab {
  return value === 'cases' || value === 'runs' ? value : 'datasets';
}
