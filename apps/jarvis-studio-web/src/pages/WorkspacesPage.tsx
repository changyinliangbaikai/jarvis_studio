import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { ClipboardList, FolderOpen, Pencil, PlayCircle, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, post } from '../api.ts';
import { EntityDetailPanel, EntityListPanel, ListDetailLayout } from '../components/ListDetailLayout.tsx';
import { Empty, JsonView, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { useEntityList } from '../hooks/useEntityList.ts';
import { modelProviderListSchema, workspaceSchema } from '../types/schemas.ts';

interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  defaultModelProfileId?: string;
  defaultPolicyId?: string;
  defaultContextPolicyId?: string;
  settings: Record<string, unknown>;
  taskCount: number;
  artifactCount: number;
  updatedAt?: string;
}

interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  sizeBytes?: number | null;
  updatedAt?: string;
}

interface ModelProvider {
  id: string;
  name: string;
  defaultModel: string;
  enabled: boolean;
  isDefault: boolean;
  source: string;
}

interface PermissionPolicy {
  id: string;
  name: string;
  version?: string;
  enabled: boolean;
}

interface ContextStrategy {
  id: string;
  name: string;
  version?: string;
  enabled: boolean;
}

interface WorkspaceForm {
  name: string;
  rootPath: string;
  defaultModelProfileId: string;
  defaultPolicyId: string;
  defaultContextPolicyId: string;
}

