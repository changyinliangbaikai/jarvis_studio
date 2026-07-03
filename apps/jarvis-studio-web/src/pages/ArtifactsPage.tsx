import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileArchive, RefreshCw, Star } from 'lucide-react';
import { api, download, post } from '../api.ts';
import { Empty, JsonView, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatDate } from '../utils/format.ts';

interface Artifact {
  id: string;
  runId?: string;
  workspaceId?: string;
  taskId?: string;
  toolCallId?: string;
  type: string;
  name?: string;
  path: string;
  mimeType?: string;
  sizeBytes?: number;
  previewAvailable: boolean;
  isFinal: boolean;
  createdAt: string;
}

export function ArtifactsPage() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const load = useCallback((signal: AbortSignal) => api<Artifact[]>('/api/artifacts', { signal }), []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['artifacts'] });
  const items = resource.data;
  const selected = useMemo(() => items?.find((item) => item.id === selectedId) ?? items?.[0], [items, selectedId]);
  const loadPreview = useCallback((signal: AbortSignal) => selected?.id ? api<unknown>(`/api/artifacts/${selected.id}/preview`, { signal }) : Promise.resolve(undefined), [selected?.id]);
  const previewResource = useAsyncResource<unknown | undefined>(loadPreview, [selected?.id], Boolean(selected?.id), { queryKey: ['artifact-preview', selected?.id] });
  const preview = previewResource.data;
  useEffect(() => {
    if (items) setSelectedId((current) => current || items[0]?.id || '');
  }, [items]);
  const markFinal = async () => {
    if (!selected) return;
    setError('');
    try {
      await post(`/api/artifacts/${encodeURIComponent(selected.id)}/mark-final`, {});
      setNotice(t('pages.artifacts.string_8'));
      await resource.reload();
      await previewResource.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('pages.artifacts.string_9'));
    }
  };
  const downloadSelected = async () => {
    if (!selected) return;
    setError('');
    try {
      await download(`/api/artifacts/${encodeURIComponent(selected.id)}/download`, selected.name ?? selected.path.split('/').pop() ?? selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('pages.artifacts.string_10'));
    }
  };
  if (!items) return <Loading />;
  return <section>
    <PageHeader eyebrow="V0.5 / Run Artifact" title={t('pages.artifacts.string_1')} description={t('pages.artifacts.string_2')}
      actions={<button onClick={() => void resource.reload()}><RefreshCw size={14} />{t('pages.artifacts.string_3')}</button>} />
    {notice && <div className="notice">{notice}</div>}
    {(resource.error || previewResource.error || error) && <div className="notice warning">{resource.error || previewResource.error || error}</div>}
    <div className="metric-grid compact">
      <Metric label="RUN ARTIFACTS" value={items.length} tone="cyan" />
      <Metric label="STATUS" value={items.filter((item) => item.isFinal).length} tone="green" />
      <Metric label="RUN" value={selected?.runId?.slice(0, 12) ?? '—'} />
      <Metric label="TEST TASKS" value={items.filter((item) => item.taskId).length} />
      <Metric label="MODEL" value={selected?.type ?? '—'} tone="amber" />
    </div>
    {items.length === 0 ? <Empty>{t('pages.artifacts.string_4')}</Empty> : <div className="workbench-grid">
      <div className="panel registry-list">
        <div className="panel-title"><FileArchive size={15} />{t('pages.artifacts.string_5')}<span>{items.length}</span></div>
        {items.map((item) => <button key={item.id} className={selected?.id === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}>
          <StatusBadge status={item.isFinal ? 'completed' : 'created'} />
          <div><strong>{item.name ?? item.path}</strong><span>{item.type} · {item.mimeType ?? 'unknown'}</span><p>{item.path}</p></div>
          <aside><b>{formatBytes(item.sizeBytes)}</b><span>{formatDate(item.createdAt)}</span></aside>
        </button>)}
      </div>
      {selected && <div className="panel workbench-detail">
        <div className="panel-title">Run Artifact Preview <span>{selected.id}</span></div>
        <div className="provider-actions">
          <button className="primary" onClick={() => void downloadSelected()}><Download size={14} />{t('pages.artifacts.string_6')}</button>
          <button onClick={() => void markFinal()}><Star size={14} />{t('pages.artifacts.string_7')}</button>
        </div>
        <div className="registry-facts">
          <span>Path<b>{selected.path}</b></span>
          <span>Test Task<b>{selected.taskId ?? '—'}</b></span>
          <span>Run<b>{selected.runId ?? '—'}</b></span>
          <span>ToolCall<b>{selected.toolCallId ?? '—'}</b></span>
          <span>Final<b>{selected.isFinal ? 'yes' : 'no'}</b></span>
        </div>
        <JsonView value={preview ?? selected} />
      </div>}
    </div>}
  </section>;
}

function formatBytes(value?: number) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
