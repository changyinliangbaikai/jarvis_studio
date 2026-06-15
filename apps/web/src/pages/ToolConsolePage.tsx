import { useEffect, useState } from 'react';
import { Copy, LockKeyhole, Play, TerminalSquare } from 'lucide-react';
import { api, formatDate, formatDuration, post } from '../api.ts';
import { Empty, JsonView, Loading, PageHeader, StatusBadge } from '../components/Primitives.tsx';

interface ToolCall { id: string; runId: string; toolName: string; reason?: string; arguments: unknown; permission: Record<string, unknown>; latencyMs?: number; success: boolean; exitCode?: number; stdoutRef?: string; stderrRef?: string; result: unknown; contextInjection: unknown; createdAt: string }
export function ToolConsolePage() {
  const [tools, setTools] = useState<ToolCall[]>();
  const [selected, setSelected] = useState<ToolCall>();
  const [message, setMessage] = useState('');
  useEffect(() => { void api<ToolCall[]>('/api/tool-calls').then((items) => { setTools(items); setSelected(items[0]); }); }, []);
  const replay = async () => {
    try { await post(`/api/tool-calls/${selected?.id}/replay`, {}); } catch (error) { setMessage(error instanceof Error ? error.message : '重放失败'); }
  };
  if (!tools) return <Loading />;
  return <section>
    <PageHeader eyebrow="05 / TOOL CONSOLE" title="Tool Execution Ledger" description="审查工具调用原因、参数、权限、结果和上下文回注。"
      actions={<button disabled={!selected} onClick={() => void replay()}><Play size={15} />重放调用</button>} />
    {message && <div className="notice warning"><LockKeyhole size={15} />{message}</div>}
    {tools.length === 0 ? <Empty>尚未捕获 Tool Call。</Empty> : <div className="tool-layout">
      <div className="panel tool-list"><div className="panel-title"><TerminalSquare size={15} />CALLS <span>{tools.length}</span></div>{tools.map((tool) =>
        <button key={tool.id} className={selected?.id === tool.id ? 'active' : ''} onClick={() => setSelected(tool)}>
          <StatusBadge status={tool.success ? 'success' : 'failed'} /><div><strong>{tool.toolName}</strong><span>{formatDate(tool.createdAt)}</span></div><b>{formatDuration(tool.latencyMs)}</b>
        </button>)}</div>
      {selected && <div className="panel tool-detail"><div className="detail-head"><div><span className="eyebrow">TOOL CALL</span><h2>{selected.toolName}</h2><p>{selected.reason}</p></div><button onClick={() => void navigator.clipboard.writeText(JSON.stringify(selected.arguments))}><Copy size={14} />复制参数</button></div>
        <div className="permission-strip"><LockKeyhole size={14} /><span>PERMISSION</span><code>{JSON.stringify(selected.permission)}</code></div>
        <h3>Arguments</h3><JsonView value={selected.arguments} /><h3>Result</h3><JsonView value={selected.result} />
        <h3>stdout / stderr</h3><JsonView value={{ stdoutRef: selected.stdoutRef ?? null, stderrRef: selected.stderrRef ?? null, exitCode: selected.exitCode }} />
        <h3>Context Injection</h3><JsonView value={selected.contextInjection} />
      </div>}
    </div>}
  </section>;
}
