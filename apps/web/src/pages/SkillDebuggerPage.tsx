import { useEffect, useMemo, useState } from 'react';
import { Cable, CheckCircle2, KeyRound, Wrench } from 'lucide-react';
import { api } from '../api.ts';
import { Empty, PageHeader } from '../components/Primitives.tsx';

interface Run { id: string; name: string; skillVersions: string[]; toolCallCount: number; promptVersion?: string; status: string }
export function SkillDebuggerPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  useEffect(() => { void api<Run[]>('/api/runs').then(setRuns); }, []);
  const skills = useMemo(() => [...new Set(runs.flatMap((run) => run.skillVersions))], [runs]);
  return <section>
    <PageHeader eyebrow="09 / SKILL DEBUGGER" title="Skill Selection Signals" description="从已记录 Run 反查命中的 Skill、版本绑定、工具开放和执行结果。" />
    {skills.length === 0 ? <Empty>当前 Run 没有绑定 Skill 版本。</Empty> : <div className="skill-grid">{skills.map((skill) => {
      const bound = runs.filter((run) => run.skillVersions.includes(skill));
      const success = bound.filter((run) => run.status === 'success').length / bound.length;
      return <article className="skill-card" key={skill}><div className="skill-head"><Cable size={18} /><span>SELECTED SKILL</span><CheckCircle2 size={16} /></div><h2>{skill}</h2><p>命中原因：Run 显式绑定此 Skill 版本，Trace Collector 已保留版本关系。</p><div className="skill-stats"><span>BOUND RUNS<b>{bound.length}</b></span><span>SUCCESS<b>{(success * 100).toFixed(0)}%</b></span><span>TOOL CALLS<b>{bound.reduce((sum, run) => sum + run.toolCallCount, 0)}</b></span></div><div className="skill-footer"><span><Wrench size={13} />工具由 Run Trace 记录</span><span><KeyRound size={13} />权限在 Tool Console 审查</span></div></article>;
    })}</div>}
  </section>;
}
