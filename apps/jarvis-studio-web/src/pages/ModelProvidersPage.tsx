import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Check, CloudCog, KeyRound, Plus, Save, Server, ShieldCheck, Trash2, Wifi, X } from 'lucide-react';
import { z } from 'zod';
import { api, post } from '../api.ts';
import { Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useEntityList } from '../hooks/useEntityList.ts';
import { modelProviderListSchema } from '../types/schemas.ts';
import { formatDate, formatDuration } from '../utils/format.ts';

interface ModelProvider {
  id: string;
  name: string;
  providerType: 'deterministic' | 'openai-compatible';
  baseUrl?: string;
  defaultModel: string;
  enabled: boolean;
  isDefault: boolean;
  readOnly: boolean;
  source: 'builtin' | 'environment' | 'registry';
  apiKeyConfigured: boolean;
  apiKeyHint?: string;
  lastTestStatus?: string;
  lastTestLatencyMs?: number;
  lastTestMessage?: string;
  lastTestedAt?: string;
  inputPricePer1MTokens: number;
  outputPricePer1MTokens: number;
  currency: string;
}

interface ProviderForm {
  name: string;
  baseUrl: string;
  defaultModel: string;
  apiKey: string;
  clearApiKey: boolean;
  enabled: boolean;
  isDefault: boolean;
  inputPricePer1MTokens: number;
  outputPricePer1MTokens: number;
  currency: string;
}

interface TestResult {
  status: 'healthy' | 'failed';
  latencyMs: number;
  message: string;
  modelCount: number;
}

const blank: ProviderForm = {
  name: '',
  baseUrl: 'http://127.0.0.1:11434/v1',
  defaultModel: 'qwen3',
  apiKey: '',
  clearApiKey: false,
  enabled: true,
  isDefault: false,
  inputPricePer1MTokens: 0,
  outputPricePer1MTokens: 0,
  currency: 'USD'
};

