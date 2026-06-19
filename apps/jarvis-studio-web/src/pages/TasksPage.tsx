import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import type { ReactNode } from 'react';
import {
  Activity,
  ClipboardList,
  FileArchive,
  FilePlus2,
  Info,
  LockKeyhole,
  Pencil,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, JsonView, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatDate } from '../utils/format.ts';

interface Workspace { id: string; name: string; defaultModelProfileId?: string }
interface Scenario { id: string; name: string; category?: string; defaultSkillId?: string }
interface Task {
  id: string;
  title: string;
  description?: string;
  category?: string;
  workspaceId: string;
  workspaceName?: string;
  scenarioTemplateId?: string;
  scenarioName?: string;
  status: string;
  priority: string;
  input: Record<string, unknown>;
  selectedModelProfileId?: string;
  selectedSkillId?: string;
  currentRunId?: string;
  score?: number | null;
  preflight?: unknown;
  postflight?: unknown;
  updatedAt?: string;
  artifacts?: Artifact[];
  approvals?: Approval[];
  events?: TaskEvent[];
  runs?: Run[];
  toolCalls?: ToolCall[];
  contextSnapshots?: ContextSnapshot[];
}

interface Artifact { id: string; name?: string; path: string; type: string; runId?: string; toolCallId?: string; isFinal?: boolean; createdAt?: string }
interface Approval { id: string; requestedAction?: string; riskLevel?: string; status: string; runId?: string; createdAt?: string }
interface TaskEvent { id: string; type: string; runId?: string; payload?: unknown; createdAt?: string }
interface Run { id: string; name: string; status: string; model?: string; latency_ms?: number; total_tokens?: number; started_at?: string }
interface ToolCall { id: string; toolName: string; success: boolean; latencyMs?: number; createdAt?: string }
interface ContextSnapshot { id: string; totalTokens?: number; maxContextTokens?: number; budgetStrategy?: string; truncated?: boolean; compressed?: boolean; createdAt?: string }

interface TaskForm {
  title: string;
  description: string;
  workspaceId: string;
  scenarioTemplateId: string;
  priority: string;
  message: string;
  inputFiles: string;
}

type SignalTab = 'diagnostics' | 'capabilities' | 'artifacts';

const blankTaskForm: TaskForm = {
  title: '分析客户清单',
  description: '验证 Agent 是否能读取客户 Excel 并输出异常分析与营销建议。',
  workspaceId: '',
  scenarioTemplateId: 'scenario_excel_analysis',
  priority: 'p1',
  message: '分析客户清单，识别异常并给出营销建议。',
  inputFiles: 'input/customer_data.xlsx'
};

const signalTabs: Array<{ id: SignalTab; label: string; icon: ReactNode }> = [
  { id: 'diagnostics', label: '运行诊断', icon: <Activity size={14} /> },
  { id: 'capabilities', label: '能力分析', icon: <ShieldCheck size={14} /> },
  { id: 'artifacts', label: '产物与日志', icon: <FileArchive size={14} /> }
];