export function WorkspacesPage() {
  const { t } = useTranslation();
  const { items, selected, selectedId, setSelectedId, loading, error: loadError, refresh } = useEntityList<Workspace>('/api/workspaces', '', { schema: workspaceSchema.array() });
  const [form, setForm] = useState<WorkspaceForm>(blankWorkspaceForm());
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const [editForm, setEditForm] = useState<WorkspaceForm>(blankWorkspaceForm());
  const [error, setError] = useState('');
  const loadOptions = useCallback(async (signal: AbortSignal) => {
    const [providers, policyData, contextStrategies] = await Promise.all([
      api<ModelProvider[]>('/api/model-providers', { schema: modelProviderListSchema, signal }),
      api<{ policies: PermissionPolicy[] }>('/api/permissions/policies', { signal }),
      api<ContextStrategy[]>('/api/context/strategies', { signal })
    ]);
    return { providers, policies: policyData.policies, contextStrategies };
  }, []);
  const options = useAsyncResource(loadOptions, [], true, { queryKey: ['workspace-options'] });
  const loadFiles = useCallback(async (signal: AbortSignal) => {
    if (!selected?.id) return [];
    const data = await api<{ files: FileItem[] }>(`/api/workspaces/${selected.id}/files`, { signal });
    return data.files;
  }, [selected?.id]);
  const files = useAsyncResource<FileItem[]>(loadFiles, [selected?.id], Boolean(selected?.id));
  useEffect(() => {
    if (!selected) return;
    setEditForm({
      name: selected.name,
      rootPath: selected.rootPath,
      defaultModelProfileId: selected.defaultModelProfileId ?? '',
      defaultPolicyId: selected.defaultPolicyId ?? '',
      defaultContextPolicyId: selected.defaultContextPolicyId ?? ''
    });
    setEditing(false);
  }, [selected?.id]);
  useEffect(() => {
    const data = options.data;
    if (!data) return;
    setForm((current) => ({
      ...current,
      defaultModelProfileId: current.defaultModelProfileId || preferredModelProviderId(data.providers),
      defaultPolicyId: current.defaultPolicyId || preferredPolicyId(data.policies),
      defaultContextPolicyId: current.defaultContextPolicyId || preferredContextStrategyId(data.contextStrategies)
    }));
  }, [options.data]);
  const create = async () => {
    setError('');
    try {
      const created = await post<Workspace>('/api/workspaces', workspacePayload(form));
      setForm({
        ...blankWorkspaceForm(),
        defaultModelProfileId: preferredModelProviderId(options.data?.providers ?? []),
        defaultPolicyId: preferredPolicyId(options.data?.policies ?? []),
        defaultContextPolicyId: preferredContextStrategyId(options.data?.contextStrategies ?? [])
      });
      await refresh(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('pages.workspaces.string_27'));
    }
  };
  const save = async () => {
    if (!selected) return;
    setBusy('save');
    setError('');
    try {
      const saved = await api<Workspace>(`/api/workspaces/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...workspacePayload(editForm), settings: selected.settings })
      });
      setEditing(false);
      await refresh(saved.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('pages.workspaces.string_28'));
    } finally {
      setBusy('');
    }
  };
  const remove = async () => {
    if (!selected || !window.confirm(t('pages.workspaces.string_29'))) return;
    setBusy('delete');
    setError('');
    try {
      await api(`/api/workspaces/${selected.id}`, { method: 'DELETE' });
      setSelectedId('');
      files.setData([]);
      await refresh('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('pages.workspaces.string_30'));
    } finally {
      setBusy('');
    }
  };
  if (loading && !items) return <Loading />;
  const displayItems = items ?? [];
  const providerOptions = options.data?.providers ?? [];
  const policyOptionsData = options.data?.policies ?? [];
  const contextOptionsData = options.data?.contextStrategies ?? [];
  const selectedModelLabel = selected ? modelProviderLabel(providerOptions, selected.defaultModelProfileId, t) : '—';
  return <section>
    <PageHeader eyebrow="V0.5 / Eval Workspace" title={t('pages.workspaces.string_1')} description={t('pages.workspaces.string_2')}
      actions={<button onClick={() => void refresh()}><RefreshCw size={14} />{t('pages.workspaces.string_7')}</button>} />
    {(loadError || files.error || options.error || error) && <div className="notice warning">{loadError || files.error || options.error || error}</div>}
    <div className="metric-grid compact">
      <Metric label="EVAL WORKSPACES" value={displayItems.length} tone="cyan" />
      <Metric label="TEST TASKS" value={displayItems.reduce((sum, item) => sum + item.taskCount, 0)} />
      <Metric label="RUN ARTIFACTS" value={displayItems.reduce((sum, item) => sum + item.artifactCount, 0)} tone="amber" />
      <Metric label="MODEL" value={selectedModelLabel} />
      <Metric label="STATUS" value="v0.5 ready" tone="green" />
    </div>
    <ListDetailLayout>
      <EntityListPanel>
        <div className="panel-title"><FolderOpen size={15} />{t('pages.workspaces.string_8')}<span>{displayItems.length}</span></div>
        {displayItems.map((item) => <button key={item.id} className={selectedId === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}>
          <StatusBadge status="ready" />
          <div><strong>{item.name}</strong><span>{item.rootPath}</span><p>{item.taskCount} test tasks · {item.artifactCount} run artifacts</p></div>
          <aside><b>{modelProviderShortLabel(providerOptions, item.defaultModelProfileId)}</b><span>{item.defaultContextPolicyId}</span></aside>
        </button>)}
        <div className="mini-form">
          <label>{t('pages.workspaces.string_9')}<input placeholder={t('pages.workspaces.string_3')} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Root Path<input placeholder={t('pages.workspaces.string_4')} value={form.rootPath} onChange={(event) => setForm({ ...form, rootPath: event.target.value })} /></label>
          <WorkspaceOptionFields form={form} providers={providerOptions} policies={policyOptionsData} contextStrategies={contextOptionsData} onChange={setForm} />
          <button className="primary" disabled={!form.name.trim()} onClick={() => void create()}><Plus size={14} />{t('pages.workspaces.string_10')}</button>
        </div>
      </EntityListPanel>
      <EntityDetailPanel>
        {selected ? <>
          <div className="panel-title">Eval Workspace Detail <span>{selected.id}</span></div>
          <div className="provider-actions task-detail-actions">
            <button onClick={() => setEditing(true)}><Pencil size={14} />{t('common.edit')}</button>
            <button className="danger" disabled={busy === 'delete'} onClick={() => void remove()}><Trash2 size={14} />{t('common.delete')}</button>
          </div>
          {editing && <div className="task-editor-panel">
            <div className="panel-title"><Pencil size={15} />{t('pages.workspaces.string_11')}<span>PUT /api/workspaces/:id</span></div>
            <div className="run-form-grid task-form-grid">
              <label>{t('pages.workspaces.string_12')}<input placeholder={t('pages.workspaces.string_5')} value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></label>
              <label>Root Path<input placeholder={t('pages.workspaces.string_6')} value={editForm.rootPath} onChange={(event) => setEditForm({ ...editForm, rootPath: event.target.value })} /></label>
              <WorkspaceOptionFields form={editForm} providers={providerOptions} policies={policyOptionsData} contextStrategies={contextOptionsData} onChange={setEditForm} wideContext />
            </div>
            <div className="modal-actions"><button onClick={() => setEditing(false)}><X size={14} />{t('common.cancel')}</button><button className="primary" disabled={busy === 'save' || !editForm.name.trim()} onClick={() => void save()}><Save size={14} />{busy === 'save' ? t('pages.workspaces.string_31') : t('pages.workspaces.string_32')}</button></div>
          </div>}
          <div className="registry-facts">
            <span>Root<b>{selected.rootPath}</b></span>
            <span>Model<b>{selectedModelLabel}</b></span>
            <span>Policy<b>{selected.defaultPolicyId ?? '—'}</b></span>
            <span>Context<b>{selected.defaultContextPolicyId ?? '—'}</b></span>
          </div>
          <div className="workspace-guide">
            <div><ClipboardList size={18} /><strong>{t('pages.workspaces.string_13')}</strong><p>{t('pages.workspaces.string_14')}</p><Link className="primary-link" to={`/tasks?workspaceId=${encodeURIComponent(selected.id)}&create=1`}>{t('pages.workspaces.string_15')}</Link></div>
            <div><PlayCircle size={18} /><strong>{t('pages.workspaces.string_16')}</strong><p>{t('pages.workspaces.string_17')}</p><Link className="primary-link secondary-link" to={`/runtime?workspaceId=${encodeURIComponent(selected.id)}`}>{t('pages.workspaces.string_18')}</Link></div>
          </div>
          <div className="workbench-split">
            <div><h3>{t('pages.workspaces.string_19')}</h3>{files.loading ? <Loading /> : <div className="file-tree">{(files.data ?? []).map((file) => <div key={file.path} className={file.type}>
              <span>{file.type === 'directory' ? 'DIR' : 'FILE'}</span><b>{file.path}</b><em>{file.sizeBytes ?? ''}</em>
            </div>)}</div>}</div>
            <div><h3>Settings</h3><JsonView value={selected.settings} /></div>
          </div>
        </> : <Empty>{t('pages.workspaces.string_20')}</Empty>}
      </EntityDetailPanel>
    </ListDetailLayout>
  </section>;
}

function WorkspaceOptionFields({ form, providers, policies, contextStrategies, wideContext = false, onChange }: {
  form: WorkspaceForm;
  providers: ModelProvider[];
  policies: PermissionPolicy[];
  contextStrategies: ContextStrategy[];
  wideContext?: boolean;
  onChange: (form: WorkspaceForm) => void;
}) {
  const { t } = useTranslation();
  return <>
    <label>{t('pages.workspaces.string_21')}<ThemedSelect value={form.defaultModelProfileId} onChange={(event) => onChange({ ...form, defaultModelProfileId: event.target.value })}>
      <option value="">{t('pages.workspaces.string_22')}</option>
      {modelProviderOptions(providers, form.defaultModelProfileId, t).map((provider) => <option key={provider.id} value={provider.id}>
        {provider.name} · {provider.defaultModel}{provider.isDefault ? t('pages.workspaces.string_33') : ''}{provider.enabled ? '' : t('pages.workspaces.string_34')}
      </option>)}
    </ThemedSelect></label>
    <label>{t('pages.workspaces.string_23')}<ThemedSelect value={form.defaultPolicyId} onChange={(event) => onChange({ ...form, defaultPolicyId: event.target.value })}>
      <option value="">{t('pages.workspaces.string_24')}</option>
      {policyOptions(policies, form.defaultPolicyId, t).map((policy) => <option key={policy.id} value={policy.id}>
        {policy.name} · {policy.id}{policy.version ? ` · ${policy.version}` : ''}{policy.enabled ? '' : t('pages.workspaces.string_35')}
      </option>)}
    </ThemedSelect></label>
    <label className={wideContext ? 'wide' : undefined}>{t('pages.workspaces.string_25')}<ThemedSelect value={form.defaultContextPolicyId} onChange={(event) => onChange({ ...form, defaultContextPolicyId: event.target.value })}>
      <option value="">{t('pages.workspaces.string_26')}</option>
      {contextOptions(contextStrategies, form.defaultContextPolicyId, t).map((strategy) => <option key={strategy.id} value={strategy.id}>
        {strategy.name} · {strategy.id}{strategy.version ? ` · ${strategy.version}` : ''}{strategy.enabled ? '' : t('pages.workspaces.string_36')}
      </option>)}
    </ThemedSelect></label>
  </>;
}

function blankWorkspaceForm(): WorkspaceForm {
  return {
    name: '',
    rootPath: '',
    defaultModelProfileId: '',
    defaultPolicyId: '',
    defaultContextPolicyId: ''
  };
}

function workspacePayload(form: WorkspaceForm) {
  return {
    name: form.name,
    rootPath: form.rootPath || undefined,
    defaultModelProfileId: form.defaultModelProfileId || undefined,
    defaultPolicyId: form.defaultPolicyId || undefined,
    defaultContextPolicyId: form.defaultContextPolicyId || undefined
  };
}

function preferredModelProviderId(providers: ModelProvider[]) {
  return providers.find((item) => item.isDefault && item.enabled)?.id
    ?? providers.find((item) => item.isDefault)?.id
    ?? providers.find((item) => item.enabled)?.id
    ?? providers[0]?.id
    ?? '';
}

function preferredPolicyId(policies: PermissionPolicy[]) {
  return policies.find((item) => item.enabled)?.id ?? policies[0]?.id ?? '';
}

function preferredContextStrategyId(strategies: ContextStrategy[]) {
  return strategies.find((item) => item.enabled)?.id ?? strategies[0]?.id ?? '';
}

function modelProviderOptions(providers: ModelProvider[], currentId: string, t: (key: string) => string) {
  if (!currentId || providers.some((item) => item.id === currentId)) return providers;
  return [{ id: currentId, name: t('pages.workspaces.string_37'), defaultModel: currentId, enabled: true, isDefault: false, source: 'workspace' }, ...providers];
}

function modelProviderLabel(providers: ModelProvider[], id: string | undefined, t: (key: string) => string) {
  if (!id) return t('pages.workspaces.string_38');
  const provider = providers.find((item) => item.id === id);
  if (!provider) return t('pages.workspaces.string_39');
  return `${provider.name} · ${provider.defaultModel}${provider.enabled ? '' : t('pages.workspaces.string_40')}`;
}

function modelProviderShortLabel(providers: ModelProvider[], id?: string) {
  if (!id) return 'default';
  const provider = providers.find((item) => item.id === id);
  return provider?.name ?? id;
}

function policyOptions(policies: PermissionPolicy[], currentId: string, t: (key: string) => string) {
  if (!currentId || policies.some((item) => item.id === currentId)) return policies;
  return [{ id: currentId, name: t('pages.workspaces.string_41'), enabled: true, version: undefined } as any, ...policies];
}

function contextOptions(strategies: ContextStrategy[], currentId: string, t: (key: string) => string) {
  if (!currentId || strategies.some((item) => item.id === currentId)) return strategies;
  return [{ id: currentId, name: t('pages.workspaces.string_42'), enabled: true, version: undefined } as any, ...strategies];
}
