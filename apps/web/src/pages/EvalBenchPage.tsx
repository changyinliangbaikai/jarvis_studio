import { useEffect, useMemo, useState } from 'react';
import { Beaker, Boxes, DatabaseZap, FileInput, Filter, FlaskConical, Play, RefreshCcw, Rows3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, formatDate, formatDuration, formatNumber, post } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import type { EvalCase, EvalDataset, EvalRun, ModelProviderOption, ReleaseGate } from '../evalTypes.ts';

export function EvalBenchPage() {
  const [tab, setTab] = useState<'datasets' | 'cases' | 'runs'>('datasets');
  const [datasets, setDatasets] = useState<EvalDataset[]>();
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [providers, setProviders] = useState<ModelProviderOption[]>([]);
  const [gates, setGates] = useState<ReleaseGate[]>([]);
  const [datasetFilter, setDatasetFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showRun, setShowRun] = useState(false);
  const [notice, setNotice] = useState('');

  const load = async () => {
    const [datasetItems, caseItems, runItems, providerItems, gateItems] = await Promise.all([
      api<EvalDataset[]>('/api/eval/datasets'), api<EvalCase[]>('/api/eval/cases'),
      api<EvalRun[]>('/api/eval/runs'), api<ModelProviderOption[]>('/api/model-providers'),
      api<ReleaseGate[]>('/api/release-gates')
    ]);
    setDatasets(datasetItems); setCases(caseItems); setRuns(runItems); setProviders(providerItems); setGates(gateItems);
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!runs.some((item) => ['created', 'running', 'scoring'].includes(item.status))) return;
    const timer = window.setInterval(() => void load(), 1200);
    return () => window.clearInterval(timer);
  }, [runs]);
  const filteredCases = useMemo(() => cases.filter((item) =>
    (!datasetFilter || item.datasetId === datasetFilter) && (!priorityFilter || item.priority === priorityFilter)), [cases, datasetFilter, priorityFilter]);
  if (!datasets) return <Loading />;
  const latest = runs[0];
  return <section>
    <PageHeader eyebrow="07 / EVAL BENCH 2.0" title="Quality Assurance Range" description="用版本化 Dataset 持续执行真实 Runtime，聚合规则、Judge、人工评分，并形成发布证据。"
      actions={<><button onClick={() => setShowImport(true)}><FileInput size={15} />导入 Dataset</button><button className="primary" onClick={() => setShowRun(true)}><Play size={15} />创建 Eval Run</button></>} />
    {notice && <div className="notice">{notice}</div>}
    <div className="metric-grid">
      <Metric label="DATASETS" value={datasets.length} tone="cyan" />
      <Metric label="VERSIONED CASES" value={cases.length} />
      <Metric label="EVAL RUNS" value={runs.length} />
      <Metric label="LATEST PASS RATE" value={latest ? `${(latest.passRate * 100).toFixed(0)}%` : '—'} tone={Number(latest?.passRate ?? 0) >= .85 ? 'green' : 'amber'} />
    </div>
    <div className="eval-tabs">
      <button className={tab === 'datasets' ? 'active' : ''} onClick={() => setTab('datasets')}><DatabaseZap size={14} />Datasets</button>
      <button className={tab === 'cases' ? 'active' : ''} onClick={() => setTab('cases')}><Rows3 size={14} />Cases</button>
      <button className={tab === 'runs' ? 'active' : ''} onClick={() => setTab('runs')}><FlaskConical size={14} />Eval Runs</button>
    </div>
    {tab === 'datasets' && <DatasetGrid datasets={datasets} onReload={async (id) => { await post(`/api/eval/datasets/${id}/reload`, {}); setNotice(`Dataset ${id} 已重新加载。`); await load(); }} onCases={(id) => { setDatasetFilter(id); setTab('cases'); }} onRun={(id) => { setDatasetFilter(id); setShowRun(true); }} />}
    {tab === 'cases' && <CasesTable cases={filteredCases} datasets={datasets} datasetFilter={datasetFilter} priorityFilter={priorityFilter} onDataset={setDatasetFilter} onPriority={setPriorityFilter} />}
    {tab === 'runs' && <RunsTable runs={runs} />}
    {showImport && <ImportDatasetModal onClose={() => setShowImport(false)} onDone={async () => { setShowImport(false); setNotice('Dataset 已导入并完成 schema 校验。'); await load(); }} />}
    {showRun && <CreateRunModal datasets={datasets} providers={providers.filter((item) => item.enabled)} gates={gates} preferredDataset={datasetFilter} onClose={() => setShowRun(false)}
      onDone={async (count) => { setShowRun(false); setTab('runs'); setNotice(`已创建 ${count} 个 Eval Run，后台开始执行。`); await load(); }} />}
  </section>;
}