export function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlWorkspaceId = searchParams.get('workspaceId') ?? '';
  const urlScenarioId = searchParams.get('scenarioTemplateId') ?? '';
  const openCreateFromUrl = searchParams.get('create') === '1';
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const [signalTab, setSignalTab] = useState<SignalTab>('diagnostics');
  const [form, setForm] = useState<TaskForm>(blankTaskForm);
  const [editForm, setEditForm] = useState<TaskForm>(blankTaskForm);
  const load = useCallback(async (signal: AbortSignal) => {
    const [tasks, workspaces, scenarios] = await Promise.all([
      api<Task[]>('/api/tasks', { signal }),
      api<Workspace[]>('/api/workspaces', { signal }),
      api<Scenario[]>('/api/scenarios', { signal })
    ]);
    return { tasks, workspaces, scenarios };
  }, []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['tasks-page'] });
  const tasks = resource.data?.tasks;
  const displayTasks = tasks ?? [];
  const workspaces = resource.data?.workspaces ?? [];
  const scenarios = resource.data?.scenarios ?? [];

  useEffect(() => {
    const data = resource.data;
    if (!data) return;
    const preferredWorkspaceId = urlWorkspaceId && data.workspaces.some((item) => item.id === urlWorkspaceId)
      ? urlWorkspaceId
      : '';
    const preferredScenarioId = urlScenarioId && data.scenarios.some((item) => item.id === urlScenarioId)
      ? urlScenarioId
      : '';
    setSelectedId((current) => current || data.tasks[0]?.id || '');
    setForm((current) => ({
      ...current,
      workspaceId: preferredWorkspaceId || current.workspaceId || data.workspaces[0]?.id || '',
      scenarioTemplateId: preferredScenarioId || current.scenarioTemplateId || data.scenarios[0]?.id || ''
    }));
    if (openCreateFromUrl) setCreating(true);
  }, [openCreateFromUrl, resource.data, urlScenarioId, urlWorkspaceId]);

  const loadDetail = useCallback((signal: AbortSignal) => selectedId ? api<Task>(`/api/tasks/${selectedId}`, { signal }) : Promise.resolve(undefined), [selectedId]);
  const detailResource = useAsyncResource<Task | undefined>(loadDetail, [selectedId], Boolean(selectedId), { queryKey: ['task-detail', selectedId] });
  const selected = useMemo(() => detailResource.data ?? displayTasks.find((item) => item.id === selectedId) ?? displayTasks[0], [detailResource.data, displayTasks, selectedId]);

  const closeCreate = () => {
    setCreating(false);
    if (!openCreateFromUrl) return;
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    setSearchParams(next, { replace: true });
  };

  const loadPreset = () => {
    const demoWorkspace = workspaces.find((item) => item.id === 'workspace_demo') ?? workspaces[0];
    const excelScenario = scenarios.find((item) =>
      item.id.includes('excel') || item.name.includes('Excel') || item.category === 'data-analysis') ?? scenarios[0];
    setForm({
      title: 'Excel 异常分析样例',
      description: 'Demo 任务：检查客户数据表，要求 Agent 生成数据概况、异常发现与营销建议。',
      workspaceId: demoWorkspace?.id ?? form.workspaceId,
      scenarioTemplateId: excelScenario?.id ?? form.scenarioTemplateId,
      priority: 'p1',
      message: '分析客户清单，识别异常数据，输出数据概况、异常发现和营销建议。',
      inputFiles: 'input/customer_data.xlsx'
    });
  };

  const create = async () => {
    setBusy('create');
    setNotice('');
    try {
      const created = await post<Task>('/api/tasks', taskPayload(form));
      await resource.reload();
      if (created?.id) setSelectedId(created.id);
      setNotice(`测试任务「${created?.title ?? form.title}」已创建。`);
      closeCreate();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '创建测试任务失败');
    } finally {
      setBusy('');
    }
  };

  const startEdit = () => {
    if (!selected) return;
    setNotice('');
    setEditForm(formFromTask(selected));
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selected) return;
    setBusy('save');
    setNotice('');
    try {
      const saved = await api<Task>(`/api/tasks/${selected.id}`, { method: 'PUT', body: JSON.stringify(taskPayload(editForm)) });
      setEditing(false);
      setNotice(`测试任务「${saved.title}」已更新。`);
      await resource.reload();
      await detailResource.reload();
      setSelectedId(saved.id);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '更新测试任务失败');
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`删除测试任务「${selected.title}」？`)) return;
    const deletedId = selected.id;
    setBusy('delete');
    setNotice('');
    try {
      await api(`/api/tasks/${deletedId}`, { method: 'DELETE' });
      resource.setData(resource.data ? { ...resource.data, tasks: resource.data.tasks.filter((item) => item.id !== deletedId) } : undefined);
      detailResource.setData(undefined);
      setSelectedId('');
      setEditing(false);
      setNotice(`测试任务「${selected.title}」已删除。`);
      await resource.reload();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '删除测试任务失败');
    } finally {
      setBusy('');
    }
  };

  const action = async (kind: 'preflight' | 'start' | 'resume' | 'replay' | 'convert-to-eval-case') => {
    if (!selected) return;
    setNotice('');
    try {
      const data = await post<unknown>(`/api/tasks/${selected.id}/${kind}`, {});
      setNotice(`${kind} 已执行`);
      await detailResource.reload();
      await resource.reload();
      if (kind === 'start') setNotice(`EvalTaskRunner 已通过 RuntimeAdapter 启动测试任务，结果会异步写回。${JSON.stringify(data).slice(0, 120)}`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : `${kind} 执行失败`);
      await detailResource.reload().catch(() => undefined);
    }
  };

  return <section>
    <PageHeader eyebrow="V0.5 / EvalTaskRunner" title="测试任务" description="测试任务用于评估不同模型、Prompt、Skill、Tool 和上下文策略下的 Agent 表现。Studio 只编排预检、RuntimeAdapter 调用、Trace/运行产物/运行审批收集、后验和 Eval Result，不承载正式业务任务。"
      actions={<><button onClick={() => void resource.reload()}><RefreshCw size={14} />刷新</button><button className="primary" onClick={() => setCreating(true)}><FilePlus2 size={14} />新建任务</button></>} />
    {(resource.error || detailResource.error || notice) && <div className="notice warning">{resource.error || detailResource.error || notice}</div>}
    <div className="metric-grid compact">
      <Metric label="TEST TASKS" value={displayTasks.length} tone="cyan" />
      <Metric label="STATUS" value={displayTasks.filter((item) => item.status === 'running').length ? 'running' : 'ready'} tone="green" />
      <Metric label="PASS RATE" value={`${displayTasks.length ? (displayTasks.filter((item) => item.status === 'success').length / displayTasks.length * 100).toFixed(0) : 0}%`} />
      <Metric label="RUN" value={selected?.currentRunId ? selected.currentRunId.slice(0, 10) : '—'} tone="amber" />
      <Metric label="MODEL" value={selected?.selectedModelProfileId ?? '—'} />
    </div>
    <div className="workbench-grid">
      <div className="panel registry-list">
        <div className="panel-title"><ClipboardList size={15} />测试任务队列 <span>{displayTasks.length}</span></div>
        {resource.loading && !tasks ? <Loading /> : displayTasks.length ? displayTasks.map((task) => <button key={task.id} className={selected?.id === task.id ? 'active' : ''} onClick={() => { setSelectedId(task.id); setEditing(false); }}>
          <StatusBadge status={task.status} />
          <div><strong>{task.title}</strong><span>{task.scenarioName ?? task.scenarioTemplateId ?? '无场景'} · {task.workspaceName ?? task.workspaceId}</span><p>{task.currentRunId ?? '尚未运行'}</p></div>
          <aside><b>{task.priority}</b><span>{formatDate(task.updatedAt)}</span></aside>
        </button>) : <Empty>暂无测试任务。可以从评测空间详情页带入 workspaceId，或直接新建一个任务。</Empty>}
        <div className="mini-form task-create-entry">
          <button className="primary" disabled={!workspaces.length} onClick={() => setCreating(true)}><FilePlus2 size={14} />打开新建任务表单</button>
          <button onClick={() => { loadPreset(); setCreating(true); }} disabled={!workspaces.length || !scenarios.length}><Sparkles size={14} />载入 Preset Demo</button>
        </div>
      </div>
      <div className="panel workbench-detail">
        {selected ? <>
          <div className="panel-title">Test Task Detail <span>{selected.id}</span></div>
          <div className="provider-actions task-detail-actions">
            <button onClick={() => void action('preflight')}><ShieldCheck size={14} />Preflight</button>
            <button className="primary" onClick={() => void action('start')}><Play size={14} />Start</button>
            <button disabled={selected.status !== 'ready' && selected.status !== 'waiting_approval'} onClick={() => void action('resume')}>Resume</button>
            <button onClick={() => void action('replay')}>Replay</button>
            <button onClick={() => void action('convert-to-eval-case')}>转为 Eval Case</button>
            <button onClick={startEdit}><Pencil size={14} />编辑</button>
            <button className="danger" disabled={busy === 'delete'} onClick={() => void remove()}><Trash2 size={14} />删除</button>
          </div>
          {editing && <TaskEditor form={editForm} workspaces={workspaces} scenarios={scenarios} busy={busy === 'save'} onChange={setEditForm} onCancel={() => setEditing(false)} onSave={() => void saveEdit()} />}
          <div className="registry-facts">
            <span>Eval Workspace<b>{selected.workspaceName ?? selected.workspaceId}</b></span>
            <span>Scenario<b>{selected.scenarioName ?? selected.scenarioTemplateId ?? '—'}</b></span>
            <span>Skill<b>{selected.selectedSkillId ?? '—'}</b></span>
            <span>Run<b>{selected.currentRunId ?? '—'}</b></span>
          </div>
          <div className="notice task-guidance"><Info size={14} />Preflight / Postflight 继承自评测场景模板。要调整前置检查和验收断言，请进入 <Link to="/scenarios">评测场景模板</Link> 编辑规则。</div>
          <div className="workbench-split task-check-summary">
            <CheckResultPanel title="Preflight" value={selected.preflight} />
            <CheckResultPanel title="Postflight" value={selected.postflight} score={selected.score} />
          </div>
          <div className="workbench-split">
            <div><h3>Test Input</h3><JsonView value={selected.input} /></div>
            <div><h3>Task Metadata</h3><JsonView value={{ description: selected.description, category: selected.category, priority: selected.priority, modelProfile: selected.selectedModelProfileId, skill: selected.selectedSkillId }} /></div>
          </div>
          <div className="task-signal-tabs">
            <div className="eval-tabs">{signalTabs.map((tab) => <button key={tab.id} className={signalTab === tab.id ? 'active' : ''} onClick={() => setSignalTab(tab.id)}>{tab.icon}{tab.label}</button>)}</div>
            <div className="task-signal-grid">
              {signalTab === 'diagnostics' && <>
                <SignalPanel title="Runs / Trace" icon={<Activity size={15} />} count={selected.runs?.length ?? 0}>
                  {selected.runs?.length ? <table><thead><tr><th>Run</th><th>状态</th><th>模型</th><th /></tr></thead><tbody>{selected.runs.map((run) => <tr key={run.id}>
                    <td className="run-name"><strong>{run.name}</strong><span>{run.id}</span></td>
                    <td><StatusBadge status={run.status} /></td>
                    <td>{run.model ?? '—'}</td>
                    <td><Link className="icon-link" to={`/runs/${run.id}`}>↗</Link></td>
                  </tr>)}</tbody></table> : <Empty>尚无 Run。</Empty>}
                </SignalPanel>
                <SignalPanel title="Runtime Approvals" icon={<LockKeyhole size={15} />} count={selected.approvals?.length ?? 0}>
                  {selected.approvals?.length ? <table><thead><tr><th>Action</th><th>风险</th><th>状态</th></tr></thead><tbody>{selected.approvals.map((approval) => <tr key={approval.id}>
                    <td className="run-name"><strong>{approval.requestedAction ?? approval.id}</strong><span>{approval.id}</span></td>
                    <td><StatusBadge status={approval.riskLevel ?? 'low'} /></td>
                    <td><StatusBadge status={approval.status} /></td>
                  </tr>)}</tbody></table> : <Empty>尚无审批记录。</Empty>}
                </SignalPanel>
              </>}
              {signalTab === 'capabilities' && <>
                <SignalPanel title="Tool Calls" icon={<ShieldCheck size={15} />} count={selected.toolCalls?.length ?? 0}>
                  {selected.toolCalls?.length ? <table><thead><tr><th>Tool</th><th>结果</th><th>耗时</th></tr></thead><tbody>{selected.toolCalls.map((tool) => <tr key={tool.id}>
                    <td className="run-name"><strong>{tool.toolName}</strong><span>{tool.id}</span></td>
                    <td><StatusBadge status={tool.success ? 'success' : 'failed'} /></td>
                    <td>{tool.latencyMs ?? '—'}ms</td>
                  </tr>)}</tbody></table> : <Empty>当前 Run 尚无工具调用。</Empty>}
                </SignalPanel>
                <SignalPanel title="Context Snapshots" icon={<Activity size={15} />} count={selected.contextSnapshots?.length ?? 0}>
                  {selected.contextSnapshots?.length ? <table><thead><tr><th>Snapshot</th><th>策略</th><th>Token</th></tr></thead><tbody>{selected.contextSnapshots.map((snapshot) => <tr key={snapshot.id}>
                    <td className="run-name"><strong>{snapshot.id}</strong><span>{formatDate(snapshot.createdAt)}</span></td>
                    <td>{snapshot.budgetStrategy ?? '—'}</td>
                    <td>{snapshot.totalTokens ?? '—'} / {snapshot.maxContextTokens ?? '—'}</td>
                  </tr>)}</tbody></table> : <Empty>当前 Run 尚无上下文快照。</Empty>}
                </SignalPanel>
              </>}
              {signalTab === 'artifacts' && <>
                <SignalPanel title="Run Artifacts" icon={<FileArchive size={15} />} count={selected.artifacts?.length ?? 0}>
                  {selected.artifacts?.length ? <table><thead><tr><th>Run Artifact</th><th>ToolCall</th><th>最终</th></tr></thead><tbody>{selected.artifacts.map((artifact) => <tr key={artifact.id}>
                    <td className="run-name"><strong>{artifact.name ?? artifact.path}</strong><span>{artifact.path}</span></td>
                    <td>{artifact.toolCallId ?? '—'}</td>
                    <td>{artifact.isFinal ? 'yes' : 'no'}</td>
                  </tr>)}</tbody></table> : <Empty>尚无运行产物。</Empty>}
                </SignalPanel>
                <SignalPanel title="Test Task Events" icon={<ClipboardList size={15} />} count={selected.events?.length ?? 0}>
                  {selected.events?.length ? <div className="event-ledger">{selected.events.slice(0, 12).map((event) => <div key={event.id}><strong>{event.type}</strong><span>{formatDate(event.createdAt)} · {event.runId ?? 'no-run'}</span></div>)}</div> : <Empty>尚无事件日志。</Empty>}
                </SignalPanel>
              </>}
            </div>
          </div>
        </> : <Empty>尚未创建测试任务。</Empty>}
      </div>
    </div>
    {creating && <CreateTaskModal form={form} workspaces={workspaces} scenarios={scenarios} busy={busy === 'create'} onChange={setForm} onPreset={loadPreset} onClose={closeCreate} onSubmit={() => void create()} />}
  </section>;
}

