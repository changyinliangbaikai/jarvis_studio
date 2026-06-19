import { useCallback, useMemo, useState } from 'react';
import { Cable, CheckCircle2, ChevronLeft, FlaskConical, KeyRound, Power, Wrench } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, JsonView, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import type { LooseJsonObject } from '../types/json.ts';
import { formatDate, formatNumber } from '../utils/format.ts';

interface Skill {
  id: string;
  name: string;
  version: string;
  status: string;
  category?: string;
  description?: string;
  manifest: LooseJsonObject;
  instructionText?: string;
  hitCount: number;
  successRate: number;
  avgScore: number;
  toolErrorRate: number;
  failureCount: number;
  lastUsedAt?: string;
}
interface SkillDetail extends Skill {
  versions: Array<{ id: string; version: string; createdAt: string; manifest: unknown }>;
  selectionEvents: Array<{ id: string; runId: string; candidates: Array<{ skillId: string; score: number; matchedBy: string[]; status: string }>; createdAt: string }>;
  runs: Array<{ id: string; name: string; status: string; score?: number }>;
  failures: Array<{ id: string; type: string; severity: string; status: string; summary?: string }>;
}

export function SkillDebuggerPage() {
  const { skillId } = useParams();
  const [testResult, setTestResult] = useState<{ runId: string; status: string; output?: string; error?: string; eventCount: number; toolCalls: Array<{ name: string; success: boolean }> }>();
  const [busy, setBusy] = useState('');
  const load = useCallback((signal: AbortSignal) => api<Skill[]>('/api/skills', { signal }), []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['skills'] });
  const skills = resource.data;
  const selected = useMemo(() => skills?.find((skill) => skill.id === skillId) ?? skills?.[0], [skills, skillId]);
  const loadDetail = useCallback((signal: AbortSignal) => selected ? api<SkillDetail>(`/api/skills/${selected.id}`, { signal }) : Promise.resolve(undefined), [selected?.id]);
  const detailResource = useAsyncResource<SkillDetail | undefined>(loadDetail, [selected?.id], Boolean(selected?.id), { queryKey: ['skill-detail', selected?.id] });
  const detail = detailResource.data;

  const toggle = async (skill: Skill) => {
    setBusy(skill.id);
    try {
      await post(`/api/skills/${skill.id}/${skill.status === 'enabled' ? 'disable' : 'enable'}`, {});
      await resource.reload();
      await detailResource.reload();
    } finally {
      setBusy('');
    }
  };
  const runSkillTest = async (skill: Skill) => {
    setBusy(`test:${skill.id}`);
    try {
      setTestResult(await post(`/api/skills/${skill.id}/test`, {}));
      await resource.reload();
      await detailResource.reload();
    } finally {
      setBusy('');
    }
  };

  if (!skills) return <Loading />;
  return <section>
    {skillId && <Link to="/skills" className="back-link"><ChevronLeft size={14} />返回 Skill Registry</Link>}
    <PageHeader eyebrow="V0.4 / Skill Registry" title="能力注册表 (Skill Registry)" description="管理 Skill manifest、版本、启停、命中分析、质量评分、权限声明和关联失败。"
      actions={selected && <><button onClick={() => void runSkillTest(selected)} disabled={busy === `test:${selected.id}`}><FlaskConical size={15} />运行 Skill 测试</button><button onClick={() => void toggle(selected)} disabled={busy === selected.id}><Power size={15} />{selected.status === 'enabled' ? '停用 Skill' : '启用 Skill'}</button></>} />
    {(resource.error || detailResource.error) && <div className="notice warning">{resource.error || detailResource.error}</div>}
    <div className="metric-grid compact">
      <Metric label="SKILLS" value={skills.length} tone="cyan" />
      <Metric label="SUCCESS RATE" value={`${(avg(skills.map((item) => item.successRate)) * 100).toFixed(0)}%`} tone="green" />
      <Metric label="AVG SCORE" value={avg(skills.map((item) => item.avgScore)).toFixed(1)} />
      <Metric label="OPEN FAILURES" value={skills.reduce((sum, item) => sum + item.failureCount, 0)} tone="red" />
      <Metric label="TOOL CALLS" value={formatNumber(skills.reduce((sum, item) => sum + item.hitCount, 0))} />
    </div>
    <div className="registry-layout">
      <div className="panel registry-list">
        <div className="panel-title"><Cable size={15} />Skill 列表 <span>{skills.length}</span></div>
        {skills.map((skill) => <Link key={skill.id} to={`/skills/${skill.id}`} className={selected?.id === skill.id ? 'active' : ''}>
          <StatusBadge status={skill.status} />
          <div><strong>{skill.name}</strong><span>{skill.id} · {skill.version}</span><p>{skill.description}</p></div>
          <aside><b>{(skill.successRate * 100).toFixed(0)}%</b><span>{skill.category ?? 'uncategorized'}</span></aside>
        </Link>)}
      </div>
      {!selected ? <Empty>尚未导入 Skill manifest。</Empty> : !detail ? <Loading /> : <SkillDetailView detail={detail} summary={selected} testResult={testResult} />}
    </div>
  </section>;
}

