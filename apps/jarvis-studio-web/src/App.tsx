import { lazy, Suspense } from 'react';
import { Activity, AlertTriangle, AppWindow, Beaker, Bot, Boxes, Braces, Cable, ClipboardList, FileArchive, FileText, FolderOpen, GitCompareArrows, Globe, Grid3X3, Layers, LockKeyhole, MessageSquareText, Moon, PlayCircle, Radar, ScrollText, ServerCog, Settings, ShieldCheck, SlidersHorizontal, Sun, TerminalSquare, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { Loading } from './components/Primitives.tsx';
import { useTheme } from './hooks/useTheme.ts';

const AgentsPage = lazy(() => import('./pages/AgentsPage.tsx').then((module) => ({ default: module.AgentsPage })));
const PlaygroundPage = lazy(() => import('./pages/PlaygroundPage.tsx').then((module) => ({ default: module.PlaygroundPage })));
const CasesPage = lazy(() => import('./pages/CasesPage.tsx').then((module) => ({ default: module.CasesPage })));
const EvaluationsPage = lazy(() => import('./pages/EvaluationsPage.tsx').then((module) => ({ default: module.EvaluationsPage })));
const EvaluationSuiteDetailPage = lazy(() => import('./pages/EvaluationSuiteDetailPage.tsx').then((module) => ({ default: module.EvaluationSuiteDetailPage })));
const LightEvalRunDetailPage = lazy(() => import('./pages/LightEvalRunDetailPage.tsx').then((module) => ({ default: module.LightEvalRunDetailPage })));
const RunsPage = lazy(() => import('./pages/RunsPage.tsx').then((module) => ({ default: module.RunsPage })));
const TracePage = lazy(() => import('./pages/TracePage.tsx').then((module) => ({ default: module.TracePage })));
const ConversationPage = lazy(() => import('./pages/ConversationPage.tsx').then((module) => ({ default: module.ConversationPage })));
const ContextPage = lazy(() => import('./pages/ContextPage.tsx').then((module) => ({ default: module.ContextPage })));
const ToolConsolePage = lazy(() => import('./pages/ToolConsolePage.tsx').then((module) => ({ default: module.ToolConsolePage })));
const PromptLabPage = lazy(() => import('./pages/PromptLabPage.tsx').then((module) => ({ default: module.PromptLabPage })));
const PromptComparePage = lazy(() => import('./pages/PromptComparePage.tsx').then((module) => ({ default: module.PromptComparePage })));
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

const navGroups: Array<{ labelKey: string; items: Array<[string, StudioIcon, string]> }> = [
  { labelKey: 'nav.groupPromptOps', items: [['/agents', Bot, 'nav.agents'], ['/prompts', ScrollText, 'nav.prompts'], ['/playground', PlayCircle, 'nav.playground'], ['/runs', Activity, 'nav.runs'], ['/cases', ClipboardList, 'nav.cases'], ['/evaluations', Beaker, 'nav.evaluations'], ['/settings', Settings, 'nav.settings']] }
];

const settingsSections: Array<{ titleKey: string; descriptionKey: string; links: Array<[string, StudioIcon, string, string]> }> = [
  {
    titleKey: 'pages.settings.sections.advanced.title',
    descriptionKey: 'pages.settings.sections.advanced.description',
    links: [
      ['/evals/advanced', Beaker, 'nav.evalBench', 'pages.settings.sections.advanced.evalBenchMeta'],
      ['/workspaces', FolderOpen, 'nav.evalWorkspaces', 'pages.settings.sections.advanced.workspacesMeta'],
      ['/scenarios', Layers, 'nav.scenarioTemplates', 'pages.settings.sections.advanced.scenariosMeta'],
      ['/tasks', ClipboardList, 'nav.workbenchTasks', 'pages.settings.sections.advanced.tasksMeta'],
      ['/gates', ShieldCheck, 'nav.releaseGates', 'pages.settings.sections.advanced.gatesMeta'],
      ['/reports', FileText, 'nav.reports', 'pages.settings.sections.advanced.reportsMeta']
    ]
  },
  {
    titleKey: 'pages.settings.sections.capabilities.title',
    descriptionKey: 'pages.settings.sections.capabilities.description',
    links: [
      ['/providers', ServerCog, 'nav.providerProfiles', 'pages.settings.sections.capabilities.providersMeta'],
      ['/skills', Cable, 'nav.skillRegistry', 'pages.settings.sections.capabilities.skillsMeta'],
      ['/tools', Boxes, 'nav.toolRegistry', 'pages.settings.sections.capabilities.toolsMeta']
    ]
  },
  {
    titleKey: 'pages.settings.sections.governance.title',
    descriptionKey: 'pages.settings.sections.governance.description',
    links: [
      ['/runtime', PlayCircle, 'nav.runtimeAdapter', 'pages.settings.sections.governance.runtimeMeta'],
      ['/tool-calls', TerminalSquare, 'nav.toolCalls', 'pages.settings.sections.governance.toolCallsMeta'],
      ['/artifacts', FileArchive, 'nav.artifacts', 'pages.settings.sections.governance.artifactsMeta'],
      ['/approvals', LockKeyhole, 'nav.runtimeApprovals', 'pages.settings.sections.governance.approvalsMeta'],
      ['/context', Braces, 'nav.contextBudget', 'pages.settings.sections.governance.contextMeta'],
      ['/context-strategies', SlidersHorizontal, 'nav.policyPresets', 'pages.settings.sections.governance.strategiesMeta']
    ]
  },
  {
    titleKey: 'pages.settings.sections.experiments.title',
    descriptionKey: 'pages.settings.sections.experiments.description',
    links: [
      ['/failures', AlertTriangle, 'nav.failureDiagnosis', 'pages.settings.sections.experiments.failuresMeta'],
      ['/experiments', Grid3X3, 'nav.experimentMatrix', 'pages.settings.sections.experiments.experimentsMeta'],
      ['/compare', GitCompareArrows, 'nav.regressionCompare', 'pages.settings.sections.experiments.compareMeta'],
      ['/task-dashboard', Activity, 'nav.legacyDashboard', 'pages.settings.sections.experiments.dashboardMeta'],
      ['/task-compare', GitCompareArrows, 'nav.taskCompare', 'pages.settings.sections.experiments.taskCompareMeta']
    ]
  }
];


export function App() {
  const { t, i18n } = useTranslation();
  const { theme, toggle: toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><Radar size={22} /></div>
        <div><strong>{t('shell.brand')}</strong><span>STUDIO / v{t('shell.version')}</span></div>
      </div>
      <div className="system-state"><i /><span>{t('shell.mode')}</span><b>{t('shell.online')}</b></div>
      <nav>{navGroups.map((group) => <div className="nav-group" key={group.labelKey}>
        <span>{t(group.labelKey)}</span>
        {group.items.map(([to, Icon, key]) =>
          <NavLink key={to} to={to} end={to === '/'}><Icon size={16} /><span>{t(key)}</span></NavLink>
        )}
      </div>)}</nav>
      <footer>
        <AppWindow size={14} />
        <span>{t('shell.footer')}</span>
        <button
          type="button"
          className="lang-toggle"
          onClick={() => {
            const nextLng = i18n.language.startsWith('zh') ? 'en' : 'zh';
            void i18n.changeLanguage(nextLng);
          }}
          aria-label={t('shell.toggleLanguage')}
          title={t('shell.toggleLanguage')}
        >
          <Globe size={13} />
        </button>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={isDark ? t('shell.toggleThemeLight') : t('shell.toggleThemeDark')}
          title={isDark ? t('shell.toggleThemeLight') : t('shell.toggleThemeDark')}
        >
          {isDark ? <Sun size={13} /> : <Moon size={13} />}
        </button>
        <b>{t('shell.version')}</b>
      </footer>
    </aside>
    <main className="workspace">
      <div className="topline"><span>{t('shell.toplineTitle')}</span><span className="topline-id">{t('shell.toplineId')}</span></div>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Navigate to="/agents" replace />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:agentId" element={<AgentsPage />} />
          <Route path="/prompts" element={<PromptLabPage />} />
          <Route path="/prompts/:promptId" element={<PromptLabPage />} />
          <Route path="/prompts/:promptId/compare" element={<PromptComparePage />} />
          <Route path="/playground" element={<PlaygroundPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/:runId" element={<TracePage />} />
          <Route path="/conversation" element={<ConversationPage />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/evaluations" element={<EvaluationsPage />} />
          <Route path="/evaluations/runs/:evalRunId" element={<LightEvalRunDetailPage />} />
          <Route path="/evaluations/:suiteId" element={<EvaluationSuiteDetailPage />} />
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
  const { t } = useTranslation();
  return <section>
    <header className="page-header">
      <div><span className="eyebrow">{t('pages.settings.subtitle')}</span><h1>{t('pages.settings.title')}</h1><p>{t('pages.settings.description')}</p></div>
    </header>
    <div className="system-settings-grid">
      {settingsSections.map((section) => <article className="panel settings-section" key={section.titleKey}>
        <div className="panel-title">{t(section.titleKey)}<span>{section.links.length}</span></div>
        <p>{t(section.descriptionKey)}</p>
        <div>{section.links.map(([to, Icon, labelKey, metaKey]) => <Link key={to} to={to}><Icon size={16} /><span><strong>{t(labelKey)}</strong><em>{t(metaKey)}</em></span></Link>)}</div>
      </article>)}
    </div>
  </section>;
}