function CreateTaskModal({ form, workspaces, scenarios, busy, onChange, onPreset, onClose, onSubmit }: {
  form: TaskForm;
  workspaces: Workspace[];
  scenarios: Scenario[];
  busy: boolean;
  onChange: (form: TaskForm) => void;
  onPreset: () => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal run-create-modal" onClick={(event) => event.stopPropagation()}>
      <span className="eyebrow">Test Task Configuration</span>
      <h2>创建测试任务</h2>
      <p>任务会绑定一个评测空间和一个场景模板。Preflight/Postflight 规则来自所选场景模板。</p>
      <button onClick={onPreset}><Sparkles size={14} />一键载入 Excel 异常分析样例</button>
      <TaskFormFields form={form} workspaces={workspaces} scenarios={scenarios} onChange={onChange} />
      <div className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" disabled={busy || !form.title.trim() || !form.workspaceId} onClick={onSubmit}><FilePlus2 size={14} />{busy ? '创建中' : '创建测试任务'}</button></div>
    </div>
  </div>;
}

function TaskEditor({ form, workspaces, scenarios, busy, onChange, onCancel, onSave }: {
  form: TaskForm;
  workspaces: Workspace[];
  scenarios: Scenario[];
  busy: boolean;
  onChange: (form: TaskForm) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return <div className="task-editor-panel">
    <div className="panel-title"><Pencil size={15} />编辑测试任务 <span>PUT /api/tasks/:id</span></div>
    <TaskFormFields form={form} workspaces={workspaces} scenarios={scenarios} onChange={onChange} />
    <div className="modal-actions"><button onClick={onCancel}><X size={14} />取消</button><button className="primary" disabled={busy || !form.title.trim() || !form.workspaceId} onClick={onSave}><Save size={14} />{busy ? '保存中' : '保存修改'}</button></div>
  </div>;
}

function TaskFormFields({ form, workspaces, scenarios, onChange }: {
  form: TaskForm;
  workspaces: Workspace[];
  scenarios: Scenario[];
  onChange: (form: TaskForm) => void;
}) {
  return <div className="run-form-grid task-form-grid">
    <label>任务标题<input placeholder="例如：回归测试案例 A / Excel 异常分析" value={form.title} onChange={(event) => onChange({ ...form, title: event.target.value })} /></label>
    <label>优先级<ThemedSelect value={form.priority} onChange={(event) => onChange({ ...form, priority: event.target.value })}>{['p0', 'p1', 'p2', 'p3'].map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</ThemedSelect></label>
    <label>关联的隔离空间<ThemedSelect value={form.workspaceId} onChange={(event) => onChange({ ...form, workspaceId: event.target.value })}>
      <option value="">请选择评测空间</option>
      {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </ThemedSelect><em>决定 Agent 运行时的输入目录、产物目录和默认模型。</em></label>
    <label>评测场景模板<ThemedSelect value={form.scenarioTemplateId} onChange={(event) => onChange({ ...form, scenarioTemplateId: event.target.value })}>
      <option value="">不绑定场景模板</option>
      {scenarios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </ThemedSelect><em>场景模板会提供默认 Skill、工具约束和 Preflight/Postflight 断言。</em></label>
    <label className="wide">任务描述<input placeholder="说明本任务想验证的 Agent 能力和验收口径" value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} /></label>
    <label className="wide">评测提示词 (Message)<textarea rows={4} placeholder="请输入评测输入消息，例如：分析客户清单，识别异常并给出营销建议。" value={form.message} onChange={(event) => onChange({ ...form, message: event.target.value })} /></label>
    <label className="wide">输入文件路径 (Input Files)<textarea rows={3} placeholder="请输入评测空间下的相对路径，支持每行一个文件，例如：&#10;input/customer_data.xlsx&#10;input/sample.csv" value={form.inputFiles} onChange={(event) => onChange({ ...form, inputFiles: event.target.value })} /></label>
  </div>;
}

function CheckResultPanel({ title, value, score }: { title: string; value: unknown; score?: number | null }) {
  const summary = checkResultSummary(value);
  return <div>
    <h3>{title}</h3>
    <div className="check-result-head">
      <StatusBadge status={summary.status} />
      <span>{summary.checkedAt ?? '尚未执行'}</span>
      {score != null && <b>Score {score}</b>}
    </div>
    {summary.checks.length ? <div className="check-result-grid">{summary.checks.map((check, index) => <article key={`${check.id}-${index}`} className={`check-card check-${check.status}`}>
      <StatusBadge status={check.status} />
      <strong>{check.id}</strong>
      <p>{check.detail}</p>
    </article>)}</div> : <Empty>{title} 尚未产生检查结果。</Empty>}
  </div>;
}

function SignalPanel({ title, icon, count, children }: { title: string; icon: ReactNode; count: number; children: ReactNode }) {
  return <div className="panel task-signal-panel">
    <div className="panel-title">{icon}{title}<span>{count}</span></div>
    <div className="table-wrap flush">{children}</div>
  </div>;
}

function taskPayload(form: TaskForm) {
  return {
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    workspaceId: form.workspaceId,
    scenarioTemplateId: form.scenarioTemplateId || undefined,
    priority: form.priority,
    inputFiles: lines(form.inputFiles),
    message: form.message,
    input: { message: form.message }
  };
}

function formFromTask(task: Task): TaskForm {
  return {
    title: task.title,
    description: task.description ?? '',
    workspaceId: task.workspaceId,
    scenarioTemplateId: task.scenarioTemplateId ?? '',
    priority: task.priority || 'p1',
    message: typeof task.input.message === 'string' ? task.input.message : '',
    inputFiles: inputFilesText(task.input)
  };
}

function inputFilesText(input: Record<string, unknown>) {
  const raw = input.files ?? input.inputFiles;
  if (!Array.isArray(raw)) return '';
  return raw.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && 'path' in item) return String((item as { path?: unknown }).path ?? '');
    return String(item);
  }).filter(Boolean).join('\n');
}

function lines(text: string) {
  return text.split('\n').map((item) => item.trim()).filter(Boolean);
}

function checkResultSummary(value: unknown) {
  if (!value || typeof value !== 'object') return { status: 'pending', checkedAt: '', checks: [] as Array<{ id: string; status: string; detail: string }> };
  const record = value as Record<string, unknown>;
  const rawChecks = Array.isArray(record.checks) ? record.checks : [];
  return {
    status: typeof record.status === 'string' ? record.status : 'pending',
    checkedAt: typeof record.checkedAt === 'string' ? formatDate(record.checkedAt) : '',
    checks: rawChecks.map((item) => {
      const check = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return {
        id: typeof check.id === 'string' ? check.id : 'unknown_check',
        status: typeof check.status === 'string' ? check.status : 'warning',
        detail: typeof check.detail === 'string' ? check.detail : JSON.stringify(check)
      };
    })
  };
}
