import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Bot, Braces, Cable, Cpu, FileSpreadsheet, Play, Radio, Server, TerminalSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, post } from '../api.ts';
import { JsonView, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';

interface Capability {
  version: string;
  workspacePath: string;
  providers: Array<{ id: string; label: string; provider: 'deterministic' | 'openai-compatible'; available: boolean; model: string; source: string; isDefault: boolean; lastTestStatus?: string }>;
  skills: Array<{ id: string; name: string; version: string; description: string; requiredTools: string[] }>;
}
interface TraceEvent { eventId: string; eventType: string; timestamp: string; runId?: string; payload: Record<string, unknown> }

export function RuntimePage() {
  const [capability, setCapability] = useState<Capability>();
  const [skill, setSkill] = useState('excel-data-analysis');
  const [providerId, setProviderId] = useState('builtin-deterministic');
  const [model, setModel] = useState('deterministic-local');
  const [message, setMessage] = useState('分析客户清单，识别异常并给出营销建议。');
  const [files, setFiles] = useState('input/customer_data.xlsx');
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [selected, setSelected] = useState<TraceEvent>();
  const [runId, setRunId] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Capability>('/api/runtime/capabilities').then((result) => {
      setCapability(result);
      const preferred = result.providers.find((item) => item.isDefault) ?? result.providers[0];
      if (preferred) {
        setProviderId(preferred.id);
        setModel(preferred.model);
      }
    });
  }, []);
  const currentSkill = capability?.skills.find((item) => item.id === skill);
  const currentProvider = capability?.providers.find((item) => item.id === providerId);
  const toolNames = useMemo(() => events.filter((event) => event.eventType === 'tool.call').map((event) => String(event.payload.tool)), [events]);
  const contextCount = events.filter((event) => event.eventType === 'context.build').length;
  const start = async () => {
    setEvents([]); setSelected(undefined); setRunId(''); setRunning(true); setError('');
    try {
      const created = await post<{ runId: string; eventsUrl: string }>('/api/runtime/runs', {
        name: `Studio · ${currentSkill?.name ?? skill}`, message, skill, providerId, model,
        files: files.split('\n').map((file) => file.trim()).filter(Boolean)
      });
      setRunId(created.runId);
      const source = new EventSource(created.eventsUrl);
      source.onmessage = (event) => {
        const trace = JSON.parse(event.data) as TraceEvent;
        setEvents((items) => items.some((item) => item.eventId === trace.eventId) ? items : [...items, trace]);
        setSelected((item) => item ?? trace);
      };
      source.addEventListener('complete', () => { source.close(); setRunning(false); });
      source.onerror = () => { source.close(); setRunning(false); };
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Runtime 启动失败'); setRunning(false);
    }
  };
  return <section>
    <PageHeader eyebrow="00 / LIVE RUNTIME" title="Agent Runtime Console" description="从 Studio 发起真实 Agent Loop，并实时观察 Context、LLM、Tool 和 Artifact Trace。"
      actions={<button className="primary" disabled={running || !capability} onClick={() => void start()}><Play size={15} />{running ? 'Runtime 执行中' : '启动真实 Run'}</button>} />
    {error && <div className="notice warning">{error}</div>}
    <div className="runtime-layout">
      <div className="panel runtime-config">
        <div className="panel-title"><Bot size={15} />RUN CONFIGURATION <span>{capability?.version ?? 'loading'}</span></div>
        <label>SKILL<select value={skill} onChange={(event) => setSkill(event.target.value)}>{capability?.skills.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.version}</option>)}</select></label>
        <label>MODEL PROVIDER<select value={providerId} onChange={(event) => { const value = event.target.value; setProviderId(value); setModel(capability?.providers.find((item) => item.id === value)?.model ?? ''); }}>{capability?.providers.map((item) => <option value={item.id} key={item.id}>{item.label} · {item.source}{item.isDefault ? ' · default' : ''}</option>)}</select></label>
        <label>MODEL<input value={model} onChange={(event) => setModel(event.target.value)} /></label>
        <div className="runtime-provider"><Server size={13} /><div><strong>{currentProvider?.label ?? 'No Provider'}</strong><span>{currentProvider?.provider} · {currentProvider?.lastTestStatus ?? 'untested'}</span></div><Link to="/providers">配置服务商 <ArrowUpRight size={11} /></Link></div>
        <label>USER TASK<textarea rows={6} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
        <label>FILES / WORKSPACE RELATIVE<textarea rows={3} value={files} onChange={(event) => setFiles(event.target.value)} /></label>
        <div className="skill-contract"><span><Cable size={13} />{currentSkill?.id}@{currentSkill?.version}</span><p>{currentSkill?.description}</p><div>{currentSkill?.requiredTools.map((tool) => <b key={tool}>{tool}</b>)}</div></div>
      </div>
      <div className="runtime-stream">
        <div className="metric-grid compact">
          <Metric label="LIVE EVENTS" value={events.length} tone="cyan" /><Metric label="CONTEXT SNAPSHOTS" value={contextCount} />
          <Metric label="TOOL CALLS" value={toolNames.length} tone="amber" /><Metric label="STATUS" value={running ? 'RUNNING' : events.length ? 'COMPLETE' : 'READY'} tone={running ? 'amber' : 'green'} />
          <Metric label="RUN" value={runId ? runId.slice(0, 13) : '—'} />
        </div>
        <div className="panel live-panel"><div className="panel-title"><Radio size={15} />LIVE TRACE EVENTS <span>{running ? 'streaming' : 'settled'}</span>{runId && !running && <Link to={`/runs/${runId}`}>打开完整 Trace <ArrowUpRight size={12} /></Link>}</div>
          <div className="live-event-layout"><div className="live-event-list">{events.map((event) => <button key={event.eventId} className={selected?.eventId === event.eventId ? 'active' : ''} onClick={() => setSelected(event)}>
            {event.eventType === 'tool.call' ? <TerminalSquare size={13} /> : event.eventType === 'context.build' ? <Braces size={13} /> : event.eventType === 'llm.call' ? <Cpu size={13} /> : event.eventType === 'artifact.write' ? <FileSpreadsheet size={13} /> : <Radio size={13} />}
            <div><strong>{String(event.payload.name ?? event.eventType)}</strong><span>{event.eventType}</span></div><StatusBadge status={event.eventType === 'error' ? 'failed' : 'success'} />
          </button>)}</div><div className="live-event-detail">{selected ? <><span className="eyebrow">{selected.eventType}</span><h2>{String(selected.payload.name ?? selected.eventType)}</h2><JsonView value={selected.payload} /></> : <p>启动 Run 后，Trace Event 将在此实时出现。</p>}</div></div>
        </div>
      </div>
    </div>
  </section>;
}
