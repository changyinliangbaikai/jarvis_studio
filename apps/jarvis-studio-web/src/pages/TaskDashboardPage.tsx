import { useTranslation } from 'react-i18next';
import { useCallback } from 'react';
import { ArrowUpRight, ClipboardList, FileArchive, Gauge, Layers, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatDate, formatNumber } from '../utils/format.ts';

interface Task {
  id: string;
  title: string;
  status: string;
  workspaceName?: string;
  workspaceId: string;
  scenarioName?: string;
  scenarioTemplateId?: string;
  score?: number | null;
  updatedAt?: string;
}

interface Artifact {
  id: string;
  name?: string;
  path: string;
  type: string;
  taskId?: string;
  sizeBytes?: number;
  createdAt?: string;
}

interface Approval {
  id: string;
  requestedAction?: string;
  riskLevel?: string;
  status: string;
  taskId?: string;
  createdAt?: string;
}

interface ScenarioStat {
  id: string;
  name: string;
  category?: string;
  tasks: number;
  success: number;
  failed: number;
  artifacts: number;
  completionRate: number;
}

interface Dashboard {
  generatedAt: string;
  totals: { workspaces: number; tasks: number; runs: number; artifacts: number; approvals: number; pendingApprovals: number; scenarios: number };
  metrics: { taskCompletionRate: number; artifactGenerationRate: number; approvalPassRate: number; preflightFailureRate: number; postflightFailureRate: number; averageTaskScore?: number | null };
  statusCounts: Record<string, number>;
  scenarioStats: ScenarioStat[];
  recentTasks: Task[];
  recentArtifacts: Artifact[];
  pendingApprovals: Approval[];
}

