import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitCommitVertical, Plus, Rocket, Save } from 'lucide-react';
import { api, post } from '../api.ts';
import { Empty, Loading, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { useTranslation } from 'react-i18next';

interface Agent { id: string; name: string; defaultPromptId?: string }
interface Prompt {
  id: string;
  agentId?: string;
  name: string;
  version: string;
  status: 'draft' | 'active' | 'archived';
  content: string;
  systemPrompt?: string;
  developerPrompt?: string;
  userTemplate?: string;
  variables: string[];
  linkedSkill?: string;
  changelog?: string;
  outputSchema?: unknown;
  toolPolicy?: unknown;
  successCriteria?: unknown;
  riskNotes?: string;
  updatedAt: string;
}

function pretty(value: unknown) {
  try { return JSON.stringify(value ?? {}, null, 2); } catch { return '{}'; }
}

export function PromptLabPage() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    name: '', agentId: '', systemPrompt: '', developerPrompt: '', userTemplate: '', changelog: '',
    outputSchema: '{}', toolPolicy: '{}', successCriteria: '{}', riskNotes: ''
  });

  const parseJson = (text: string) => {
    try { return JSON.parse(text || '{}'); } catch { throw new Error(t('pages.promptLab.string_24')); }
  };

  const loadPrompts = useCallback((signal: AbortSignal) => api<Prompt[]>('/api/prompts', { signal }), []);
  const loadAgents = useCallback((signal: AbortSignal) => api<Agent[]>('/api/agents', { signal }), []);
  const promptsResource = useAsyncResource(loadPrompts, [], true, { queryKey: ['prompts'] });
  const agentsResource = useAsyncResource(loadAgents, [], true, { queryKey: ['agents', 'prompt-page'] });
  const prompts = promptsResource.data;
  const agents = agentsResource.data ?? [];
  const selected = prompts?.find((prompt) => prompt.id === selectedId) ?? prompts?.[0];
  const versions = useMemo(() => prompts?.filter((prompt) => prompt.name === selected?.name) ?? [], [prompts, selected?.name]);

  useEffect(() => {
    if (prompts) setSelectedId((value) => value || prompts[0]?.id || '');
  }, [prompts]);
  useEffect(() => {
    if (selected) setForm({
      name: selected.name,
      agentId: selected.agentId ?? '',
      systemPrompt: selected.systemPrompt ?? selected.content,
      developerPrompt: selected.developerPrompt ?? '',
      userTemplate: selected.userTemplate ?? '',
      changelog: selected.changelog ?? '',
      outputSchema: pretty(selected.outputSchema),
      toolPolicy: pretty(selected.toolPolicy),
      successCriteria: pretty(selected.successCriteria),
      riskNotes: selected.riskNotes ?? ''
    });
  }, [selected?.id]);

  const createPrompt = async () => {
    const item = await post<Prompt>('/api/prompts', {
      name: 'new-agent-prompt',
      agentId: agents[0]?.id,
      status: 'draft',
      systemPrompt: t('pages.promptLab.string_25'),
      developerPrompt: t('pages.promptLab.string_26'),
      userTemplate: '{{input}}',
      changelog: t('pages.promptLab.string_27')
    });
    await promptsResource.reload();
    setSelectedId(item.id);
  };
  const saveVersion = async (status: 'draft' | 'active' = 'draft') => {
    if (!selected) return;
    try {
      const item = await post<Prompt>(`/api/prompts/${selected.id}/new-version`, {
        name: form.name,
        agentId: form.agentId || undefined,
        status,
        systemPrompt: form.systemPrompt,
        developerPrompt: form.developerPrompt,
        userTemplate: form.userTemplate,
        changelog: form.changelog || t('pages.promptLab.string_28', { version: selected.version }),
        outputSchema: parseJson(form.outputSchema),
        toolPolicy: parseJson(form.toolPolicy),
        successCriteria: parseJson(form.successCriteria),
        riskNotes: form.riskNotes
      });
      await promptsResource.reload();
      await agentsResource.reload();
      setSelectedId(item.id);
      setMessage(status === 'active' ? t('pages.promptLab.string_29', { name: item.name, version: item.version }) : t('pages.promptLab.string_30', { name: item.name, version: item.version }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('pages.promptLab.string_31'));
    }
  };
  const activate = async () => {
    if (!selected) return;
    const item = await post<Prompt>(`/api/prompts/${selected.id}/activate`, {});
    await promptsResource.reload();
    await agentsResource.reload();
    setSelectedId(item.id);
    setMessage(t('pages.promptLab.string_32', { name: item.name, version: item.version }));
  };
  const archive = async () => {
    if (!selected) return;
    const item = await post<Prompt>(`/api/prompts/${selected.id}/archive`, {});
    await promptsResource.reload();
    setSelectedId(item.id);
    setMessage(t('pages.promptLab.string_33', { name: item.name, version: item.version }));
  };

  if (!prompts || !agentsResource.data) return <Loading />;
  return <section>
    <PageHeader eyebrow="02 / Prompts" title={t('pages.promptLab.string_13')} description={t('pages.promptLab.string_1')} actions={<button onClick={() => void createPrompt()}><Plus size={15} />{t('pages.promptLab.string_3')}</button>} />
    {(promptsResource.error || agentsResource.error || message) && <div className="notice warning">{promptsResource.error || agentsResource.error || message}</div>}
    {prompts.length === 0 ? <Empty>{t('pages.promptLab.string_4')}</Empty> : <div className="prompt-layout">
      <div className="panel prompt-list"><div className="panel-title"><GitCommitVertical size={15} />{t('pages.promptLab.string_5')}<span>{versions.length || prompts.length}</span></div>{prompts.map((prompt) =>
        <button key={prompt.id} className={selected?.id === prompt.id ? 'active' : ''} onClick={() => setSelectedId(prompt.id)}>
          <div><strong>{prompt.name}</strong><span>{prompt.changelog || t('pages.promptLab.string_34')}</span></div><b>{prompt.version}</b>
        </button>)}</div>
      <div className="panel editor-panel"><div className="editor-toolbar"><div><span className="eyebrow">{t('pages.promptLab.string_8')}</span><h2>{selected?.name}@{selected?.version}</h2></div><div className="page-actions"><button onClick={() => void archive()}>{t('pages.promptLab.string_9')}</button><button onClick={() => void saveVersion('draft')}><Save size={15} />{t('pages.promptLab.string_10')}</button><button className="primary" onClick={() => void (selected?.status === 'active' ? saveVersion('active') : activate())}><Rocket size={15} />{t('pages.promptLab.string_11')}</button></div></div>
        <div className="editor-meta"><span>{t('common.status')} <b><StatusBadge status={selected?.status ?? 'draft'} /></b></span><span>Agent <b>{agents.find((agent) => agent.id === (form.agentId || selected?.agentId))?.name ?? t('common.unbound')}</b></span><span>{t('pages.promptLab.string_12')} <b>{selected?.variables?.join(', ') || t('pages.promptLab.string_35')}</b></span></div>
        <div className="mini-form">
          <label>{t('pages.promptLab.string_13')}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>{t('pages.promptLab.string_14')}<select value={form.agentId} onChange={(event) => setForm({ ...form, agentId: event.target.value })}><option value="">{t('pages.promptLab.string_15')}</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
          <label>System Prompt<textarea rows={7} value={form.systemPrompt} onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })} /></label>
          <label>Developer Prompt<textarea rows={4} value={form.developerPrompt} onChange={(event) => setForm({ ...form, developerPrompt: event.target.value })} /></label>
          <label>User Template<textarea rows={3} value={form.userTemplate} onChange={(event) => setForm({ ...form, userTemplate: event.target.value })} /></label>
          <label>{t('pages.promptLab.string_16')}<textarea rows={4} value={form.toolPolicy} onChange={(event) => setForm({ ...form, toolPolicy: event.target.value })} /></label>
          <label>{t('pages.promptLab.string_17')}<textarea rows={4} value={form.outputSchema} onChange={(event) => setForm({ ...form, outputSchema: event.target.value })} /></label>
          <label>{t('pages.promptLab.string_18')}<textarea rows={4} value={form.successCriteria} onChange={(event) => setForm({ ...form, successCriteria: event.target.value })} /></label>
          <label>{t('pages.promptLab.string_21')}<textarea rows={3} value={form.riskNotes} onChange={(event) => setForm({ ...form, riskNotes: event.target.value })} /></label>
        </div>
      </div>
    </div>}
  </section>;
}