function SkillDetailView({ detail, summary, testResult }: { detail: SkillDetail; summary: Skill; testResult?: { runId: string; status: string; output?: string; error?: string; eventCount: number; toolCalls: Array<{ name: string; success: boolean }> } }) {
  const hitCount = Number(detail.hitCount ?? summary.hitCount ?? 0);
  const successRate = Number(detail.successRate ?? summary.successRate ?? 0);
  const avgScore = Number(detail.avgScore ?? summary.avgScore ?? 0);
  const toolErrorRate = Number(detail.toolErrorRate ?? summary.toolErrorRate ?? 0);
  const failureCount = Number(detail.failureCount ?? summary.failureCount ?? detail.failures.length);
  return <div className="registry-detail">
        <div className="panel registry-hero">
          <div className="registry-orbit"><FlaskConical size={26} /></div>
          <div><span className="eyebrow">{detail.category ?? 'local'} / {detail.version}</span><h2>{detail.name}</h2><p>{detail.description}</p></div>
          <StatusBadge status={detail.status} />
        </div>
        <div className="registry-facts">
          <span>命中次数<b>{hitCount}</b></span>
          <span>成功率<b>{(successRate * 100).toFixed(1)}%</b></span>
          <span>平均评分<b>{avgScore.toFixed(1)}</b></span>
          <span>工具错误率<b>{(toolErrorRate * 100).toFixed(1)}%</b></span>
          <span>最近命中<b>{formatDate(detail.lastUsedAt)}</b></span>
          <span>失败案例<b>{failureCount}</b></span>
        </div>
        <div className="governance-columns">
          <article className="panel"><div className="panel-title"><Wrench size={15} />工具与权限</div>
            <div className="chip-row">{stringArray(detail.manifest.requiredTools).map((tool) => <span key={tool}><Wrench size={12} />{tool}</span>)}</div>
            <div className="chip-row">{stringArray(detail.manifest.permissions).map((permission) => <span key={permission}><KeyRound size={12} />{permission}</span>)}</div>
          </article>
          <article className="panel"><div className="panel-title"><CheckCircle2 size={15} />版本记录 <span>{detail.versions.length}</span></div>
            {detail.versions.map((version) => <div className="ledger-row" key={version.id}><strong>{version.version}</strong><span>{formatDate(version.createdAt)}</span></div>)}
          </article>
        </div>
        <div className="governance-columns">
          <article className="panel"><div className="panel-title"><Cable size={15} />命中分析</div>
            {detail.selectionEvents.length === 0 ? <Empty>暂无 Skill 选择事件。</Empty> : detail.selectionEvents.slice(0, 5).map((event) => <div className="candidate-ledger" key={event.id}>
              <strong>{event.runId}</strong>
              {event.candidates.map((candidate, index) => <span key={`${candidate.skillId}-${candidate.status}-${index}`} className={candidate.status === 'selected' ? 'selected' : ''}>{candidate.skillId}<b>{candidate.score}</b><em>{candidate.matchedBy.join(', ') || 'no signal'}</em></span>)}
            </div>)}
          </article>
          <article className="panel"><div className="panel-title"><FlaskConical size={15} />失败案例</div>
            {detail.failures.length === 0 ? <Empty>暂无关联 Failure。</Empty> : detail.failures.map((failure) => <div className="ledger-row" key={failure.id}><StatusBadge status={failure.severity} /><strong>{failure.type}</strong><span>{failure.summary}</span></div>)}
          </article>
        </div>
        {testResult && <article className="panel"><div className="panel-title"><FlaskConical size={15} />最近 Skill 测试 <StatusBadge status={testResult.status} /></div>
          <div className="registry-facts">
            <span>Run<b><Link to={`/runs/${testResult.runId}`}>{testResult.runId.slice(0, 18)}</Link></b></span>
            <span>事件数<b>{testResult.eventCount}</b></span>
            <span>工具调用<b>{testResult.toolCalls.length}</b></span>
            <span>状态<b>{testResult.status}</b></span>
          </div>
          <div className="chip-row">{testResult.toolCalls.map((tool, index) => <span key={`${tool.name}-${index}`}><StatusBadge status={tool.success ? 'success' : 'failed'} />{tool.name}</span>)}</div>
          <div className="diagnosis-note">{testResult.error ?? testResult.output}</div>
        </article>}
        {detail.instructionText && <div className="panel"><div className="panel-title"><Cable size={15} />SKILL.md 指令正文</div><pre className="instruction-text">{detail.instructionText}</pre></div>}
        <div className="panel"><div className="panel-title"><Cable size={15} />Manifest</div><JsonView value={detail.manifest} /></div>
      </div>;
}

function avg(values: number[]) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, item) => sum + item, 0) / clean.length : 0;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