function DatasetGrid({ datasets, onReload, onCases, onRun }: { datasets: EvalDataset[]; onReload: (id: string) => void; onCases: (id: string) => void; onRun: (id: string) => void }) {
  return <div className="dataset-grid">{datasets.map((item) => <article className="dataset-card" key={item.id}>
    <div className="dataset-index"><Boxes size={18} /><span>{item.category}</span><b>{item.version}</b></div>
    <h2>{item.name}</h2><code>{item.id}</code><p>{item.description}</p>
    <div className="dataset-stats"><span>CASES<b>{item.caseCount}</b></span><span>LAST PASS<b>{item.latestRun ? `${(item.latestRun.passRate * 100).toFixed(0)}%` : '—'}</b></span><span>AVG SCORE<b>{item.latestRun?.avgScore?.toFixed(2) ?? '—'}</b></span></div>
    <footer><span>{item.releaseGateId ?? 'no gate bound'}</span><button onClick={() => onReload(item.id)}><RefreshCcw size={13} /></button><button onClick={() => onCases(item.id)}>Cases</button><button className="primary" onClick={() => onRun(item.id)}><Play size={13} />运行</button></footer>
  </article>)}</div>;
}

function CasesTable({ cases, datasets, datasetFilter, priorityFilter, onDataset, onPriority }: { cases: EvalCase[]; datasets: EvalDataset[]; datasetFilter: string; priorityFilter: string; onDataset: (value: string) => void; onPriority: (value: string) => void }) {
  return <><div className="filter-strip panel"><Filter size={14} /><select value={datasetFilter} onChange={(event) => onDataset(event.target.value)}><option value="">全部 Dataset</option>{datasets.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={priorityFilter} onChange={(event) => onPriority(event.target.value)}><option value="">全部优先级</option>{['p0', 'p1', 'p2', 'p3'].map((item) => <option key={item}>{item}</option>)}</select><span>{cases.length} cases</span></div>
    <div className="table-wrap"><table><thead><tr><th>CASE</th><th>DATASET</th><th>PRIORITY</th><th>CATEGORY</th><th>LATEST</th><th>SCORE</th><th>FAILURE</th></tr></thead><tbody>{cases.map((item) => <tr key={item.id}><td className="run-name"><Link to={`/evals/cases/${item.id}`}><strong>{item.name}</strong><span>{item.id} · {item.tags.join(' / ')}</span></Link></td><td>{item.datasetId}</td><td><StatusBadge status={item.priority} /></td><td>{item.category}</td><td>{item.latestResult ? <StatusBadge status={item.latestResult.passed ? 'success' : item.latestResult.status} /> : '—'}</td><td className="score">{item.latestResult?.score.toFixed(2) ?? '—'}</td><td>{item.latestResult?.issueTags.join(', ') || '—'}</td></tr>)}</tbody></table></div></>;
}

function RunsTable({ runs }: { runs: EvalRun[] }) {
  if (!runs.length) return <Empty>尚未创建 Eval Run。</Empty>;
  return <div className="table-wrap"><table><thead><tr><th>EVAL RUN</th><th>DATASET / MODEL</th><th>STATUS</th><th>PASS RATE</th><th>SCORE</th><th>LATENCY</th><th>TOKENS / COST</th><th>CREATED</th></tr></thead><tbody>{runs.map((item) => <tr key={item.id}>
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
  return <div className="modal-backdrop" onClick={onClose}><div className="modal eval-import-modal" onClick={(event) => event.stopPropagation()}><span className="eyebrow">DATASET + CASE YAML</span><h2>导入版本化测试集</h2>{error && <div className="notice warning">{error}</div>}<div className="yaml-pair"><label>dataset.yaml<textarea rows={13} value={dataset} onChange={(event) => setDataset(event.target.value)} /></label><label>case yaml<textarea rows={13} value={cases} onChange={(event) => setCases(event.target.value)} /></label></div><div className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" onClick={() => void submit()}>校验并导入</button></div></div></div>;
}

function CreateRunModal({ datasets, providers, gates, preferredDataset, onClose, onDone }: { datasets: EvalDataset[]; providers: ModelProviderOption[]; gates: ReleaseGate[]; preferredDataset: string; onClose: () => void; onDone: (count: number) => void }) {
  const [form, setForm] = useState({ datasetId: preferredDataset || datasets[0]?.id || '', modelProviderId: providers[0]?.id || '', promptVersion: 'base-agent@v0.3', maxParallel: 2, retryCount: 0, timeoutSeconds: 120, enableLlmJudge: false, releaseGateId: gates[0]?.id || '' });
  const [error, setError] = useState('');
  const submit = async () => { try { const result = await post<{ runs: EvalRun[] }>('/api/eval/runs', form); onDone(result.runs.length); } catch (caught) { setError(caught instanceof Error ? caught.message : '创建失败'); } };
  return <div className="modal-backdrop" onClick={onClose}><div className="modal run-create-modal" onClick={(event) => event.stopPropagation()}><span className="eyebrow">EVAL RUN CONFIGURATION</span><h2>创建真实批量评测</h2>{error && <div className="notice warning">{error}</div>}<div className="run-form-grid">
    <label>DATASET<select value={form.datasetId} onChange={(event) => setForm({ ...form, datasetId: event.target.value })}>{datasets.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.caseCount} cases</option>)}</select></label>
    <label>MODEL PROVIDER<select value={form.modelProviderId} onChange={(event) => setForm({ ...form, modelProviderId: event.target.value })}>{providers.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.defaultModel}</option>)}</select></label>
    <label>PROMPT VERSION<input value={form.promptVersion} onChange={(event) => setForm({ ...form, promptVersion: event.target.value })} /></label>
    <label>RELEASE GATE<select value={form.releaseGateId} onChange={(event) => setForm({ ...form, releaseGateId: event.target.value })}><option value="">运行后手动执行</option>{gates.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <label>MAX PARALLEL<input type="number" min="1" max="5" value={form.maxParallel} onChange={(event) => setForm({ ...form, maxParallel: Number(event.target.value) })} /></label>
    <label>TIMEOUT SECONDS<input type="number" min="1" max="900" value={form.timeoutSeconds} onChange={(event) => setForm({ ...form, timeoutSeconds: Number(event.target.value) })} /></label>
    <label>RETRY COUNT<input type="number" min="0" max="3" value={form.retryCount} onChange={(event) => setForm({ ...form, retryCount: Number(event.target.value) })} /></label>
    <label className="check-field"><input type="checkbox" checked={form.enableLlmJudge} onChange={(event) => setForm({ ...form, enableLlmJudge: event.target.checked })} /><span><b>LLM-AS-JUDGE</b>对内容质量执行 1-5 分结构化评分</span></label>
  </div><div className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" disabled={!form.datasetId || !form.modelProviderId} onClick={() => void submit()}><Beaker size={14} />开始评测</button></div></div></div>;
}
