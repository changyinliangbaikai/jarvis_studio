import { useCallback, useEffect, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { ArrowRight, FileCode2, GitCompareArrows, Hammer, ListChecks, TrendingDown, TrendingUp } from 'lucide-react';
import { api, post } from '../api.ts';
import { Empty, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatDuration, formatNumber } from '../utils/format.ts';

interface Task {
  id: string;
  title: string;
  status: string;
  workspaceName?: string;
  workspaceId: string;
  scenarioName?: string;
  scenarioTemplateId?: string;
  selectedModelProfileId?: string;
  selectedSkillId?: string;
  currentRunId?: string;
  score?: number | null;
}

interface Artifact {
  id: string;
  name?: string;
  path: string;
  type: string;
  checksum?: string;
}

interface Snapshot {
  task: Task;
  run?: { id: string; status: string; model?: string; latencyMs?: number; totalTokens?: number; toolCallCount?: number; artifactCount?: number } | null;
  artifacts: Artifact[];
  approvals: unknown[];
  toolCallCount: number;
}

interface DimensionDiff { key: string; label: string; left: string; right: string; same: boolean }
interface CountDiff { key: string; left: number; right: number; delta: number }
interface CheckDiff { key: string; left?: { status: string; detail?: string }; right?: { status: string; detail?: string } }

interface CompareResult {
  left: Snapshot;
  right: Snapshot;
  delta: { score: number; latencyMs: number; totalTokens: number; toolCalls: number; artifacts: number; approvals: number; postflightPassed: number };
  dimensions: DimensionDiff[];
  artifactDiff: { added: Artifact[]; removed: Artifact[]; changed: unknown[]; unchanged: Artifact[] };
  toolDiff: { changed: CountDiff[]; unchanged: string[] };
  checkDiff: { changed: CheckDiff[]; unchanged: string[] };
  summary: { classification: string; changedDimensions: number; addedArtifacts: number; removedArtifacts: number; changedArtifacts: number; changedTools: number; changedChecks: number };
}

export function TaskComparePage() {
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [result, setResult] = useState<CompareResult>();
  const [notice, setNotice] = useState('');
  const loadTasks = useCallback((signal: AbortSignal) => api<Task[]>('/api/tasks', { signal }), []);
  const tasksResource = useAsyncResource(loadTasks, [], true, { queryKey: ['task-compare-tasks'] });
  const tasks = tasksResource.data ?? [];
  useEffect(() => {
    setLeft((current) => current || tasks[1]?.id || tasks[0]?.id || '');
    setRight((current) => current || tasks[0]?.id || '');
  }, [tasks]);
  const runCompare = async () => {
    setNotice('');
    try {
      setResult(await post<CompareResult>('/api/tasks/compare', { leftTaskId: left, rightTaskId: right }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '测试任务对比执行失败');
    }
  };
  return <section>
    <PageHeader eyebrow="V0.5 / Test Task Compare" title="测试任务对比" description="对比两个测试任务的模型、Skill、Prompt、工具调用、运行产物、运行审批和 Postflight 结果，定位 Agent Runtime 场景验证差异。" />
    {tasksResource.error && <div className="notice warning">{tasksResource.error}</div>}
    {notice && <div className="notice warning">{notice}</div>}
    <div className="compare-controls panel">
      <label>左侧测试任务<ThemedSelect value={left} onChange={(event) => setLeft(event.target.value)}>{tasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</ThemedSelect></label>
      <ArrowRight size={22} />
      <label>右侧测试任务<ThemedSelect value={right} onChange={(event) => setRight(event.target.value)}>{tasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</ThemedSelect></label>
      <button className="primary" disabled={!left || !right || left === right} onClick={() => void runCompare()}><GitCompareArrows size={15} />运行测试任务对比</button>
    </div>
    {!result ? <Empty>创建或运行至少两个测试任务后，可以执行任务级对比。</Empty> : <>
      <div className="comparison-head">
        <TaskHead label="左侧测试任务" item={result.left} />
        <div className="versus">VS</div>
        <TaskHead label="右侧测试任务" item={result.right} />
      </div>
      <div className="metric-grid compact">
        <Metric label="STATUS" value={<StatusBadge status={result.summary.classification} />} tone={result.summary.classification === 'regressed' ? 'red' : 'green'} />
        <Delta label="评分 Δ" value={result.delta.score} format={(value) => value.toFixed(2)} positive />
        <Delta label="耗时 Δ" value={result.delta.latencyMs} format={formatDuration} />
        <Delta label="Token Δ" value={result.delta.totalTokens} format={formatNumber} />
        <Delta label="Run Artifact Δ" value={result.delta.artifacts} format={formatNumber} positive />
      </div>
      <div className="task-compare-grid">
        <div className="panel">
          <div className="panel-title"><ListChecks size={15} />维度差异 <span>{result.summary.changedDimensions}</span></div>
          <DiffTable rows={result.dimensions.map((item) => ({ key: item.key, label: item.label, left: item.left, right: item.right, status: item.same ? 'unchanged' : 'changed' }))} />
        </div>
        <div className="panel">
          <div className="panel-title"><Hammer size={15} />工具链差异 <span>{result.summary.changedTools}</span></div>
          <DiffTable rows={result.toolDiff.changed.map((item) => ({ key: item.key, label: item.key, left: String(item.left), right: `${item.right} (${signed(item.delta)})`, status: item.delta === 0 ? 'unchanged' : 'changed' }))} empty="工具调用计数一致。" />
        </div>
      </div>
      <div className="task-compare-grid">
        <div className="panel">
          <div className="panel-title"><FileCode2 size={15} />运行产物差异 <span>+{result.summary.addedArtifacts} / -{result.summary.removedArtifacts}</span></div>
          <div className="artifact-diff-columns">
            <ArtifactList title="新增" items={result.artifactDiff.added} />
            <ArtifactList title="移除" items={result.artifactDiff.removed} />
            <ArtifactList title="相同" items={result.artifactDiff.unchanged.slice(0, 8)} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-title"><ListChecks size={15} />Postflight 差异 <span>{result.summary.changedChecks}</span></div>
          <DiffTable rows={result.checkDiff.changed.map((item) => ({ key: item.key, label: item.key, left: item.left?.status ?? 'missing', right: item.right?.status ?? 'missing', status: item.left?.status === item.right?.status ? 'unchanged' : 'changed' }))} empty="Postflight 检查结果一致。" />
        </div>
      </div>
    </>}
  </section>;
}

function TaskHead({ label, item }: { label: string; item: Snapshot }) {
  return <div><span>{label}</span><h2>{item.task.title}</h2><b>{item.task.selectedSkillId ?? '无 Skill'} · {item.task.score ?? '—'} 分</b><p>{item.task.workspaceName ?? item.task.workspaceId} · {item.task.scenarioName ?? item.task.scenarioTemplateId ?? '无场景'} · Run {item.task.currentRunId ?? '—'}</p></div>;
}

function Delta({ label, value, format, positive = false }: { label: string; value: number; format: (value: number) => string; positive?: boolean }) {
  const good = positive ? value >= 0 : value <= 0;
  const formatted = format(value);
  return <div className="delta-card"><span>{label}</span><div><strong>{formatted}</strong></div><em className={good ? 'positive' : 'negative'}>{value >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{signed(value)}</em></div>;
}

function DiffTable({ rows, empty = '暂无差异。' }: { rows: Array<{ key: string; label: string; left: string; right: string; status: string }>; empty?: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return <div className="table-wrap flush"><table><thead><tr><th>维度</th><th>左侧</th><th>右侧</th><th>状态</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key}>
    <td>{row.label}</td><td>{row.left}</td><td>{row.right}</td><td><StatusBadge status={row.status} /></td>
  </tr>)}</tbody></table></div>;
}

function ArtifactList({ title, items }: { title: string; items: Artifact[] }) {
  return <div><h3>{title}</h3>{items.length ? items.map((artifact) => <span key={artifact.id}><b>{artifact.name ?? artifact.path}</b><em>{artifact.type} · {artifact.path}</em></span>) : <p>无</p>}</div>;
}

function signed(value: number) {
  return `${value >= 0 ? '+' : ''}${formatNumber(value)}`;
}
