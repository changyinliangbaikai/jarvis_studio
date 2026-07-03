import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { FileInput, ShieldCheck, ShieldX } from 'lucide-react';
import { api, post } from '../api.ts';
import { Empty, JsonView, Loading, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatDate } from '../utils/format.ts';
import type { EvalRun, GateResult, ReleaseGate } from '../evalTypes.ts';

export function ReleaseGatesPage() {
  const { t } = useTranslation();
  const [selectedRun, setSelectedRun] = useState('');
  const [yaml, setYaml] = useState('');
  const [showImport, setShowImport] = useState(false);
  const load = useCallback(async (signal: AbortSignal) => {
    const [gates, runs, results] = await Promise.all([api<ReleaseGate[]>('/api/release-gates', { signal }), api<EvalRun[]>('/api/eval/runs', { signal }), api<GateResult[]>('/api/release-gates/results', { signal })]);
    return { gates, runs: runs.filter((item) => item.status === 'completed'), results };
  }, []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['release-gates'] });
  const gates = resource.data?.gates ?? [];
  const runs = resource.data?.runs ?? [];
  const results = resource.data?.results ?? [];
  useEffect(() => {
    setSelectedRun((current) => current || runs[0]?.id || '');
  }, [runs]);
  if (!resource.data) return <Loading />;
  return <section><PageHeader eyebrow={t('pages.releaseGates.string_1')} title={t('pages.releaseGates.string_2')} description={t('pages.releaseGates.string_3')} actions={<button onClick={() => setShowImport(true)}><FileInput size={14} />{t('pages.releaseGates.string_4')}</button>} />
    {resource.error && <div className="notice warning">{resource.error}</div>}
    <div className="gate-registry">{gates.map((gate) => <article className="panel gate-policy" key={gate.id}><div className="panel-title"><ShieldCheck size={14} />{gate.name}<span>{gate.version}</span></div><code>{gate.id}</code><JsonView value={gate.criteria} /><div className="gate-evaluate"><ThemedSelect value={selectedRun} onChange={(event) => setSelectedRun(event.target.value)}><option value="">{t('pages.releaseGates.string_5')}</option>{runs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</ThemedSelect><button className="primary" disabled={!selectedRun} onClick={() => void post(`/api/release-gates/${gate.id}/evaluate`, { evalRunId: selectedRun }).then(() => resource.reload())}>{t('pages.releaseGates.string_6')}</button></div></article>)}</div>
    <div className="section-bar"><div>{t('pages.releaseGates.string_7')}</div><span>{results.length}</span></div>{results.length ? <div className="table-wrap"><table><thead><tr><th>Gate</th><th>Eval Run</th><th>{t('pages.releaseGates.string_8')}</th><th>{t('pages.releaseGates.string_9')}</th><th>{t('pages.releaseGates.string_10')}</th></tr></thead><tbody>{results.map((item) => <tr key={item.id}><td className="run-name"><strong>{item.gateName}</strong><span>{item.gateId}</span></td><td>{item.evalRunId}</td><td>{item.passed ? <StatusBadge status="success" /> : <StatusBadge status="failed" />}</td><td>{item.failedCriteria.map((check) => check.label).join(', ') || '—'}</td><td>{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div> : <Empty>{t('pages.releaseGates.string_11')}</Empty>}
    {showImport && <div className="modal-backdrop" onClick={() => setShowImport(false)}><div className="modal" onClick={(event) => event.stopPropagation()}><span className="eyebrow">Release Gate YAML</span><h2>{t('pages.releaseGates.string_12')}</h2><textarea rows={18} value={yaml} onChange={(event) => setYaml(event.target.value)} placeholder="id: release_gate_v1&#10;name: ...&#10;criteria: ..." /><div className="modal-actions"><button onClick={() => setShowImport(false)}>{t('common.cancel')}</button><button className="primary" disabled={!yaml.trim()} onClick={() => void post('/api/release-gates/import', { content: yaml }).then(() => { setShowImport(false); setYaml(''); return resource.reload(); })}>{t('pages.releaseGates.string_13')}</button></div></div></div>}
  </section>;
}