export function TaskDashboardPage() {
  const { t } = useTranslation();
  const loadDashboard = useCallback((signal: AbortSignal) => api<Dashboard>('/api/workbench/dashboard', { signal }), []);
  const dashboardResource = useAsyncResource(loadDashboard, [], true, { queryKey: ['workbench-dashboard'] });
  const dashboard = dashboardResource.data;
  if (!dashboard) return <Loading />;
  const statusEntries = Object.entries(dashboard.statusCounts).sort((left, right) => right[1] - left[1]);
  return <section>
    <PageHeader eyebrow="V0.5 / Eval Dashboard" title={t('pages.taskDashboard.string_1')} description={t('pages.taskDashboard.string_2')}
      actions={<span className="eyebrow">UPDATED {formatDate(dashboard.generatedAt)}</span>} />
    {dashboardResource.error && <div className="notice warning">{dashboardResource.error}</div>}
    <div className="metric-grid">
      <Metric label={t('pages.taskDashboard.string_3')} value={percent(dashboard.metrics.taskCompletionRate)} tone="green" />
      <Metric label={t('pages.taskDashboard.string_4')} value={percent(dashboard.metrics.artifactGenerationRate)} tone="cyan" />
      <Metric label={t('pages.taskDashboard.string_5')} value={percent(dashboard.metrics.approvalPassRate)} tone="amber" />
      <Metric label={t('pages.taskDashboard.string_6')} value={dashboard.metrics.averageTaskScore == null ? '—' : dashboard.metrics.averageTaskScore.toFixed(2)} />
    </div>
    <div className="metric-grid compact">
      <Metric label="EVAL WORKSPACES" value={formatNumber(dashboard.totals.workspaces)} />
      <Metric label="TEST TASKS" value={formatNumber(dashboard.totals.tasks)} tone="cyan" />
      <Metric label="RUNS" value={formatNumber(dashboard.totals.runs)} />
      <Metric label="RUN ARTIFACTS" value={formatNumber(dashboard.totals.artifacts)} tone="green" />
      <Metric label="PENDING RUNTIME APPROVALS" value={formatNumber(dashboard.totals.pendingApprovals)} tone={dashboard.totals.pendingApprovals ? 'amber' : undefined} />
    </div>
    <div className="workbench-dashboard-grid">
      <div className="panel">
        <div className="panel-title"><Gauge size={15} />{t('pages.taskDashboard.string_7')}<span>{dashboard.totals.tasks} tasks</span></div>
        <div className="status-ledger">
          {statusEntries.length ? statusEntries.map(([status, count]) => <div key={status}><StatusBadge status={status} /><strong>{count}</strong></div>) : <Empty>{t('pages.taskDashboard.string_8')}</Empty>}
        </div>
      </div>
      <div className="panel">
        <div className="panel-title"><Layers size={15} />{t('pages.taskDashboard.string_9')}<span>{dashboard.scenarioStats.length}</span></div>
        <div className="table-wrap flush"><table><thead><tr><th>Scenario</th><th>{t('pages.taskDashboard.string_10')}</th><th>{t('pages.taskDashboard.string_11')}</th><th>{t('pages.taskDashboard.string_12')}</th><th>{t('common.failed')}</th></tr></thead><tbody>{dashboard.scenarioStats.map((item) => <tr key={item.id}>
          <td className="run-name"><strong>{item.name}</strong><span>{item.category ?? item.id}</span></td>
          <td>{item.tasks}</td>
          <td className="score">{percent(item.completionRate)}</td>
          <td>{item.artifacts}</td>
          <td>{item.failed}</td>
        </tr>)}</tbody></table></div>
      </div>
    </div>
    <div className="workbench-dashboard-grid">
      <div className="panel">
        <div className="panel-title"><ClipboardList size={15} />{t('pages.taskDashboard.string_13')}<span>{dashboard.recentTasks.length}</span></div>
        <div className="table-wrap flush"><table><thead><tr><th>Test Task</th><th>{t('common.status')}</th><th>{t('pages.taskDashboard.string_14')}</th><th /></tr></thead><tbody>{dashboard.recentTasks.map((task) => <tr key={task.id}>
          <td className="run-name"><strong>{task.title}</strong><span>{task.workspaceName ?? task.workspaceId} · {task.scenarioName ?? task.scenarioTemplateId ?? t('pages.taskDashboard.string_23')} · {formatDate(task.updatedAt)}</span></td>
          <td><StatusBadge status={task.status} /></td>
          <td className="score">{task.score ?? '—'}</td>
          <td><Link className="icon-link" to="/tasks"><ArrowUpRight size={15} /></Link></td>
        </tr>)}</tbody></table></div>
      </div>
      <div className="panel">
        <div className="panel-title"><FileArchive size={15} />{t('pages.taskDashboard.string_15')}<span>{dashboard.recentArtifacts.length}</span></div>
        <div className="table-wrap flush"><table><thead><tr><th>Run Artifact</th><th>{t('pages.taskDashboard.string_16')}</th><th>{t('pages.taskDashboard.string_17')}</th><th /></tr></thead><tbody>{dashboard.recentArtifacts.map((artifact) => <tr key={artifact.id}>
          <td className="run-name"><strong>{artifact.name ?? artifact.path}</strong><span>{artifact.path} · {formatDate(artifact.createdAt)}</span></td>
          <td>{artifact.type}</td>
          <td>{formatNumber(artifact.sizeBytes)} B</td>
          <td><Link className="icon-link" to="/artifacts"><ArrowUpRight size={15} /></Link></td>
        </tr>)}</tbody></table></div>
      </div>
    </div>
    <div className="panel">
      <div className="panel-title"><ShieldCheck size={15} />{t('pages.taskDashboard.string_18')}<span>preflight / postflight</span></div>
      <div className="workbench-risk-strip">
        <span>{t('pages.taskDashboard.string_19')}<b>{percent(dashboard.metrics.preflightFailureRate)}</b></span>
        <span>{t('pages.taskDashboard.string_20')}<b>{percent(dashboard.metrics.postflightFailureRate)}</b></span>
        <span>{t('pages.taskDashboard.string_21')}<b>{dashboard.totals.approvals}</b></span>
        <span>{t('pages.taskDashboard.string_22')}<b>{dashboard.totals.pendingApprovals}</b></span>
      </div>
    </div>
  </section>;
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}
