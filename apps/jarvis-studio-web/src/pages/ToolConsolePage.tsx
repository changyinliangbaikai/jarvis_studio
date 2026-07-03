import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useState } from 'react';
import { Copy, LockKeyhole, Play, TerminalSquare } from 'lucide-react';
import { api, post } from '../api.ts';
import { Empty, JsonView, Loading, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatDate, formatDuration } from '../utils/format.ts';

interface ToolCall { id: string; runId: string; toolName: string; reason?: string; arguments: unknown; permission: Record<string, unknown>; latencyMs?: number; success: boolean; exitCode?: number; stdoutRef?: string; stderrRef?: string; result: unknown; contextInjection: unknown; createdAt: string }
export function ToolConsolePage() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<ToolCall>();
  const [message, setMessage] = useState('');
  const loadTools = useCallback((signal: AbortSignal) => api<ToolCall[]>('/api/tool-calls', { signal }), []);
  const toolsResource = useAsyncResource(loadTools, [], true, { queryKey: ['tool-calls'] });
  const tools = toolsResource.data;
  useEffect(() => {
    if (tools) setSelected((current) => current ?? tools[0]);
  }, [tools]);
  const replay = async () => {
    try { await post(`/api/tool-calls/${selected?.id}/replay`, {}); } catch (error) { setMessage(error instanceof Error ? error.message : t('pages.toolConsole.string_13')); }
  };
  if (!tools) return <Loading />;
  return <section>
    <PageHeader eyebrow={t('pages.toolConsole.string_1')} title={t('pages.toolConsole.string_2')} description={t('pages.toolConsole.string_3')}
      actions={<button disabled={!selected} onClick={() => void replay()}><Play size={15} />{t('pages.toolConsole.string_4')}</button>} />
    {toolsResource.error && <div className="notice warning">{toolsResource.error}</div>}
    {message && <div className="notice warning"><LockKeyhole size={15} />{message}</div>}
    {tools.length === 0 ? <Empty>{t('pages.toolConsole.string_5')}</Empty> : <div className="tool-layout">
      <div className="panel tool-list"><div className="panel-title"><TerminalSquare size={15} />{t('pages.toolConsole.string_6')}<span>{tools.length}</span></div>{tools.map((tool) =>
        <button key={tool.id} className={selected?.id === tool.id ? 'active' : ''} onClick={() => setSelected(tool)}>
          <StatusBadge status={tool.success ? 'success' : 'failed'} /><div><strong>{tool.toolName}</strong><span>{formatDate(tool.createdAt)}</span></div><b>{formatDuration(tool.latencyMs)}</b>
        </button>)}</div>
      {selected && <div className="panel tool-detail"><div className="detail-head"><div><span className="eyebrow">{t('pages.toolConsole.string_7')}</span><h2>{selected.toolName}</h2><p>{selected.reason}</p></div><button onClick={() => void navigator.clipboard.writeText(JSON.stringify(selected.arguments))}><Copy size={14} />{t('pages.toolConsole.string_8')}</button></div>
        <div className="permission-strip"><LockKeyhole size={14} /><span>{t('pages.toolConsole.string_9')}</span><code>{JSON.stringify(selected.permission)}</code></div>
        <h3>{t('pages.toolConsole.string_10')}</h3><JsonView value={selected.arguments} /><h3>{t('pages.toolConsole.string_11')}</h3><JsonView value={selected.result} />
        <h3>stdout / stderr</h3><JsonView value={{ stdoutRef: selected.stdoutRef ?? null, stderrRef: selected.stderrRef ?? null, exitCode: selected.exitCode }} />
        <h3>{t('pages.toolConsole.string_12')}</h3><JsonView value={selected.contextInjection} />
      </div>}
    </div>}
  </section>;
}
