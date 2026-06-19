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
  const loadDashboard = useCallback((signal: AbortSignal) => api<Dashboard>('/api/workbench/dashboard', { signal }), []);
  const dashboardResource = useAsyncResource(loadDashboard, [], true, { queryKey: ['workbench-dashboard'] });
  const dashboard = dashboardResource.data;
  if (!dashboard) return <Loading />;
  const statusEntries = Object.entries(dashboard.statusCounts).sort((left, right) => right[1] - left[1]);
  return <section>
    <PageHeader eyebrow="V0.5 / Eval Dashboard" title="测试任务大盘" description="追踪测试任务完成率、运行产物生成率、运行审批通过率，以及 Preflight/Postflight 失败率，用于评估不同模型、Prompt、Skill、Tool 和上下文策略的表现。"
      actions={<span className="eyebrow">UPDATED {formatDate(dashboard.generatedAt)}</span>} />
    {dashboardResource.error && <div className="notice warning">{dashboardResource.error}</div>}
    <div className="metric-grid">
      <Metric label="测试任务完成率" value={percent(dashboard.metrics.taskCompletionRate)} tone="green" />
      <Metric label="运行产物生成率" value={percent(dashboard.metrics.artifactGenerationRate)} tone="cyan" />
      <Metric label="运行审批通过率" value={percent(dashboard.metrics.approvalPassRate)} tone="amber" />
      <Metric label="平均测试评分" value={dashboard.metrics.averageTaskScore == null ? '—' : dashboard.metrics.averageTaskScore.toFixed(2)} />
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
        <div className="panel-title"><Gauge size={15} />状态分布 <span>{dashboard.totals.tasks} tasks</span></div>
        <div className="status-ledger">
          {statusEntries.length ? statusEntries.map(([status, count]) => <div key={status}><StatusBadge status={status} /><strong>{count}</strong></div>) : <Empty>暂无测试任务状态。</Empty>}
        </div>
      </div>
      <div className="panel">
        <div className="panel-title"><Layers size={15} />评测场景健康度 <span>{dashboard.scenarioStats.length}</span></div>
        <div className="table-wrap flush"><table><thead><tr><th>Scenario</th><th>测试任务</th><th>成功率</th><th>运行产物</th><th>失败</th></tr></thead><tbody>{dashboard.scenarioStats.map((item) => <tr key={item.id}>
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
        <div className="panel-title"><ClipboardList size={15} />最近测试任务 <span>{dashboard.recentTasks.length}</span></div>
        <div className="table-wrap flush"><table><thead><tr><th>Test Task</th><th>状态</th><th>评分</th><th /></tr></thead><tbody>{dashboard.recentTasks.map((task) => <tr key={task.id}>
          <td className="run-name"><strong>{task.title}</strong><span>{task.workspaceName ?? task.workspaceId} · {task.scenarioName ?? task.scenarioTemplateId ?? '无场景'} · {formatDate(task.updatedAt)}</span></td>
          <td><StatusBadge status={task.status} /></td>
          <td className="score">{task.score ?? '—'}</td>
          <td><Link className="icon-link" to="/tasks"><ArrowUpRight size={15} /></Link></td>
        </tr>)}</tbody></table></div>
      </div>
      <div className="panel">
        <div className="panel-title"><FileArchive size={15} />最近运行产物 <span>{dashboard.recentArtifacts.length}</span></div>
        <div className="table-wrap flush"><table><thead><tr><th>Run Artifact</th><th>类型</th><th>大小</th><th /></tr></thead><tbody>{dashboard.recentArtifacts.map((artifact) => <tr key={artifact.id}>
          <td className="run-name"><strong>{artifact.name ?? artifact.path}</strong><span>{artifact.path} · {formatDate(artifact.createdAt)}</span></td>
          <td>{artifact.type}</td>
          <td>{formatNumber(artifact.sizeBytes)} B</td>
          <td><Link className="icon-link" to="/artifacts"><ArrowUpRight size={15} /></Link></td>
        </tr>)}</tbody></table></div>
      </div>
    </div>
    <div className="panel">
      <div className="panel-title"><ShieldCheck size={15} />失败率与审批队列 <span>preflight / postflight</span></div>
      <div className="workbench-risk-strip">
        <span>Preflight 失败率<b>{percent(dashboard.metrics.preflightFailureRate)}</b></span>
        <span>Postflight 失败率<b>{percent(dashboard.metrics.postflightFailureRate)}</b></span>
        <span>运行审批总数<b>{dashboard.totals.approvals}</b></span>
        <span>待运行审批<b>{dashboard.totals.pendingApprovals}</b></span>
      </div>
    </div>
  </section>;
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}
