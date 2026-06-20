import { lazy, Suspense } from 'react';
import { Activity, AlertTriangle, AppWindow, Beaker, Bot, Boxes, Braces, Cable, ClipboardList, FileArchive, FileText, FolderOpen, GitCompareArrows, Grid3X3, Layers, LockKeyhole, MessageSquareText, Moon, PlayCircle, Radar, ScrollText, ServerCog, Settings, ShieldCheck, SlidersHorizontal, Sun, TerminalSquare, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { Loading } from './components/Primitives.tsx';
import { useTheme } from './hooks/useTheme.ts';

const AgentsPage = lazy(() => import('./pages/AgentsPage.tsx').then((module) => ({ default: module.AgentsPage })));
const PlaygroundPage = lazy(() => import('./pages/PlaygroundPage.tsx').then((module) => ({ default: module.PlaygroundPage })));
const CasesPage = lazy(() => import('./pages/CasesPage.tsx').then((module) => ({ default: module.CasesPage })));
const EvaluationsPage = lazy(() => import('./pages/EvaluationsPage.tsx').then((module) => ({ default: module.EvaluationsPage })));
const RunsPage = lazy(() => import('./pages/RunsPage.tsx').then((module) => ({ default: module.RunsPage })));
const TracePage = lazy(() => import('./pages/TracePage.tsx').then((module) => ({ default: module.TracePage })));
const ConversationPage = lazy(() => import('./pages/ConversationPage.tsx').then((module) => ({ default: module.ConversationPage })));
const ContextPage = lazy(() => import('./pages/ContextPage.tsx').then((module) => ({ default: module.ContextPage })));
const ToolConsolePage = lazy(() => import('./pages/ToolConsolePage.tsx').then((module) => ({ default: module.ToolConsolePage })));
const PromptLabPage = lazy(() => import('./pages/PromptLabPage.tsx').then((module) => ({ default: module.PromptLabPage })));
const EvalBenchPage = lazy(() => import('./pages/EvalBenchPage.tsx').then((module) => ({ default: module.EvalBenchPage })));
const ComparePage = lazy(() => import('./pages/ComparePage.tsx').then((module) => ({ default: module.ComparePage })));
const SkillDebuggerPage = lazy(() => import('./pages/SkillDebuggerPage.tsx').then((module) => ({ default: module.SkillDebuggerPage })));
const RuntimePage = lazy(() => import('./pages/RuntimePage.tsx').then((module) => ({ default: module.RuntimePage })));
const ModelProvidersPage = lazy(() => import('./pages/ModelProvidersPage.tsx').then((module) => ({ default: module.ModelProvidersPage })));
const EvalRunDetailPage = lazy(() => import('./pages/EvalRunDetailPage.tsx').then((module) => ({ default: module.EvalRunDetailPage })));
const EvalResultDetailPage = lazy(() => import('./pages/EvalResultDetailPage.tsx').then((module) => ({ default: module.EvalResultDetailPage })));
const ReleaseGatesPage = lazy(() => import('./pages/ReleaseGatesPage.tsx').then((module) => ({ default: module.ReleaseGatesPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage.tsx').then((module) => ({ default: module.ReportsPage })));
const EvalCaseDetailPage = lazy(() => import('./pages/EvalCaseDetailPage.tsx').then((module) => ({ default: module.EvalCaseDetailPage })));
const ToolRegistryPage = lazy(() => import('./pages/ToolRegistryPage.tsx').then((module) => ({ default: module.ToolRegistryPage })));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage.tsx').then((module) => ({ default: module.ApprovalsPage })));
const FailuresPage = lazy(() => import('./pages/FailuresPage.tsx').then((module) => ({ default: module.FailuresPage })));
const ExperimentsPage = lazy(() => import('./pages/ExperimentsPage.tsx').then((module) => ({ default: module.ExperimentsPage })));
const ContextStrategiesPage = lazy(() => import('./pages/ContextStrategiesPage.tsx').then((module) => ({ default: module.ContextStrategiesPage })));
const WorkspacesPage = lazy(() => import('./pages/WorkspacesPage.tsx').then((module) => ({ default: module.WorkspacesPage })));
const TasksPage = lazy(() => import('./pages/TasksPage.tsx').then((module) => ({ default: module.TasksPage })));
const ArtifactsPage = lazy(() => import('./pages/ArtifactsPage.tsx').then((module) => ({ default: module.ArtifactsPage })));
const ScenariosPage = lazy(() => import('./pages/ScenariosPage.tsx').then((module) => ({ default: module.ScenariosPage })));
const TaskDashboardPage = lazy(() => import('./pages/TaskDashboardPage.tsx').then((module) => ({ default: module.TaskDashboardPage })));
const TaskComparePage = lazy(() => import('./pages/TaskComparePage.tsx').then((module) => ({ default: module.TaskComparePage })));

type StudioIcon = LucideIcon;

const navGroups: Array<{ label: string; items: Array<[string, StudioIcon, string]> }> = [
  { label: '设计与调试', items: [['/', Bot, 'Agents'], ['/prompts', ScrollText, 'Prompts'], ['/playground', PlayCircle, 'Playground']] },
  { label: '观察与沉淀', items: [['/runs', Activity, 'Runs / Trace'], ['/conversation', MessageSquareText, '对话回放'], ['/cases', ClipboardList, 'Cases']] },
  { label: '评测与设置', items: [['/evaluations', Beaker, 'Evaluations'], ['/settings', Settings, 'Settings']] }
];

const settingsSections: Array<{ title: string; description: string; links: Array<[string, StudioIcon, string, string]> }> = [
  {
    title: '高级评测',
    description: '原 v0.5 的评测空间、场景、任务、发布门禁与报告保留为高级入口，避免干扰日常 Prompt 调试。',
    links: [['/evals/advanced', Beaker, '评测工作台', 'Eval bench'], ['/workspaces', FolderOpen, '评测空间', 'Eval workspaces'], ['/scenarios', Layers, '评测场景', 'Scenario templates'], ['/tasks', ClipboardList, '测试任务', 'Workbench tasks'], ['/gates', ShieldCheck, '发布门禁', 'Release gates'], ['/reports', FileText, '评测报告', 'Reports']]
  },
  {
    title: '能力与服务商',
    description: '模型服务商、Skill 与 Tool Registry 属于低频治理入口，集中在这里维护。',
    links: [['/providers', ServerCog, '模型服务商', 'Provider profiles'], ['/skills', Cable, 'Skill Registry', '技能注册表'], ['/tools', Boxes, 'Tool Registry', '工具注册表']]
  },
  {
    title: '运行治理',
    description: '审批、工具调用和上下文策略用于排查运行边界与权限策略。',
    links: [['/runtime', PlayCircle, '实时运行', 'Runtime adapter'], ['/tool-calls', TerminalSquare, '工具调用', 'Tool calls'], ['/artifacts', FileArchive, '运行产物', 'Artifacts'], ['/approvals', LockKeyhole, '运行审批', 'Runtime approvals'], ['/context', Braces, 'Context Budget', '上下文预算'], ['/context-strategies', SlidersHorizontal, '预算策略', 'Policy presets']]
  },
  {
    title: '实验与诊断',
    description: 'Failure 诊断、实验矩阵和回归对比保留原路由，但不再作为主工作流入口。',
    links: [['/failures', AlertTriangle, 'Failure 诊断', 'Failure diagnosis'], ['/experiments', Grid3X3, '实验矩阵', 'Experiment matrix'], ['/compare', GitCompareArrows, '回归对比', 'Regression compare'], ['/task-dashboard', Activity, '评测大盘', 'Legacy dashboard'], ['/task-compare', GitCompareArrows, '任务对比', 'Task compare']]
  }
];

export function App() {
  const { t } = useTranslation();
  const { theme, toggle: toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><Radar size={22} /></div>
        <div><strong>{t('shell.brand')}</strong><span>STUDIO / v0.6</span></div>
      </div>
      <div className="system-state"><i /><span>{t('shell.mode')}</span><b>{t('shell.online')}</b></div>
      <nav>{navGroups.map((group) => <div className="nav-group" key={group.label}>
        <span>{group.label}</span>
        {group.items.map(([to, Icon, label]) =>
          <NavLink key={to} to={to} end={to === '/'}><Icon size={16} /><span>{label}</span></NavLink>
        )}
      </div>)}</nav>
      <footer>
        <AppWindow size={14} />
        <span>{t('shell.footer')}</span>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
          title={isDark ? '切换到浅色模式' : '切换到深色模式'}
        >
          {isDark ? <Sun size={13} /> : <Moon size={13} />}
        </button>
        <b>0.6</b>
      </footer>
    </aside>
    <main className="workspace">
      <div className="topline"><span>Prompt-first Agent 工作台</span><span className="topline-id">Agent → Prompt → Playground → Trace → Case → Eval</span></div>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<AgentsPage />} />
          <Route path="/prompts" element={<PromptLabPage />} />
          <Route path="/playground" element={<PlaygroundPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/:runId" element={<TracePage />} />
          <Route path="/conversation" element={<ConversationPage />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/evaluations" element={<EvaluationsPage />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/task-dashboard" element={<TaskDashboardPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/artifacts" element={<ArtifactsPage />} />
          <Route path="/scenarios" element={<ScenariosPage />} />
          <Route path="/task-compare" element={<TaskComparePage />} />
          <Route path="/settings" element={<SystemSettingsPage />} />
          <Route path="/runtime" element={<RuntimePage />} />
          <Route path="/providers" element={<ModelProvidersPage />} />
          <Route path="/context" element={<ContextPage />} />
          <Route path="/context/:snapshotId" element={<ContextPage />} />
          <Route path="/context-strategies" element={<ContextStrategiesPage />} />
          <Route path="/tools" element={<ToolRegistryPage />} />
          <Route path="/tool-calls" element={<ToolConsolePage />} />
          <Route path="/skills" element={<SkillDebuggerPage />} />
          <Route path="/skills/:skillId" element={<SkillDebuggerPage />} />
          <Route path="/evals/advanced" element={<EvalBenchPage />} />
          <Route path="/evals" element={<EvaluationsPage />} />
          <Route path="/evals/runs/:evalRunId" element={<EvalRunDetailPage />} />
          <Route path="/evals/cases/:caseId" element={<EvalCaseDetailPage />} />
          <Route path="/evals/results/:resultId" element={<EvalResultDetailPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/gates" element={<ReleaseGatesPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/failures" element={<FailuresPage />} />
          <Route path="/failures/:failureId" element={<FailuresPage />} />
          <Route path="/experiments" element={<ExperimentsPage />} />
        </Routes>
      </Suspense>
    </main>
  </div>;
}

function SystemSettingsPage() {
  return <section>
    <header className="page-header">
      <div><span className="eyebrow">System Settings</span><h1>系统设置 / Advanced</h1><p>主侧栏只保留日常 Agent 设计闭环；低频治理、评测空间、报告和 Runtime 管理统一收敛到这里。</p></div>
    </header>
    <div className="system-settings-grid">
      {settingsSections.map((section) => <article className="panel settings-section" key={section.title}>
        <div className="panel-title">{section.title}<span>{section.links.length}</span></div>
        <p>{section.description}</p>
        <div>{section.links.map(([to, Icon, label, meta]) => <Link key={to} to={to}><Icon size={16} /><span><strong>{label}</strong><em>{meta}</em></span></Link>)}</div>
      </article>)}
    </div>
  </section>;
}
