import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { ArrowUpRight, Bot, Braces, Cable, Cpu, FileSpreadsheet, Play, Radio, Server, TerminalSquare } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, parseJsonWithSchema, post } from '../api.ts';
import { JsonView, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { runtimeCapabilitySchema, traceEventSchema } from '../types/schemas.ts';

interface Capability {
  version: string;
  workspacePath: string;
  providers: Array<{ id: string; label: string; provider: 'deterministic' | 'openai-compatible'; available: boolean; model: string; source: string; isDefault: boolean; lastTestStatus?: string }>;
  skills: Array<{ id: string; name: string; version: string; description: string; requiredTools: string[]; defaultTask?: string; defaultFiles?: string[] }>;
}
interface TraceEvent { eventId: string; eventType: string; timestamp: string; runId?: string; payload: Record<string, unknown> }

export function RuntimePage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const linkedWorkspaceId = searchParams.get('workspaceId') ?? '';
  const [skill, setSkill] = useState('excel-data-analysis');
  const [providerId, setProviderId] = useState('builtin-deterministic');
  const [model, setModel] = useState('deterministic-local');
  const [message, setMessage] = useState(t('pages.runtime.string_13'));
  const [files, setFiles] = useState('input/customer_data.xlsx');
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [selected, setSelected] = useState<TraceEvent>();
  const [runId, setRunId] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const sseRef = useRef<EventSource | null>(null);
  const loadCapability = useCallback((signal: AbortSignal) => api<Capability>('/api/runtime/capabilities', { schema: runtimeCapabilitySchema, signal }), []);
  const capabilityResource = useAsyncResource(loadCapability, [], true, { queryKey: ['runtime-capabilities'] });
  const capability = capabilityResource.data;
  const closeActiveStream = useCallback(() => {
    sseRef.current?.close();
    sseRef.current = null;
  }, []);
  useEffect(() => {
    if (!capability) return;
    const initialSkill = capability.skills.find((item) => item.id === skill) ?? capability.skills[0];
      if (initialSkill) applySkillDefaults(initialSkill);
      const preferred = capability.providers.find((item) => item.isDefault) ?? capability.providers[0];
      if (preferred) {
        setProviderId(preferred.id);
        setModel(preferred.model);
      }
  }, [capability]);
  useEffect(() => () => closeActiveStream(), [closeActiveStream]);
  const currentSkill = capability?.skills.find((item) => item.id === skill);
  const currentProvider = capability?.providers.find((item) => item.id === providerId);
  const toolNames = useMemo(() => events.filter((event) => event.eventType === 'tool.call').map((event) => String(event.payload.tool)), [events]);
  const contextCount = events.filter((event) => event.eventType === 'context.build').length;
  const applySkillDefaults = (item: Capability['skills'][number]) => {
    setMessage(item.defaultTask ?? item.description);
    setFiles((item.defaultFiles ?? []).join('\n'));
  };
  const selectSkill = (value: string) => {
    const nextSkill = capability?.skills.find((item) => item.id === value);
    closeActiveStream();
    setRunning(false);
    setSkill(value);
    if (nextSkill) applySkillDefaults(nextSkill);
    else { setMessage(''); setFiles(''); }
    setEvents([]);
    setSelected(undefined);
    setRunId('');
    setError('');
  };
  const start = async () => {
    closeActiveStream();
    setEvents([]); setSelected(undefined); setRunId(''); setRunning(true); setError('');
    try {
      const created = await post<{ runId: string; eventsUrl: string }>('/api/runtime/runs', {
        name: `Studio · ${currentSkill?.name ?? skill}`, message, skill, providerId, model,
        files: files.split('\n').map((file) => file.trim()).filter(Boolean)
      });
      setRunId(created.runId);
      const source = new EventSource(created.eventsUrl);
      sseRef.current = source;
      source.onmessage = (event) => {
        try {
          const trace = parseJsonWithSchema(event.data, traceEventSchema, t('pages.runtime.string_14')) as TraceEvent;
          setEvents((items) => items.some((item) => item.eventId === trace.eventId) ? items : [...items, trace]);
          setSelected((item) => item ?? trace);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : t('pages.runtime.string_15'));
        }
      };
      source.addEventListener('complete', () => {
        if (sseRef.current !== source) return;
        closeActiveStream();
        setRunning(false);
      });
      source.onerror = () => {
        if (sseRef.current !== source) return;
        closeActiveStream();
        setRunning(false);
      };
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('pages.runtime.string_16')); setRunning(false);
    }
  };
  return <section>
    <PageHeader eyebrow="00 / Live Runtime via RuntimeAdapter" title={t('pages.runtime.string_1')} description={t('pages.runtime.string_2')}
      actions={<button className="primary" disabled={running || !capability} onClick={() => void start()}><Play size={15} />{running ? t('pages.runtime.string_17') : t('pages.runtime.string_18')}</button>} />
    {(capabilityResource.error || error) && <div className="notice warning">{capabilityResource.error || error}</div>}
    {linkedWorkspaceId && <div className="notice">已从评测空间接收 workspaceId：{linkedWorkspaceId}。当前实时运行使用 RuntimeAdapter 工作目录；如需持久化评测结果，请在测试任务中启动。</div>}
    <div className="runtime-layout">
      <div className="panel runtime-config">
        <div className="panel-title"><Bot size={15} />{t('pages.runtime.string_3')}<span>{capability?.version ?? t('pages.runtime.string_19')}</span></div>
        <label>{t('pages.runtime.string_4')}<ThemedSelect value={skill} onChange={(event) => selectSkill(event.target.value)}>{capability?.skills.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.version}</option>)}</ThemedSelect></label>
        <label>{t('pages.runtime.string_5')}<ThemedSelect value={providerId} onChange={(event) => { const value = event.target.value; setProviderId(value); setModel(capability?.providers.find((item) => item.id === value)?.model ?? ''); }}>{capability?.providers.map((item) => <option value={item.id} key={item.id}>{item.label} · {item.source}{item.isDefault ? t('pages.runtime.string_20') : ''}</option>)}</ThemedSelect></label>
        <label>{t('pages.runtime.string_6')}<input value={model} onChange={(event) => setModel(event.target.value)} /></label>
        <div className="runtime-provider"><Server size={13} /><div><strong>{currentProvider?.label ?? t('pages.runtime.string_21')}</strong><span>{currentProvider?.provider} · {currentProvider?.lastTestStatus ?? t('pages.runtime.string_22')}</span></div><Link to="/providers">{t('pages.runtime.string_7')}<ArrowUpRight size={11} /></Link></div>
        <label>{t('pages.runtime.string_8')}<textarea rows={6} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
        <label>{t('pages.runtime.string_9')}<textarea rows={3} value={files} onChange={(event) => setFiles(event.target.value)} /></label>
        <div className="skill-contract"><span><Cable size={13} />{currentSkill?.id}@{currentSkill?.version}</span><p>{currentSkill?.description}</p><div>{currentSkill?.requiredTools.map((tool) => <b key={tool}>{tool}</b>)}</div></div>
      </div>
      <div className="runtime-stream">
        <div className="metric-grid compact">
          <Metric label="LIVE EVENTS" value={events.length} tone="cyan" /><Metric label="CONTEXT SNAPSHOTS" value={contextCount} />
          <Metric label="TOOL CALLS" value={toolNames.length} tone="amber" /><Metric label="STATUS" value={running ? t('common.running') : events.length ? t('pages.runtime.string_23') : t('pages.runtime.string_24')} tone={running ? 'amber' : 'green'} />
          <Metric label="RUN" value={runId ? runId.slice(0, 13) : '—'} />
        </div>
        <div className="panel live-panel"><div className="panel-title"><Radio size={15} />{t('pages.runtime.string_10')}<span>{running ? t('pages.runtime.string_25') : t('pages.runtime.string_26')}</span>{runId && !running && <Link to={`/runs/${runId}`}>{t('pages.runtime.string_11')}<ArrowUpRight size={12} /></Link>}</div>
          <div className="live-event-layout"><div className="live-event-list">{events.map((event) => <button key={event.eventId} className={selected?.eventId === event.eventId ? 'active' : ''} onClick={() => setSelected(event)}>
            {event.eventType === 'tool.call' ? <TerminalSquare size={13} /> : event.eventType === 'context.build' ? <Braces size={13} /> : event.eventType === 'llm.call' ? <Cpu size={13} /> : event.eventType === 'artifact.write' ? <FileSpreadsheet size={13} /> : <Radio size={13} />}
            <div><strong>{String(event.payload.name ?? event.eventType)}</strong><span>{event.eventType}</span></div><StatusBadge status={event.eventType === 'error' ? 'failed' : 'success'} />
          </button>)}</div><div className="live-event-detail">{selected ? <><span className="eyebrow">{selected.eventType}</span><h2>{String(selected.payload.name ?? selected.eventType)}</h2><JsonView value={selected.payload} /></> : <p>{t('pages.runtime.string_12')}</p>}</div></div>
        </div>
      </div>
    </div>
  </section>;
}
