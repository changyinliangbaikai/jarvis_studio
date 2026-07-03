import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { Beaker, FileText, Grid3X3, Play, Plus } from 'lucide-react';
import { api, download, post } from '../api.ts';
import { Empty, JsonView, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatDate, formatDuration, formatNumber } from '../utils/format.ts';

interface Dataset { id: string; name: string; version: string }
interface Experiment {
  id: string;
  name: string;
  evalSetId: string;
  matrix: Record<string, string[]>;
  status: string;
  createdAt: string;
  updatedAt: string;
  results?: Array<{ id: string; runId: string; variant: Record<string, string | number | undefined>; metrics: Record<string, number | string> }>;
}

export function ExperimentsPage() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({
    name: t('pages.experiments.string_18'),
    evalSetId: '',
    modelProviderIds: 'builtin-deterministic',
    modelNames: 'deterministic-local',
    promptVersions: 'base-agent@v0.4',
    skillVersions: '',
    contextStrategies: 'balanced-v1',
    toolPolicies: 'default-local-policy@0.4.0'
  });
  const load = useCallback(async (signal: AbortSignal) => {
    const [experiments, datasets] = await Promise.all([api<Experiment[]>('/api/experiments', { signal }), api<Dataset[]>('/api/eval/datasets', { signal })]);
    return { experiments, datasets };
  }, []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['experiments-page'] });
  const experiments = resource.data?.experiments;
  const datasets = resource.data?.datasets ?? [];
  const summaryActive = useMemo(() => experiments?.find((item) => item.id === selectedId) ?? experiments?.[0], [experiments, selectedId]);
  const loadDetail = useCallback((signal: AbortSignal) => summaryActive ? api<Experiment>(`/api/experiments/${summaryActive.id}`, { signal }) : Promise.resolve(undefined), [summaryActive?.id]);
  const detailResource = useAsyncResource<Experiment | undefined>(loadDetail, [summaryActive?.id], Boolean(summaryActive?.id), { queryKey: ['experiment-detail', summaryActive?.id] });
  const active = detailResource.data ?? summaryActive;
  const bestResult = useMemo(() => active?.results?.slice().sort((left, right) =>
    metricNumber(right.metrics.successRate) - metricNumber(left.metrics.successRate)
      || metricNumber(right.metrics.avgScore) - metricNumber(left.metrics.avgScore)
      || metricNumber(left.metrics.avgCost, Number.POSITIVE_INFINITY) - metricNumber(right.metrics.avgCost, Number.POSITIVE_INFINITY)
  )[0], [active?.results]);
  useEffect(() => {
    const data = resource.data;
    if (!data) return;
    setForm((current) => ({ ...current, evalSetId: current.evalSetId || data.datasets[0]?.id || '' }));
    setSelectedId((current) => current || data.experiments[0]?.id || '');
  }, [resource.data]);

  const create = async () => {
    const created = await post<Experiment>('/api/experiments', {
      name: form.name,
      evalSetId: form.evalSetId,
      matrix: {
        modelProviderIds: split(form.modelProviderIds),
        modelNames: split(form.modelNames),
        promptVersions: split(form.promptVersions),
        skillVersions: split(form.skillVersions),
        contextStrategies: split(form.contextStrategies),
        toolPolicies: split(form.toolPolicies)
      }
    });
    await resource.reload();
    setSelectedId(created.id);
  };
  const run = async () => {
    if (!active) return;
    await post<Experiment>(`/api/experiments/${active.id}/run`, {});
    await resource.reload();
    await detailResource.reload();
  };
  if (!experiments) return <Loading />;
  return <section>
    <PageHeader eyebrow="V0.4 / Experiment Matrix" title={t('pages.experiments.string_1')} description={t('pages.experiments.string_2')}
      actions={<button className="primary" onClick={() => void create()}><Plus size={15} />{t('pages.experiments.string_4')}</button>} />
    {(resource.error || detailResource.error) && <div className="notice warning">{resource.error || detailResource.error}</div>}
    <div className="metric-grid compact">
      <Metric label="EXPERIMENTS" value={experiments.length} tone="cyan" />
      <Metric label="EVAL RUNS" value={experiments.reduce((sum, item) => sum + Number(item.results?.length ?? 0), 0)} />
      <Metric label="SUCCESS RATE" value={`${(metricNumber(active?.results?.[0]?.metrics?.successRate) * 100).toFixed(0)}%`} tone="green" />
      <Metric label="AVG SCORE" value={formatNumber(active?.results?.[0]?.metrics?.avgScore ?? 0)} />
      <Metric label="STATUS" value={active?.status ?? 'created'} />
    </div>
    <div className="experiment-layout">
      <div className="panel experiment-builder">
        <div className="panel-title"><Grid3X3 size={15} />{t('pages.experiments.string_5')}</div>
        <label>{t('pages.experiments.string_6')}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label>Eval Set<ThemedSelect value={form.evalSetId} onChange={(event) => setForm({ ...form, evalSetId: event.target.value })}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.version}</option>)}</ThemedSelect></label>
        <label>Provider IDs<textarea rows={2} value={form.modelProviderIds} onChange={(event) => setForm({ ...form, modelProviderIds: event.target.value })} /></label>
        <label>Model Names<textarea rows={2} value={form.modelNames} onChange={(event) => setForm({ ...form, modelNames: event.target.value })} /></label>
        <label>Prompt Versions<textarea rows={2} value={form.promptVersions} onChange={(event) => setForm({ ...form, promptVersions: event.target.value })} /></label>
        <label>Skill Versions<textarea rows={2} placeholder={t('pages.experiments.string_3')} value={form.skillVersions} onChange={(event) => setForm({ ...form, skillVersions: event.target.value })} /></label>
        <label>Context Strategies<textarea rows={2} value={form.contextStrategies} onChange={(event) => setForm({ ...form, contextStrategies: event.target.value })} /></label>
        <label>Tool Policies<textarea rows={2} value={form.toolPolicies} onChange={(event) => setForm({ ...form, toolPolicies: event.target.value })} /></label>
      </div>
      <div className="panel registry-list experiment-list">
        <div className="panel-title"><Beaker size={15} />{t('pages.experiments.string_7')}<span>{experiments.length}</span></div>
        {experiments.length === 0 ? <Empty>{t('pages.experiments.string_8')}</Empty> : experiments.map((experiment) => <button key={experiment.id} className={active?.id === experiment.id ? 'active' : ''} onClick={() => setSelectedId(experiment.id)}>
          <StatusBadge status={experiment.status} />
          <div><strong>{experiment.name}</strong><span>{experiment.evalSetId} · {formatDate(experiment.updatedAt)}</span><p>{JSON.stringify(experiment.matrix)}</p></div>
          <aside><b>{experiment.results?.length ?? 0}</b><span>variants</span></aside>
        </button>)}
      </div>
    </div>
    {active && <div className="panel experiment-results">
      <div className="panel-title"><FileText size={15} />{t('pages.experiments.string_9')}<span>{active.id}</span></div>
      <div className="provider-actions"><button className="primary" onClick={() => void run()}><Play size={14} />{t('pages.experiments.string_10')}</button><button className="primary-link" onClick={() => void download(`/api/experiments/${active.id}/report`, `${active.id}.md`)}><FileText size={14} />{t('pages.experiments.string_11')}</button></div>
      {bestResult && <div className="best-variant">
        <span>{t('pages.experiments.string_12')}</span>
        <strong>{bestResult.variant.modelName ?? bestResult.variant.modelProviderId ?? '—'}</strong>
        <p>{bestResult.variant.promptVersion ?? '—'} · {bestResult.variant.skillVersion ?? 'case-defined'} · {bestResult.variant.contextStrategy ?? '—'} · {bestResult.variant.toolPolicy ?? '—'}</p>
        <b>{(metricNumber(bestResult.metrics.successRate) * 100).toFixed(1)}% / {formatNumber(bestResult.metrics.avgScore ?? 0)}</b>
      </div>}
      {!active.results?.length ? <Empty>{t('pages.experiments.string_13')}</Empty> : <table><thead><tr><th>Model</th><th>Prompt</th><th>Skill</th><th>Context</th><th>Tool Policy</th><th>Run</th><th>{t('pages.experiments.string_14')}</th><th>{t('pages.experiments.string_15')}</th><th>{t('pages.experiments.string_16')}</th><th>Token</th><th>{t('pages.experiments.string_17')}</th></tr></thead><tbody>
        {active.results.map((result) => <tr key={result.id}><td>{result.variant.modelName ?? result.variant.modelProviderId ?? '—'}</td><td>{result.variant.promptVersion ?? '—'}</td><td>{result.variant.skillVersion ?? 'case-defined'}</td><td>{result.variant.contextStrategy ?? '—'}</td><td>{result.variant.toolPolicy ?? '—'}</td><td>{result.runId}</td><td>{(metricNumber(result.metrics.successRate) * 100).toFixed(1)}%</td><td>{formatNumber(result.metrics.avgScore ?? 0)}</td><td>{formatDuration(result.metrics.avgLatencyMs ?? 0)}</td><td>{formatNumber(result.metrics.avgTotalTokens ?? 0)}</td><td>{formatNumber(result.metrics.avgCost ?? 0)}</td></tr>)}
      </tbody></table>}
      <details><summary>Matrix JSON</summary><JsonView value={active.matrix} /></details>
    </div>}
  </section>;
}

function split(value: string) {
  return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function metricNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
