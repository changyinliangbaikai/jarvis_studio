import { lazy, Suspense } from 'react';
import { Activity, AlertTriangle, AppWindow, Beaker, Boxes, Braces, Cable, ClipboardList, FileArchive, FileText, FolderOpen, GitCompareArrows, Grid3X3, Layers, LayoutDashboard, LockKeyhole, MessageSquareText, Moon, PlayCircle, Radar, ScrollText, ServerCog, Settings, ShieldCheck, SlidersHorizontal, Sun, TerminalSquare, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { Loading } from './components/Primitives.tsx';
import { useTheme } from './hooks/useTheme.ts';

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
  { label: '评测大盘', items: [['/task-dashboard', LayoutDashboard, '评测大盘'], ['/task-compare', GitCompareArrows, '任务对比'], ['/gates', ShieldCheck, '发布门禁'], ['/reports', FileText, '评测报告']] },
  { label: '用例与任务', items: [['/workspaces', FolderOpen, '评测空间'], ['/scenarios', Layers, '评测场景'], ['/tasks', ClipboardList, '测试任务']] },
  { label: '运行调试', items: [['/runtime', PlayCircle, '实时运行'], ['/', Activity, '运行记录'], ['/conversation', MessageSquareText, '对话回放'], ['/artifacts', FileArchive, '运行产物']] },
  { label: '系统设置', items: [['/settings', Settings, '系统设置']] }
];

const settingsSections: Array<{ title: string; description: string; links: Array<[string, StudioIcon, string, string]> }> = [
  {
    title: '能力与服务商',
    description: '模型服务商、Skill 与 Tool Registry 属于低频治理入口，集中在这里维护。',
    links: [['/providers', ServerCog, '模型服务商', 'Provider profiles'], ['/skills', Cable, 'Skill Registry', '技能注册表'], ['/tools', Boxes, 'Tool Registry', '工具注册表']]
  },
  {
    title: '运行治理',
    description: '审批、工具调用和上下文策略用于排查运行边界与权限策略。',
    links: [['/tool-calls', TerminalSquare, '工具调用', 'Tool calls'], ['/approvals', LockKeyhole, '运行审批', 'Runtime approvals'], ['/context', Braces, 'Context Budget', '上下文预算'], ['/context-strategies', SlidersHorizontal, '预算策略', 'Policy presets']]
  },
  {
    title: '实验与质量',
    description: '批量 Eval、Prompt 实验、Failure 诊断和实验矩阵保留原路由，在系统设置页进入。',
    links: [['/evals', Beaker, '评测工作台', 'Eval bench'], ['/prompts', ScrollText, 'Prompt 实验室', 'Prompt lab'], ['/failures', AlertTriangle, 'Failure 诊断', 'Failure diagnosis'], ['/experiments', Grid3X3, '实验矩阵', 'Experiment matrix'], ['/compare', GitCompareArrows, '回归对比', 'Regression compare']]
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
        <div><strong>{t('shell.brand')}</strong><span>STUDIO / v0.5</span></div>
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
        <b>0.5</b>
      </footer>
    </aside>
    <main className="workspace">
      <div className="topline"><span>{t('shell.tagline')}</span><span className="topline-id">{t('shell.endpoint')}</span></div>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/task-dashboard" element={<TaskDashboardPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/artifacts" element={<ArtifactsPage />} />
          <Route path="/scenarios" element={<ScenariosPage />} />
          <Route path="/task-compare" element={<TaskComparePage />} />
          <Route path="/settings" element={<SystemSettingsPage />} />
          <Route path="/runtime" element={<RuntimePage />} />
          <Route path="/providers" element={<ModelProvidersPage />} />
          <Route path="/" element={<RunsPage />} />
          <Route path="/runs/:runId" element={<TracePage />} />
          <Route path="/conversation" element={<ConversationPage />} />
          <Route path="/context" element={<ContextPage />} />
          <Route path="/context/:snapshotId" element={<ContextPage />} />
          <Route path="/context-strategies" element={<ContextStrategiesPage />} />
          <Route path="/tools" element={<ToolRegistryPage />} />
          <Route path="/tool-calls" element={<ToolConsolePage />} />
          <Route path="/prompts" element={<PromptLabPage />} />
          <Route path="/skills" element={<SkillDebuggerPage />} />
          <Route path="/skills/:skillId" element={<SkillDebuggerPage />} />
          <Route path="/evals" element={<EvalBenchPage />} />
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
      <div><span className="eyebrow">System Settings</span><h1>系统设置</h1><p>低频管理页面集中入口。核心评测工作流保留在侧栏，其余治理、策略和实验页面从这里进入。</p></div>
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