const templates = [
  { label: 'LOCAL OLLAMA', name: 'Local Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3' },
  { label: 'OPENAI CLOUD', name: 'OpenAI Cloud', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { label: 'CUSTOM GATEWAY', name: 'Team Model Gateway', baseUrl: 'https://llm.example.com/v1', model: 'team-default' }
];



export function ModelProvidersPage() {
  const { t } = useTranslation();
  const {
    items,
    selected,
    selectedId,
    setSelectedId,
    loading,
    error: loadError,
    refresh
  } = useEntityList<ModelProvider>('/api/model-providers', 'builtin-deterministic', { schema: modelProviderListSchema });
  const [editingId, setEditingId] = useState<string>();
  const [form, setForm] = useState<ProviderForm>(blank);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [draftTest, setDraftTest] = useState<TestResult>();
  const providers = items ?? [];

  const edit = (provider: ModelProvider) => {
    setSelectedId(provider.id);
    setNotice('');
    setError('');
    setDraftTest(undefined);
    if (provider.readOnly) {
      setEditingId(undefined);
      return;
    }
    setEditingId(provider.id);
    setForm({
      name: provider.name,
      baseUrl: provider.baseUrl ?? '',
      defaultModel: provider.defaultModel,
      apiKey: '',
      clearApiKey: false,
      enabled: provider.enabled,
      isDefault: provider.isDefault,
      inputPricePer1MTokens: provider.inputPricePer1MTokens,
      outputPricePer1MTokens: provider.outputPricePer1MTokens,
      currency: provider.currency
    });
  };
  const create = (template: typeof templates[number] = templates[0]!) => {
    setSelectedId('');
    setEditingId('new');
    setNotice('');
    setError('');
    setDraftTest(undefined);
    setForm({ ...blank, name: template.name, baseUrl: template.baseUrl, defaultModel: template.model });
  };
  const save = async (draft: ProviderForm) => {
    setBusy('save'); setError(''); setNotice('');
    try {
      const saved = editingId === 'new'
        ? await post<ModelProvider>('/api/model-providers', draft)
        : await api<ModelProvider>(`/api/model-providers/${editingId}`, { method: 'PUT', body: JSON.stringify(draft) });
      setEditingId(undefined);
      setNotice(t('pages.modelProviders.string_44'));
      await refresh(saved.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('pages.modelProviders.string_45'));
    } finally {
      setBusy('');
    }
  };
  const remove = async () => {
    if (!selected || selected.readOnly || !window.confirm(t('pages.modelProviders.string_46'))) return;
    setBusy('delete'); setError(''); setNotice('');
    try {
      await api(`/api/model-providers/${selected.id}`, { method: 'DELETE' });
      setEditingId(undefined);
      setNotice(t('pages.modelProviders.string_47'));
      await refresh('builtin-deterministic');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('pages.modelProviders.string_48'));
    } finally {
      setBusy('');
    }
  };
  const test = async (provider: ModelProvider) => {
    setBusy(`test:${provider.id}`); setError(''); setNotice('');
    try {
      const result = await post<TestResult>(`/api/model-providers/${provider.id}/test`, {});
      setNotice(t('pages.modelProviders.string_49'));
      await refresh(provider.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('pages.modelProviders.string_50'));
    } finally {
      setBusy('');
    }
  };
  const testDraft = async (draft: ProviderForm) => {
    setBusy('test:draft'); setError(''); setNotice(''); setDraftTest(undefined);
    try {
      const result = await post<TestResult>('/api/model-providers/test-connection', {
        ...draft,
        providerId: editingId !== 'new' ? editingId : undefined
      });
      setDraftTest(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('pages.modelProviders.string_51'));
    } finally {
      setBusy('');
    }
  };

  const registryCount = providers.filter((item) => item.source === 'registry').length;
  const healthyCount = providers.filter((item) => item.lastTestStatus === 'healthy').length;
  const keyCount = providers.filter((item) => item.apiKeyConfigured).length;
  if (loading && !items) return <Loading />;
  return <section>
    <PageHeader eyebrow={t('pages.modelProviders.string_1')} title={t('pages.modelProviders.string_2')} description={t('pages.modelProviders.string_3')}
      actions={<button className="primary" onClick={() => create()}><Plus size={15} />{t('pages.modelProviders.string_4')}</button>} />
    {notice && <div className="notice"><Check size={14} />{notice}</div>}
    {(loadError || error) && <div className="notice warning"><X size={14} />{loadError || error}</div>}
    <div className="metric-grid">
      <Metric label="PROVIDER PROFILES" value={providers.length} tone="cyan" />
      <Metric label="REGISTRY MANAGED" value={registryCount} />
      <Metric label="HEALTHY SIGNALS" value={healthyCount} tone="green" />
      <Metric label="ENCRYPTED KEYS" value={keyCount} tone="amber" />
    </div>
    <div className="provider-layout">
      <div className="panel provider-list">
        <div className="panel-title"><CloudCog size={15} />{t('pages.modelProviders.string_5')}<span>{providers.length} 个配置</span></div>
        <div className="provider-items">{providers.map((provider) =>
          <button key={provider.id} className={selectedId === provider.id ? 'active' : ''} onClick={() => edit(provider)}>
            <i className={`provider-signal signal-${provider.lastTestStatus ?? (provider.enabled ? 'unknown' : 'disabled')}`} />
            <div><strong>{provider.name}</strong><span>{provider.source} · {provider.providerType}</span><code>{provider.defaultModel}</code></div>
            <aside>{provider.isDefault && <b>{t('pages.modelProviders.string_6')}</b>}<em>{provider.enabled ? t('pages.modelProviders.string_52') : t('pages.modelProviders.string_53')}</em></aside>
          </button>)}
        </div>
        <div className="provider-security"><ShieldCheck size={15} /><div><strong>{t('pages.modelProviders.string_7')}</strong><span>{t('pages.modelProviders.string_8')}</span></div></div>
      </div>
      <div className="provider-workbench">
        {editingId ? <ProviderEditor form={form} existing={editingId !== 'new'} busy={busy} testResult={draftTest} onSave={(draft) => void save(draft)} onTest={(draft) => void testDraft(draft)} onCancel={() => setEditingId(undefined)} onTemplate={create} />
          : selected ? <ProviderDetail provider={selected} busy={busy} onEdit={() => edit(selected)} onTest={() => void test(selected)} onDelete={() => void remove()} />
            : <div className="panel provider-empty"><Server size={28} /><h2>{t('pages.modelProviders.string_9')}</h2><p>{t('pages.modelProviders.string_10')}</p><button className="primary" onClick={() => create()}><Plus size={14} />{t('pages.modelProviders.string_11')}</button></div>}
      </div>
    </div>
  </section>;
}

