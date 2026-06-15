import { useEffect, useState } from 'react';
import { FileInput, ShieldCheck, ShieldX } from 'lucide-react';
import { api, formatDate, post } from '../api.ts';
import { Empty, JsonView, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import type { EvalRun, GateResult, ReleaseGate } from '../evalTypes.ts';

export function ReleaseGatesPage() {
  const [gates, setGates] = useState<ReleaseGate[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [results, setResults] = useState<GateResult[]>([]);
  const [selectedRun, setSelectedRun] = useState('');
  const [yaml, setYaml] = useState('');
  const [showImport, setShowImport] = useState(false);
  const load = async () => { const [a, b, c] = await Promise.all([api<ReleaseGate[]>('/api/release-gates'), api<EvalRun[]>('/api/eval/runs'), api<GateResult[]>('/api/release-gates/results')]); setGates(a); setRuns(b.filter((item) => item.status === 'completed')); setResults(c); setSelectedRun((current) => current || b.find((item) => item.status === 'completed')?.id || ''); };
  useEffect(() => { void load(); }, []);
  return <section><PageHeader eyebrow="09 / RELEASE GATES" title="Release Interlock" description="将可配置 YAML 策略应用到某次 Eval Run，输出可追溯的准入或阻断证据。" actions={<button onClick={() => setShowImport(true)}><FileInput size={14} />导入 Gate YAML</button>} />
    <div className="gate-registry">{gates.map((gate) => <article className="panel gate-policy" key={gate.id}><div className="panel-title"><ShieldCheck size={14} />{gate.name}<span>{gate.version}</span></div><code>{gate.id}</code><JsonView value={gate.criteria} /><div className="gate-evaluate"><select value={selectedRun} onChange={(event) => setSelectedRun(event.target.value)}><option value="">选择 Eval Run</option>{runs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button className="primary" disabled={!selectedRun} onClick={() => void post(`/api/release-gates/${gate.id}/evaluate`, { evalRunId: selectedRun }).then(load)}>执行 Gate</button></div></article>)}</div>
    <div className="section-bar"><div>GATE RESULTS</div><span>{results.length}</span></div>{results.length ? <div className="table-wrap"><table><thead><tr><th>GATE</th><th>EVAL RUN</th><th>DECISION</th><th>FAILED CRITERIA</th><th>CREATED</th></tr></thead><tbody>{results.map((item) => <tr key={item.id}><td className="run-name"><strong>{item.gateName}</strong><span>{item.gateId}</span></td><td>{item.evalRunId}</td><td>{item.passed ? <StatusBadge status="success" /> : <StatusBadge status="failed" />}</td><td>{item.failedCriteria.map((check) => check.label).join(', ') || '—'}</td><td>{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div> : <Empty>尚未执行 Release Gate。</Empty>}
    {showImport && <div className="modal-backdrop" onClick={() => setShowImport(false)}><div className="modal" onClick={(event) => event.stopPropagation()}><span className="eyebrow">RELEASE GATE YAML</span><h2>导入准入策略</h2><textarea rows={18} value={yaml} onChange={(event) => setYaml(event.target.value)} placeholder="id: release_gate_v1&#10;name: ...&#10;criteria: ..." /><div className="modal-actions"><button onClick={() => setShowImport(false)}>取消</button><button className="primary" disabled={!yaml.trim()} onClick={() => void post('/api/release-gates/import', { content: yaml }).then(() => { setShowImport(false); setYaml(''); return load(); })}>导入</button></div></div></div>}
  </section>;
}
