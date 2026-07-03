import { useCallback, useEffect, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { ArrowRight, FileCode2, GitCompareArrows, Hammer, ListChecks, TrendingDown, TrendingUp } from 'lucide-react';
import { api, post } from '../api.ts';
import { Empty, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatDuration, formatNumber } from '../utils/format.ts';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
      setNotice(error instanceof Error ? error.message : t('pages.taskCompare.string_22'));
    }
  };
  return <section>
    <PageHeader eyebrow="V0.5 / Test Task Compare" title={t('pages.taskCompare.string_1')} description={t('pages.taskCompare.string_2')} />
    {tasksResource.error && <div className="notice warning">{tasksResource.error}</div>}
    {notice && <div className="notice warning">{notice}</div>}
    <div className="compare-controls panel">
      <label>{t('pages.taskCompare.string_3')}<ThemedSelect value={left} onChange={(event) => setLeft(event.target.value)}>{tasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</ThemedSelect></label>
      <ArrowRight size={22} />
      <label>{t('pages.taskCompare.string_4')}<ThemedSelect value={right} onChange={(event) => setRight(event.target.value)}>{tasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</ThemedSelect></label>
      <button className="primary" disabled={!left || !right || left === right} onClick={() => void runCompare()}><GitCompareArrows size={15} />{t('pages.taskCompare.string_12')}</button>
    </div>
    {!result ? <Empty>{t('pages.taskCompare.string_13')}</Empty> : <>
      <div className="comparison-head">
        <TaskHead label={t('pages.taskCompare.string_3')} item={result.left} />
        <div className="versus">VS</div>
        <TaskHead label={t('pages.taskCompare.string_4')} item={result.right} />
      </div>
      <div className="metric-grid compact">
        <Metric label="STATUS" value={<StatusBadge status={result.summary.classification} />} tone={result.summary.classification === 'regressed' ? 'red' : 'green'} />
        <Delta label={t('pages.taskCompare.string_5')} value={result.delta.score} format={(value) => value.toFixed(2)} positive />
        <Delta label={t('pages.taskCompare.string_6')} value={result.delta.latencyMs} format={formatDuration} />
        <Delta label="Token Δ" value={result.delta.totalTokens} format={formatNumber} />
        <Delta label="Run Artifact Δ" value={result.delta.artifacts} format={formatNumber} positive />
      </div>
      <div className="task-compare-grid">
        <div className="panel">
          <div className="panel-title"><ListChecks size={15} />{t('pages.taskCompare.string_14')} <span>{result.summary.changedDimensions}</span></div>
          <DiffTable rows={result.dimensions.map((item) => ({ key: item.key, label: item.label, left: item.left, right: item.right, status: item.same ? 'unchanged' : 'changed' }))} />
        </div>
        <div className="panel">
          <div className="panel-title"><Hammer size={15} />{t('pages.taskCompare.string_15')} <span>{result.summary.changedTools}</span></div>
          <DiffTable rows={result.toolDiff.changed.map((item) => ({ key: item.key, label: item.key, left: String(item.left), right: `${item.right} (${signed(item.delta)})`, status: item.delta === 0 ? 'unchanged' : 'changed' }))} empty={t('pages.taskCompare.string_23')} />
        </div>
      </div>
      <div className="task-compare-grid">
        <div className="panel">
          <div className="panel-title"><FileCode2 size={15} />{t('pages.taskCompare.string_16')} <span>+{result.summary.addedArtifacts} / -{result.summary.removedArtifacts}</span></div>
          <div className="artifact-diff-columns">
            <ArtifactList title={t('pages.taskCompare.string_7')} items={result.artifactDiff.added} />
            <ArtifactList title={t('pages.taskCompare.string_8')} items={result.artifactDiff.removed} />
            <ArtifactList title={t('pages.taskCompare.string_9')} items={result.artifactDiff.unchanged.slice(0, 8)} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-title"><ListChecks size={15} />{t('pages.taskCompare.string_17')} <span>{result.summary.changedChecks}</span></div>
          <DiffTable rows={result.checkDiff.changed.map((item) => ({ key: item.key, label: item.key, left: item.left?.status ?? 'missing', right: item.right?.status ?? 'missing', status: item.left?.status === item.right?.status ? 'unchanged' : 'changed' }))} empty={t('pages.taskCompare.string_24')} />
        </div>
      </div>
    </>}
  </section>;
}

function TaskHead({ label, item }: { label: string; item: Snapshot }) {
  const { t } = useTranslation();
  return <div><span>{label}</span><h2>{item.task.title}</h2><b>{item.task.selectedSkillId ?? t('pages.taskCompare.string_25')} · {item.task.score ?? '—'} {t('pages.taskCompare.string_26')}</b><p>{item.task.workspaceName ?? item.task.workspaceId} · {item.task.scenarioName ?? item.task.scenarioTemplateId ?? t('taskDashboard.string_23')} · Run {item.task.currentRunId ?? '—'}</p></div>;
}

function Delta({ label, value, format, positive = false }: { label: string; value: number; format: (value: number) => string; positive?: boolean }) {
  const good = positive ? value >= 0 : value <= 0;
  const formatted = format(value);
  return <div className="delta-card"><span>{label}</span><div><strong>{formatted}</strong></div><em className={good ? 'positive' : 'negative'}>{value >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{signed(value)}</em></div>;
}

function DiffTable({ rows, empty }: { rows: Array<{ key: string; label: string; left: string; right: string; status: string }>; empty?: string }) {
  const { t } = useTranslation();
  const defaultEmpty = empty ?? t('pages.taskCompare.string_27');
  if (!rows.length) return <Empty>{defaultEmpty}</Empty>;
  return <div className="table-wrap flush"><table><thead><tr><th>{t('pages.taskCompare.string_18')}</th><th>{t('pages.taskCompare.string_19')}</th><th>{t('pages.taskCompare.string_20')}</th><th>{t('common.status')}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key}>
    <td>{row.label}</td><td>{row.left}</td><td>{row.right}</td><td><StatusBadge status={row.status} /></td>
  </tr>)}</tbody></table></div>;
}

function ArtifactList({ title, items }: { title: string; items: Artifact[] }) {
  const { t } = useTranslation();
  return <div><h3>{title}</h3>{items.length ? items.map((artifact) => <span key={artifact.id}><b>{artifact.name ?? artifact.path}</b><em>{artifact.type} · {artifact.path}</em></span>) : <p>{t('pages.taskCompare.string_21')}</p>}</div>;
}

function signed(value: number) {
  return `${value >= 0 ? '+' : ''}${formatNumber(value)}`;
}
