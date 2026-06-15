import { useEffect, useState } from 'react';
import { Bot, FileOutput, MessageCircle, TerminalSquare, UserRound } from 'lucide-react';
import { api, formatDate } from '../api.ts';
import { Empty, Loading, PageHeader, StatusBadge } from '../components/Primitives.tsx';

interface Session { id: string; title: string; status: string; startedAt: string }
interface Turn {
  id: string; index: number; userMessage: string; assistantMessage?: string; status: string; startedAt: string;
  tools: Array<{ id: string; toolName: string; reason?: string }>; artifacts: Array<{ id: string; path: string; type: string }>
}
export function ConversationPage() {
  const [sessions, setSessions] = useState<Session[]>();
  const [selected, setSelected] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  useEffect(() => { void api<Session[]>('/api/sessions').then((items) => { setSessions(items); setSelected(items[0]?.id ?? ''); }); }, []);
  useEffect(() => { if (selected) void api<Turn[]>(`/api/sessions/${selected}/turns`).then(setTurns); }, [selected]);
  if (!sessions) return <Loading />;
  return <section>
    <PageHeader eyebrow="03 / CONVERSATION" title="Conversation Replay" description="按时间回放多轮对话、工具介入、审批和文件产物。"
      actions={<select value={selected} onChange={(event) => setSelected(event.target.value)}>{sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}</select>} />
    {turns.length === 0 ? <Empty>所选 Session 尚未记录 Turn。</Empty> :
      <div className="conversation">{turns.map((turn) => <article key={turn.id} className="turn-card">
        <div className="turn-index"><span>{String(turn.index).padStart(2, '0')}</span><i /></div>
        <div className="turn-body">
          <div className="turn-meta"><MessageCircle size={14} /><span>{formatDate(turn.startedAt)}</span><StatusBadge status={turn.status} /></div>
          <div className="message user-message"><UserRound size={16} /><div><b>USER</b><p>{turn.userMessage}</p></div></div>
          {turn.tools.map((tool) => <div className="inline-event" key={tool.id}><TerminalSquare size={14} /><div><b>{tool.toolName}</b><span>{tool.reason}</span></div></div>)}
          {turn.assistantMessage && <div className="message assistant-message"><Bot size={16} /><div><b>JARVIS</b><p>{turn.assistantMessage}</p></div></div>}
          {turn.artifacts.map((artifact) => <div className="inline-event artifact-event" key={artifact.id}><FileOutput size={14} /><div><b>{artifact.type}</b><span>{artifact.path}</span></div></div>)}
        </div>
      </article>)}</div>}
  </section>;
}
