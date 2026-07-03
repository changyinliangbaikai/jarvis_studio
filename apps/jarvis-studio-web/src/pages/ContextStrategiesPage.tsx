import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Braces, Save, SlidersHorizontal } from 'lucide-react';
import { api, parseJsonWithSchema } from '../api.ts';
import { JsonView, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { looseObjectSchema } from '../types/schemas.ts';
import { formatDisplayValue } from '../utils/format.ts';

interface ContextStrategy {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updatedAt: string;
}

export function ContextStrategiesPage() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const load = useCallback((signal: AbortSignal) => api<ContextStrategy[]>('/api/context/strategies', { signal }), []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['context-strategies'] });
  const items = resource.data;
  const selected = useMemo(() => items?.find((item) => item.id === selectedId) ?? items?.[0], [items, selectedId]);
  useEffect(() => {
    if (items) setSelectedId((current) => current || items[0]?.id || '');
  }, [items]);
  useEffect(() => { if (selected) setDraft(JSON.stringify(selected.config, null, 2)); }, [selected?.id]);
  const save = async () => {
    if (!selected) return;
    setError('');
    try {
      const config = parseJsonWithSchema(draft, looseObjectSchema, t('pages.contextStrategies.string_7'));
      await api('/api/context/strategies', { method: 'POST', body: JSON.stringify({ id: selected.id, name: selected.name, version: selected.version, enabled: selected.enabled, config }) });
      await resource.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('pages.contextStrategies.string_8'));
    }
  };
  if (!items) return <Loading />;
  return <section>
    <PageHeader eyebrow="V0.4 / Context Budget" title={t('pages.contextStrategies.string_1')} description={t('pages.contextStrategies.string_2')}
      actions={<button className="primary" disabled={!selected} onClick={() => void save()}><Save size={15} />{t('pages.contextStrategies.string_3')}</button>} />
    {(resource.error || error) && <div className="notice warning">{resource.error || error}</div>}
    <div className="metric-grid compact">
      <Metric label="CONTEXT SNAPSHOTS" value={items.length} tone="cyan" />
      <Metric label="STATUS" value={items.filter((item) => item.enabled).length} tone="green" />
      <Metric label="CONTEXT LIMIT" value={formatDisplayValue(selected?.config.maxContextTokens)} />
      <Metric label="TOKENS" value={formatDisplayValue(selected?.config.reservedOutputTokens)} />
      <Metric label="SEGMENTS" value={Object.keys(selected?.config.segments ?? {}).length} />
    </div>
    <div className="strategy-layout">
      <div className="panel registry-list">
        <div className="panel-title"><SlidersHorizontal size={15} />{t('pages.contextStrategies.string_4')}<span>{items.length}</span></div>
        {items.map((item) => <button key={item.id} className={selected?.id === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}>
          <StatusBadge status={item.enabled ? 'enabled' : 'disabled'} />
          <div><strong>{item.name}</strong><span>{item.id} · {item.version}</span><p>{Object.keys(item.config.segments ?? {}).join(', ')}</p></div>
        </button>)}
      </div>
      {selected && <div className="panel strategy-editor">
        <div className="panel-title"><Braces size={15} />{t('pages.contextStrategies.string_5')}<span>{selected.id}</span></div>
        <textarea className="code-editor" rows={22} value={draft} onChange={(event) => setDraft(event.target.value)} />
        <h3>{t('pages.contextStrategies.string_6')}</h3>
        <JsonView value={selected.config} />
      </div>}
    </div>
  </section>;
}