function ProviderDetail({ provider, busy, onEdit, onTest, onDelete }: { provider: ModelProvider; busy: string; onEdit: () => void; onTest: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  return <div className="panel provider-detail">
    <div className="panel-title"><Server size={15} />{t('pages.modelProviders.string_12')}<span>{provider.id}</span></div>
    <div className="provider-hero">
      <div className={`provider-orbit orbit-${provider.lastTestStatus ?? 'unknown'}`}><Wifi size={28} /></div>
      <div><span className="eyebrow">{provider.source.toUpperCase()} / {provider.providerType.toUpperCase()}</span><h2>{provider.name}</h2><p>{provider.readOnly ? t('pages.modelProviders.string_54') : t('pages.modelProviders.string_55')}</p></div>
      <StatusBadge status={provider.lastTestStatus === 'failed' ? 'failed' : provider.enabled ? 'success' : 'running'} />
    </div>
    <div className="provider-facts">
      <div><span>Base URL</span><code>{provider.baseUrl ?? 'local://deterministic'}</code></div>
      <div><span>{t('pages.modelProviders.string_13')}</span><code>{provider.defaultModel}</code></div>
      <div><span>API Key</span><code>{provider.apiKeyHint ?? (provider.apiKeyConfigured ? t('pages.modelProviders.string_56') : t('pages.modelProviders.string_57'))}</code></div>
      <div><span>{t('pages.modelProviders.string_14')}</span><code>{provider.isDefault ? t('common.yes') : t('common.no')}</code></div>
      <div><span>{t('pages.modelProviders.string_15')}</span><code>{provider.inputPricePer1MTokens} {provider.currency}</code></div>
      <div><span>{t('pages.modelProviders.string_16')}</span><code>{provider.outputPricePer1MTokens} {provider.currency}</code></div>
    </div>
    <div className={`connection-readout readout-${provider.lastTestStatus ?? 'unknown'}`}>
      <Wifi size={16} /><div><strong>{provider.lastTestStatus ?? t('pages.modelProviders.string_58')}</strong><span>{provider.lastTestMessage ?? t('pages.modelProviders.string_59')}</span></div>
      <aside><b>{provider.lastTestLatencyMs === undefined ? '—' : formatDuration(provider.lastTestLatencyMs)}</b><span>{formatDate(provider.lastTestedAt)}</span></aside>
    </div>
    <div className="provider-actions">
      <button className="primary" disabled={busy === `test:${provider.id}`} onClick={onTest}><Wifi size={14} />{busy === `test:${provider.id}` ? t('pages.modelProviders.string_60') : t('pages.modelProviders.string_61')}</button>
      {!provider.readOnly && <button onClick={onEdit}><CloudCog size={14} />{t('pages.modelProviders.string_17')}</button>}
      {!provider.readOnly && <button className="danger" disabled={busy === 'delete'} onClick={onDelete}><Trash2 size={14} />{t('common.delete')}</button>}
    </div>
  </div>;
}

function ProviderEditor({ form, existing, busy, testResult, onSave, onTest, onCancel, onTemplate }: {
  form: ProviderForm;
  existing: boolean;
  busy: string;
  testResult?: TestResult;
  onSave: (form: ProviderForm) => void;
  onTest: (form: ProviderForm) => void;
  onCancel: () => void;
  onTemplate: (template: typeof templates[number]) => void;
}) {
  const { t } = useTranslation();
  const providerFormSchema = useMemo(() => z.object({
    name: z.string().trim().min(1, t('pages.modelProviders.string_37')),
    baseUrl: z.string().trim().url(t('pages.modelProviders.string_38')),
    defaultModel: z.string().trim().min(1, t('pages.modelProviders.string_39')),
    apiKey: z.string().optional().default(''),
    clearApiKey: z.boolean(),
    enabled: z.boolean(),
    isDefault: z.boolean(),
    inputPricePer1MTokens: z.coerce.number().min(0, t('pages.modelProviders.string_40')),
    outputPricePer1MTokens: z.coerce.number().min(0, t('pages.modelProviders.string_41')),
    currency: z.string().trim().min(3, t('pages.modelProviders.string_42')).max(8, t('pages.modelProviders.string_43')).transform((value) => value.toUpperCase())
  }), [t]);
  const [editingApiKey, setEditingApiKey] = useState(!existing);
  const [formError, setFormError] = useState('');
  const { formState: { errors }, handleSubmit, register, setValue } = useForm<ProviderForm>({ mode: 'onBlur', values: form });
  useEffect(() => {
    setEditingApiKey(!existing);
  }, [existing]);
  // 把t('pages.modelProviders.string_62')封装成 react-hook-form 风格的 submit handler。
  // 关键：返回 handleSubmit(...) 本身（一个事件处理函数），由 onClick 触发，不再 IIFE 立即执行。
  const makeSubmit = (handler: (draft: ProviderForm) => void) => handleSubmit((draft) => {
    const parsed = providerFormSchema.safeParse(draft);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? t('pages.modelProviders.string_63'));
      return;
    }
    setFormError('');
    handler(parsed.data);
  });
  const onSubmitSave = makeSubmit(onSave);
  const onSubmitTest = makeSubmit(onTest);
  const upperCurrency = (value: string) => setValue('currency', value.toUpperCase(), { shouldDirty: true, shouldValidate: true });
  const updateSecret = () => {
    setEditingApiKey(true);
    setValue('apiKey', '', { shouldDirty: true });
  };
  return <div className="panel provider-editor">
    <div className="panel-title"><CloudCog size={15} />{existing ? t('pages.modelProviders.string_64') : t('pages.modelProviders.string_65')} <span>OpenAI-compatible</span></div>
    {!existing && <div className="provider-templates">{templates.map((template) =>
      <button key={template.label} onClick={() => onTemplate(template)}><Server size={13} /><span>{template.label}</span><b>{template.baseUrl.replace(/^https?:\/\//, '')}</b></button>)}</div>}
    <div className="provider-form-grid">
      <label>{t('pages.modelProviders.string_18')}<input {...register('name', { required: true })} placeholder="Team Model Gateway" />{errors.name && <em>{t('pages.modelProviders.string_19')}</em>}</label>
      <label>{t('pages.modelProviders.string_20')}<input {...register('defaultModel', { required: true })} placeholder="model-name" />{errors.defaultModel && <em>{t('pages.modelProviders.string_21')}</em>}</label>
      <label className="wide">BASE URL<input {...register('baseUrl', { required: true })} placeholder="https://gateway.example.com/v1" />{errors.baseUrl && <em>{t('pages.modelProviders.string_22')}</em>}</label>
      <label className="wide">API KEY <span>{existing ? t('pages.modelProviders.string_66') : t('pages.modelProviders.string_67')}</span>{existing && !editingApiKey
        ? <div className="secret-placeholder"><KeyRound size={14} /><strong>{t('pages.modelProviders.string_23')}</strong><button type="button" onClick={updateSecret}>{t('pages.modelProviders.string_24')}</button></div>
        : <div className="secret-input"><KeyRound size={14} /><input type="password" autoComplete="off" {...register('apiKey')} placeholder={existing ? t('pages.modelProviders.string_68') : 'sk-...'} /></div>}</label>
      <label>{t('pages.modelProviders.string_25')}<input type="number" min="0" step="0.000001" {...register('inputPricePer1MTokens', { valueAsNumber: true })} />{errors.inputPricePer1MTokens && <em>{t('pages.modelProviders.string_26')}</em>}</label>
      <label>{t('pages.modelProviders.string_27')}<input type="number" min="0" step="0.000001" {...register('outputPricePer1MTokens', { valueAsNumber: true })} />{errors.outputPricePer1MTokens && <em>{t('pages.modelProviders.string_28')}</em>}</label>
      <label>{t('pages.modelProviders.string_29')}<input {...register('currency', { onChange: (event) => upperCurrency(String(event.target.value)) })} placeholder="USD" />{errors.currency && <em>{t('pages.modelProviders.string_30')}</em>}</label>
    </div>
    <div className="provider-switches">
      <label><input type="checkbox" {...register('enabled')} /><span><b>{t('pages.modelProviders.string_31')}</b>{t('pages.modelProviders.string_32')}</span></label>
      <label><input type="checkbox" {...register('isDefault')} /><span><b>{t('pages.modelProviders.string_33')}</b>{t('pages.modelProviders.string_34')}</span></label>
      {existing && <label><input type="checkbox" {...register('clearApiKey')} /><span><b>{t('pages.modelProviders.string_35')}</b>{t('pages.modelProviders.string_36')}</span></label>}
    </div>
    {formError && <div className="notice warning">{formError}</div>}
    {testResult && <div className={`draft-test-result readout-${testResult.status}`}>
      <Wifi size={15} /><div><strong>{testResult.status === 'healthy' ? t('pages.modelProviders.string_69') : t('pages.modelProviders.string_70')}</strong><span>{testResult.message}</span></div>
      <aside><b>{formatDuration(testResult.latencyMs)}</b><span>{testResult.modelCount} models</span></aside>
    </div>}
    <div className="provider-actions">
      <button disabled={busy === 'test:draft'} onClick={onSubmitTest}><Wifi size={14} />{busy === 'test:draft' ? t('pages.modelProviders.string_71') : t('pages.modelProviders.string_72')}</button>
      <button className="primary" disabled={busy === 'save'} onClick={onSubmitSave}><Save size={14} />{busy === 'save' ? t('pages.modelProviders.string_73') : t('pages.modelProviders.string_74')}</button>
      <button onClick={onCancel}>{t('common.cancel')}</button>
    </div>
  </div>;
}
