import { Activity, AppWindow, Beaker, Braces, Cable, FileText, GitCompareArrows, MessageSquareText, PlayCircle, Radar, ScrollText, ServerCog, ShieldCheck, TerminalSquare } from 'lucide-react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { RunsPage } from './pages/RunsPage.tsx';
import { TracePage } from './pages/TracePage.tsx';
import { ConversationPage } from './pages/ConversationPage.tsx';
import { ContextPage } from './pages/ContextPage.tsx';
import { ToolConsolePage } from './pages/ToolConsolePage.tsx';
import { PromptLabPage } from './pages/PromptLabPage.tsx';
import { EvalBenchPage } from './pages/EvalBenchPage.tsx';
import { ComparePage } from './pages/ComparePage.tsx';
import { SkillDebuggerPage } from './pages/SkillDebuggerPage.tsx';
import { RuntimePage } from './pages/RuntimePage.tsx';
import { ModelProvidersPage } from './pages/ModelProvidersPage.tsx';
import { EvalRunDetailPage } from './pages/EvalRunDetailPage.tsx';
import { EvalResultDetailPage } from './pages/EvalResultDetailPage.tsx';
import { ReleaseGatesPage } from './pages/ReleaseGatesPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';
import { EvalCaseDetailPage } from './pages/EvalCaseDetailPage.tsx';

const nav = [
  ['/runtime', PlayCircle, 'Live Runtime'],
  ['/providers', ServerCog, 'Model Providers'],
  ['/', Activity, 'Runs'],
  ['/conversation', MessageSquareText, 'Conversation'],
  ['/context', Braces, 'Context'],
  ['/tools', TerminalSquare, 'Tools'],
  ['/prompts', ScrollText, 'Prompt Lab'],
  ['/skills', Cable, 'Skills'],
  ['/evals', Beaker, 'Eval Bench'],
  ['/compare', GitCompareArrows, 'Compare'],
  ['/gates', ShieldCheck, 'Release Gates'],
  ['/reports', FileText, 'Reports']
] as const;

export function App() {
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><Radar size={22} /></div>
        <div><strong>JARVIS</strong><span>STUDIO / v0.3</span></div>
      </div>
      <div className="system-state"><i /><span>LOCAL OBSERVATORY</span><b>ONLINE</b></div>
      <nav>{nav.map(([to, Icon, label]) =>
        <NavLink key={to} to={to} end={to === '/'}><Icon size={16} /><span>{label}</span></NavLink>
      )}</nav>
      <footer><AppWindow size={14} /><span>Evaluation Gate</span><b>0.3</b></footer>
    </aside>
    <main className="workspace">
      <div className="topline"><span>AGENT ENGINEERING CONTROL PLANE</span><span className="topline-id">LOCAL://4310</span></div>
      <Routes>
        <Route path="/runtime" element={<RuntimePage />} />
        <Route path="/providers" element={<ModelProvidersPage />} />
        <Route path="/" element={<RunsPage />} />
        <Route path="/runs/:runId" element={<TracePage />} />
        <Route path="/conversation" element={<ConversationPage />} />
        <Route path="/context" element={<ContextPage />} />
        <Route path="/context/:snapshotId" element={<ContextPage />} />
        <Route path="/tools" element={<ToolConsolePage />} />
        <Route path="/prompts" element={<PromptLabPage />} />
        <Route path="/skills" element={<SkillDebuggerPage />} />
        <Route path="/evals" element={<EvalBenchPage />} />
        <Route path="/evals/runs/:evalRunId" element={<EvalRunDetailPage />} />
        <Route path="/evals/cases/:caseId" element={<EvalCaseDetailPage />} />
        <Route path="/evals/results/:resultId" element={<EvalResultDetailPage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/gates" element={<ReleaseGatesPage />} />
        <Route path="/reports" element={<ReportsPage />} />
      </Routes>
    </main>
  </div>;
}
