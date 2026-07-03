import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { Beaker, Boxes, DatabaseZap, FileInput, Filter, FlaskConical, Play, RefreshCcw, Rows3 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import type { EvalCase, EvalDataset, EvalRun, ModelProviderOption, ReleaseGate } from '../evalTypes.ts';
import { formatDate, formatDuration, formatNumber } from '../utils/format.ts';
import { useTranslation } from 'react-i18next';

type EvalTab = 'datasets' | 'cases' | 'runs';

export function EvalBenchPage() {
  const { t } = useTranslation();
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
    <PageHeader eyebrow={t('pages.evalBench.string_1')} title={t('pages.evalBench.string_2')} description={t('pages.evalBench.string_3')}
      actions={<button onClick={() => void resource.reload()}><RefreshCcw size={15} />{t('pages.evalBench.string_7')}</button>} />
    <div className="notice warning">{resource.error}</div>
  </section>;

  const latest = runs[0];
  return <section>
    <PageHeader eyebrow={t('pages.evalBench.string_1')} title={t('pages.evalBench.string_2')} description={t('pages.evalBench.string_3')}
      actions={<><button onClick={() => setShowImport(true)}><FileInput size={15} />{t('pages.evalBench.string_8')}</button><button className="primary" onClick={() => setShowRun(true)}><Play size={15} />{t('pages.evalBench.string_9')}</button></>} />
    {resource.error && <div className="notice warning">{resource.error}</div>}
    {notice && <div className="notice">{notice}</div>}
    <div className="metric-grid">
      <Metric label="DATASETS" value={datasets.length} tone="cyan" />
      <Metric label="VERSIONED CASES" value={cases.length} />
      <Metric label="EVAL RUNS" value={runs.length} />
      <Metric label="LATEST PASS RATE" value={latest ? `${(latest.passRate * 100).toFixed(0)}%` : '—'} tone={Number(latest?.passRate ?? 0) >= .85 ? 'green' : 'amber'} />
    </div>
    <div className="eval-tabs">
      <button className={tab === 'datasets' ? 'active' : ''} onClick={() => setView({ tab: 'datasets' })}><DatabaseZap size={14} />{t('pages.evalBench.string_10')}</button>
      <button className={tab === 'cases' ? 'active' : ''} onClick={() => setView({ tab: 'cases' })}><Rows3 size={14} />{t('pages.evalBench.string_11')}</button>
      <button className={tab === 'runs' ? 'active' : ''} onClick={() => setView({ tab: 'runs' })}><FlaskConical size={14} />{t('pages.evalBench.string_12')}</button>
    </div>
    {tab === 'datasets' && <DatasetGrid datasets={datasets} onReload={async (id) => { await post(`/api/eval/datasets/${id}/reload`, {}); setNotice(t('pages.evalBench.string_52', { id })); await resource.reload(); }} onCases={(id) => setView({ tab: 'cases', datasetId: id })} onRun={(id) => { setView({ tab: 'cases', datasetId: id }); setShowRun(true); }} />}
    {tab === 'cases' && <CasesTable cases={filteredCases} datasets={datasets} datasetFilter={datasetFilter} priorityFilter={priorityFilter} onDataset={(value) => setView({ tab: 'cases', datasetId: value })} onPriority={(value) => setView({ tab: 'cases', priority: value })} />}
    {tab === 'runs' && <RunsTable runs={runs} />}
    {showImport && <ImportDatasetModal onClose={() => setShowImport(false)} onDone={async () => { setShowImport(false); setNotice(t('pages.evalBench.string_53')); await resource.reload(); }} />}
    {showRun && <CreateRunModal datasets={datasets} providers={providers.filter((item) => item.enabled)} gates={gates} preferredDataset={datasetFilter} onClose={() => setShowRun(false)}
      onDone={async (count) => { setShowRun(false); setView({ tab: 'runs' }); setNotice(t('pages.evalBench.string_54', { count })); await resource.reload(); }} />}
  </section>;
}

function DatasetGrid({ datasets, onReload, onCases, onRun }: { datasets: EvalDataset[]; onReload: (id: string) => void; onCases: (id: string) => void; onRun: (id: string) => void }) {
  const { t } = useTranslation();
  return <div className="dataset-grid">{datasets.map((item) => <article className="dataset-card" key={item.id}>
    <div className="dataset-index"><Boxes size={18} /><span>{item.category}</span><b>{item.version}</b></div>
    <h2>{item.name}</h2><code>{item.id}</code><p>{item.description}</p>
    <div className="dataset-stats"><span>{t('pages.evalBench.string_13')}<b>{item.caseCount}</b></span><span>{t('pages.evalBench.string_14')}<b>{item.latestRun ? `${(item.latestRun.passRate * 100).toFixed(0)}%` : '—'}</b></span><span>{t('pages.evalBench.string_15')}<b>{item.latestRun?.avgScore?.toFixed(2) ?? '—'}</b></span></div>
    <footer><span>{item.releaseGateId ?? t('pages.evalBench.string_55')}</span><button onClick={() => onReload(item.id)}><RefreshCcw size={13} /></button><button onClick={() => onCases(item.id)}>{t('pages.evalBench.string_16')}</button><button className="primary" onClick={() => onRun(item.id)}><Play size={13} />{t('pages.evalBench.string_17')}</button></footer>
  </article>)}</div>;
}

function CasesTable({ cases, datasets, datasetFilter, priorityFilter, onDataset, onPriority }: { cases: EvalCase[]; datasets: EvalDataset[]; datasetFilter: string; priorityFilter: string; onDataset: (value: string) => void; onPriority: (value: string) => void }) {
  const { t } = useTranslation();
  const backParams = new URLSearchParams({ tab: 'cases' });
  if (datasetFilter) backParams.set('datasetId', datasetFilter);
  if (priorityFilter) backParams.set('priority', priorityFilter);
  const caseListPath = `/evals?${backParams.toString()}`;
  return <><div className="filter-strip panel"><Filter size={14} /><span className="flow-label">{t('pages.evalBench.string_18')}</span><ThemedSelect value={datasetFilter} onChange={(event) => onDataset(event.target.value)}><option value="">{t('pages.evalBench.string_19')}</option>{datasets.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</ThemedSelect><ThemedSelect value={priorityFilter} onChange={(event) => onPriority(event.target.value)}><option value="">{t('pages.evalBench.string_20')}</option>{['p0', 'p1', 'p2', 'p3'].map((item) => <option value={item} key={item}>{item.toUpperCase()}</option>)}</ThemedSelect><span>{cases.length} {t('pages.evalBench.string_21')}</span></div>
    <div className="table-wrap"><table><thead><tr><th>{t('pages.evalBench.string_21')}</th><th>{t('pages.evalBench.string_22')}</th><th>{t('pages.evalBench.string_23')}</th><th>{t('pages.evalBench.string_24')}</th><th>{t('pages.evalBench.string_25')}</th><th>{t('pages.evalBench.string_26')}</th><th>{t('pages.evalBench.string_27')}</th></tr></thead><tbody>{cases.map((item) => <tr key={item.id}><td className="run-name"><Link to={`/evals/cases/${item.id}`} state={{ from: caseListPath }}><strong>{item.name}</strong><span>{item.id} · {item.tags.join(' / ')}</span></Link></td><td>{item.datasetId}</td><td><StatusBadge status={item.priority} /></td><td>{item.category}</td><td>{item.latestResult ? <StatusBadge status={item.latestResult.passed ? 'success' : item.latestResult.status} /> : '—'}</td><td className="score">{item.latestResult?.score.toFixed(2) ?? '—'}</td><td>{item.latestResult?.issueTags.join(', ') || '—'}</td></tr>)}</tbody></table></div></>;
}

function RunsTable({ runs }: { runs: EvalRun[] }) {
  const { t } = useTranslation();
  if (!runs.length) return <Empty>{t('pages.evalBench.string_28')}</Empty>;
  return <div className="table-wrap"><table><thead><tr><th>{t('pages.evalBench.string_29')}</th><th>{t('pages.evalBench.string_30')}</th><th>{t('common.status')}</th><th>{t('pages.evalBench.string_31')}</th><th>{t('pages.evalBench.string_32')}</th><th>{t('pages.evalBench.string_33')}</th><th>{t('pages.evalBench.string_34')}</th><th>{t('pages.evalBench.string_35')}</th></tr></thead><tbody>{runs.map((item) => <tr key={item.id}>
    <td className="run-name"><Link to={`/evals/runs/${item.id}`}><strong>{item.name}</strong><span>{item.id}</span></Link></td>
    <td className="binding"><span>{item.datasetName}</span><b>{item.modelName}</b></td><td><StatusBadge status={item.status} /></td>
    <td className="score">{(item.passRate * 100).toFixed(0)}% <small>{item.passedCases}/{item.totalCases}</small></td><td className="score">{item.avgScore.toFixed(2)}</td>
    <td>{formatDuration(item.avgLatencyMs)}</td><td>{formatNumber(item.avgTotalTokens)} / {item.totalCost.toFixed(5)} {item.currency}</td><td>{formatDate(item.createdAt)}</td>
  </tr>)}</tbody></table></div>;
}

function ImportDatasetModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [dataset, setDataset] = useState('id: custom_dataset_v1\nname: Custom Dataset\nversion: 1.0.0\ncategory: regression\ndescription: Custom eval dataset\nowner: jarvis\n');
  const [cases, setCases] = useState('id: custom_001\nname: Custom case\ncategory: general\npriority: p1\ninput: { message: "执行测试", files: [] }\nexpected: { must_call_tools: [], must_include: [] }\nscoring: { max_score: 5 }\npass_criteria: { min_total_score: 4 }\n');
  const [error, setError] = useState('');
  const submit = async () => { try { await post('/api/eval/datasets/import', { content: dataset, cases: [cases] }); onDone(); } catch (caught) { setError(caught instanceof Error ? caught.message : t('pages.evalBench.string_57')); } };
  return <div className="modal-backdrop" onClick={onClose}><div className="modal eval-import-modal" onClick={(event) => event.stopPropagation()}><span className="eyebrow">Dataset + Case YAML</span><h2>{t('pages.evalBench.string_36')}</h2>{error && <div className="notice warning">{error}</div>}<div className="yaml-pair"><label>dataset.yaml<textarea rows={13} value={dataset} onChange={(event) => setDataset(event.target.value)} /></label><label>case yaml<textarea rows={13} value={cases} onChange={(event) => setCases(event.target.value)} /></label></div><div className="modal-actions"><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" onClick={() => void submit()}>{t('pages.evalBench.string_37')}</button></div></div></div>;
}

function CreateRunModal({ datasets, providers, gates, preferredDataset, onClose, onDone }: { datasets: EvalDataset[]; providers: ModelProviderOption[]; gates: ReleaseGate[]; preferredDataset: string; onClose: () => void; onDone: (count: number) => void }) {
  const { t } = useTranslation();
  const initialProvider = providers.find((item) => item.isDefault) ?? providers[0];
  const initialDefaults = providerEvalDefaults(initialProvider);
  const [form, setForm] = useState({ datasetId: preferredDataset || datasets[0]?.id || '', modelProviderId: initialProvider?.id || '', promptVersion: 'base-agent@v0.3', maxParallel: initialDefaults.maxParallel, retryCount: initialDefaults.retryCount, timeoutSeconds: 120, enableLlmJudge: false, releaseGateId: gates[0]?.id || '' });
  const [error, setError] = useState('');
  const selectedProvider = providers.find((item) => item.id === form.modelProviderId);
  const remoteProvider = selectedProvider?.providerType === 'openai-compatible';
  const submit = async () => { try { const result = await post<{ runs: EvalRun[] }>('/api/eval/runs', form); onDone(result.runs.length); } catch (caught) { setError(caught instanceof Error ? caught.message : t('pages.evalBench.string_58')); } };
  return <div className="modal-backdrop" onClick={onClose}><div className="modal run-create-modal" onClick={(event) => event.stopPropagation()}><span className="eyebrow">{t('pages.evalBench.string_38')}</span><h2>{t('pages.evalBench.string_39')}</h2>{error && <div className="notice warning">{error}</div>}<div className="run-form-grid">
    <label>{t('pages.evalBench.string_40')}<ThemedSelect value={form.datasetId} onChange={(event) => setForm({ ...form, datasetId: event.target.value })}>{datasets.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.caseCount} cases</option>)}</ThemedSelect></label>
    <label>{t('pages.evalBench.string_41')}<ThemedSelect value={form.modelProviderId} onChange={(event) => { const provider = providers.find((item) => item.id === event.target.value); setForm({ ...form, modelProviderId: event.target.value, ...providerEvalDefaults(provider) }); }}>{providers.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.defaultModel}</option>)}</ThemedSelect></label>
    <label>{t('pages.evalBench.string_42')}<input value={form.promptVersion} onChange={(event) => setForm({ ...form, promptVersion: event.target.value })} /></label>
    <label>{t('pages.evalBench.string_43')}<ThemedSelect value={form.releaseGateId} onChange={(event) => setForm({ ...form, releaseGateId: event.target.value })}><option value="">{t('pages.evalBench.string_44')}</option>{gates.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</ThemedSelect></label>
    <label>{t('pages.evalBench.string_45')}<input type="number" min="1" max={remoteProvider ? 1 : 5} disabled={remoteProvider} value={form.maxParallel} onChange={(event) => setForm({ ...form, maxParallel: Number(event.target.value) })} /></label>
    <label>{t('pages.evalBench.string_46')}<input type="number" min="1" max="900" value={form.timeoutSeconds} onChange={(event) => setForm({ ...form, timeoutSeconds: Number(event.target.value) })} /></label>
    <label>{t('pages.evalBench.string_47')}<input type="number" min="0" max="3" value={form.retryCount} onChange={(event) => setForm({ ...form, retryCount: Number(event.target.value) })} /></label>
    <label className="check-field"><input type="checkbox" checked={form.enableLlmJudge} onChange={(event) => setForm({ ...form, enableLlmJudge: event.target.checked })} /><span><b>LLM-as-Judge</b>{t('pages.evalBench.string_48')}</span></label>
  </div>{remoteProvider && <div className="notice">{t('pages.evalBench.string_49')}</div>}<div className="modal-actions"><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" disabled={!form.datasetId || !form.modelProviderId} onClick={() => void submit()}><Beaker size={14} />{t('pages.evalBench.string_50')}</button></div></div></div>;
}

function providerEvalDefaults(provider?: ModelProviderOption) {
  return provider?.providerType === 'openai-compatible'
    ? { maxParallel: 1, retryCount: 2 }
    : { maxParallel: 2, retryCount: 0 };
}

function parseEvalTab(value: string | null): EvalTab {
  return value === 'cases' || value === 'runs' ? value : 'datasets';
}
