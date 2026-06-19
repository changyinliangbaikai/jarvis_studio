import { useEffect, useState } from 'react';
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

const providerFormSchema = z.object({
  name: z.string().trim().min(1, '配置名称不能为空'),
  baseUrl: z.string().trim().url('Base URL 必须是合法 URL'),
  defaultModel: z.string().trim().min(1, '默认模型不能为空'),
  apiKey: z.string().optional().default(''),
  clearApiKey: z.boolean(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  inputPricePer1MTokens: z.coerce.number().min(0, '输入价格不能为负数'),
  outputPricePer1MTokens: z.coerce.number().min(0, '输出价格不能为负数'),
  currency: z.string().trim().min(3, '币种至少 3 位').max(8, '币种过长').transform((value) => value.toUpperCase())
});

export function ModelProvidersPage() {
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
      setNotice(`已保存 Provider「${saved.name}」，API Key 不会返回到浏览器。`);
      await refresh(saved.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存 Provider 失败');
    } finally {
      setBusy('');
    }
  };
  const remove = async () => {
    if (!selected || selected.readOnly || !window.confirm(`删除 Provider「${selected.name}」？`)) return;
    setBusy('delete'); setError(''); setNotice('');
    try {
      await api(`/api/model-providers/${selected.id}`, { method: 'DELETE' });
      setEditingId(undefined);
      setNotice(`已删除 Provider「${selected.name}」。`);
      await refresh('builtin-deterministic');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除 Provider 失败');
    } finally {
      setBusy('');
    }
  };
  const test = async (provider: ModelProvider) => {
    setBusy(`test:${provider.id}`); setError(''); setNotice('');
    try {
      const result = await post<TestResult>(`/api/model-providers/${provider.id}/test`, {});
      setNotice(`${provider.name}：${result.message}，耗时 ${formatDuration(result.latencyMs)}。`);
      await refresh(provider.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '连接测试失败');
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
      setError(caught instanceof Error ? caught.message : '当前配置连接测试失败');
    } finally {
      setBusy('');
    }
  };

  const registryCount = providers.filter((item) => item.source === 'registry').length;
  const healthyCount = providers.filter((item) => item.lastTestStatus === 'healthy').length;
  const keyCount = providers.filter((item) => item.apiKeyConfigured).length;
  if (loading && !items) return <Loading />;
  return <section>
    <PageHeader eyebrow="10 / 模型服务商 (Model Providers)" title="Provider 信号舱" description="集中配置 OpenAI-compatible 大模型服务。密钥在服务端加密保存，Runtime 只使用 Provider ID。"
      actions={<button className="primary" onClick={() => create()}><Plus size={15} />新增服务商</button>} />
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
        <div className="panel-title"><CloudCog size={15} />服务商注册表 <span>{providers.length} 个配置</span></div>
        <div className="provider-items">{providers.map((provider) =>
          <button key={provider.id} className={selectedId === provider.id ? 'active' : ''} onClick={() => edit(provider)}>
            <i className={`provider-signal signal-${provider.lastTestStatus ?? (provider.enabled ? 'unknown' : 'disabled')}`} />
            <div><strong>{provider.name}</strong><span>{provider.source} · {provider.providerType}</span><code>{provider.defaultModel}</code></div>
            <aside>{provider.isDefault && <b>默认</b>}<em>{provider.enabled ? '已启用' : '已停用'}</em></aside>
          </button>)}
        </div>
        <div className="provider-security"><ShieldCheck size={15} /><div><strong>密钥边界</strong><span>API Key 使用本机密钥 AES-256-GCM 加密，列表与 Runtime 请求均不返回明文。</span></div></div>
      </div>
      <div className="provider-workbench">
        {editingId ? <ProviderEditor form={form} existing={editingId !== 'new'} busy={busy} testResult={draftTest} onSave={(draft) => void save(draft)} onTest={(draft) => void testDraft(draft)} onCancel={() => setEditingId(undefined)} onTemplate={create} />
          : selected ? <ProviderDetail provider={selected} busy={busy} onEdit={() => edit(selected)} onTest={() => void test(selected)} onDelete={() => void remove()} />
            : <div className="panel provider-empty"><Server size={28} /><h2>注册模型服务信号</h2><p>选择模板或新增一个 OpenAI-compatible Provider。</p><button className="primary" onClick={() => create()}><Plus size={14} />新增服务商</button></div>}
      </div>
    </div>
  </section>;
}

function ProviderDetail({ provider, busy, onEdit, onTest, onDelete }: { provider: ModelProvider; busy: string; onEdit: () => void; onTest: () => void; onDelete: () => void }) {
  return <div className="panel provider-detail">
    <div className="panel-title"><Server size={15} />服务商详情 <span>{provider.id}</span></div>
    <div className="provider-hero">
      <div className={`provider-orbit orbit-${provider.lastTestStatus ?? 'unknown'}`}><Wifi size={28} /></div>
      <div><span className="eyebrow">{provider.source.toUpperCase()} / {provider.providerType.toUpperCase()}</span><h2>{provider.name}</h2><p>{provider.readOnly ? '此配置由系统或环境变量管理。' : '此配置保存在本地 Provider Registry。'}</p></div>
      <StatusBadge status={provider.lastTestStatus === 'failed' ? 'failed' : provider.enabled ? 'success' : 'running'} />
    </div>
    <div className="provider-facts">
      <div><span>Base URL</span><code>{provider.baseUrl ?? 'local://deterministic'}</code></div>
      <div><span>默认模型</span><code>{provider.defaultModel}</code></div>
      <div><span>API Key</span><code>{provider.apiKeyHint ?? (provider.apiKeyConfigured ? '•••• 已配置' : '不需要')}</code></div>
      <div><span>默认路由</span><code>{provider.isDefault ? '是' : '否'}</code></div>
      <div><span>输入价格 / 1M Token</span><code>{provider.inputPricePer1MTokens} {provider.currency}</code></div>
      <div><span>输出价格 / 1M Token</span><code>{provider.outputPricePer1MTokens} {provider.currency}</code></div>
    </div>
    <div className={`connection-readout readout-${provider.lastTestStatus ?? 'unknown'}`}>
      <Wifi size={16} /><div><strong>{provider.lastTestStatus ?? '未测试'}</strong><span>{provider.lastTestMessage ?? '尚未执行连接测试。'}</span></div>
      <aside><b>{provider.lastTestLatencyMs === undefined ? '—' : formatDuration(provider.lastTestLatencyMs)}</b><span>{formatDate(provider.lastTestedAt)}</span></aside>
    </div>
    <div className="provider-actions">
      <button className="primary" disabled={busy === `test:${provider.id}`} onClick={onTest}><Wifi size={14} />{busy === `test:${provider.id}` ? '测试中' : '测试连接'}</button>
      {!provider.readOnly && <button onClick={onEdit}><CloudCog size={14} />编辑配置</button>}
      {!provider.readOnly && <button className="danger" disabled={busy === 'delete'} onClick={onDelete}><Trash2 size={14} />删除</button>}
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
  const [editingApiKey, setEditingApiKey] = useState(!existing);
  const [formError, setFormError] = useState('');
  const { formState: { errors }, handleSubmit, register, setValue } = useForm<ProviderForm>({ mode: 'onBlur', values: form });
  useEffect(() => {
    setEditingApiKey(!existing);
  }, [existing]);
  // 把"用 zod 二次校验后再交给 handler"封装成 react-hook-form 风格的 submit handler。
  // 关键：返回 handleSubmit(...) 本身（一个事件处理函数），由 onClick 触发，不再 IIFE 立即执行。
  const makeSubmit = (handler: (draft: ProviderForm) => void) => handleSubmit((draft) => {
    const parsed = providerFormSchema.safeParse(draft);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? '表单校验失败');
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
    <div className="panel-title"><CloudCog size={15} />{existing ? '编辑服务商' : '注册服务商'} <span>OpenAI-compatible</span></div>
    {!existing && <div className="provider-templates">{templates.map((template) =>
      <button key={template.label} onClick={() => onTemplate(template)}><Server size={13} /><span>{template.label}</span><b>{template.baseUrl.replace(/^https?:\/\//, '')}</b></button>)}</div>}
    <div className="provider-form-grid">
      <label>配置名称<input {...register('name', { required: true })} placeholder="Team Model Gateway" />{errors.name && <em>必填</em>}</label>
      <label>默认模型<input {...register('defaultModel', { required: true })} placeholder="model-name" />{errors.defaultModel && <em>必填</em>}</label>
      <label className="wide">BASE URL<input {...register('baseUrl', { required: true })} placeholder="https://gateway.example.com/v1" />{errors.baseUrl && <em>请输入合法 URL</em>}</label>
      <label className="wide">API KEY <span>{existing ? '默认保留已保存密钥' : '本地加密保存'}</span>{existing && !editingApiKey
        ? <div className="secret-placeholder"><KeyRound size={14} /><strong>已保存的密钥不会返回浏览器</strong><button type="button" onClick={updateSecret}>更新 API Key</button></div>
        : <div className="secret-input"><KeyRound size={14} /><input type="password" autoComplete="off" {...register('apiKey')} placeholder={existing ? '输入新 API Key，留空则保留' : 'sk-...'} /></div>}</label>
      <label>输入价格 / 1M Token<input type="number" min="0" step="0.000001" {...register('inputPricePer1MTokens', { valueAsNumber: true })} />{errors.inputPricePer1MTokens && <em>不能为负数</em>}</label>
      <label>输出价格 / 1M Token<input type="number" min="0" step="0.000001" {...register('outputPricePer1MTokens', { valueAsNumber: true })} />{errors.outputPricePer1MTokens && <em>不能为负数</em>}</label>
      <label>币种<input {...register('currency', { onChange: (event) => upperCurrency(String(event.target.value)) })} placeholder="USD" />{errors.currency && <em>币种格式错误</em>}</label>
    </div>
    <div className="provider-switches">
      <label><input type="checkbox" {...register('enabled')} /><span><b>启用</b>允许 Runtime 使用此配置</span></label>
      <label><input type="checkbox" {...register('isDefault')} /><span><b>默认路由</b>新建 Run 默认使用此配置</span></label>
      {existing && <label><input type="checkbox" {...register('clearApiKey')} /><span><b>清除密钥</b>删除已保存的 API Key</span></label>}
    </div>
    {formError && <div className="notice warning">{formError}</div>}
    {testResult && <div className={`draft-test-result readout-${testResult.status}`}>
      <Wifi size={15} /><div><strong>{testResult.status === 'healthy' ? '当前配置连接成功' : '当前配置连接失败'}</strong><span>{testResult.message}</span></div>
      <aside><b>{formatDuration(testResult.latencyMs)}</b><span>{testResult.modelCount} models</span></aside>
    </div>}
    <div className="provider-actions">
      <button disabled={busy === 'test:draft'} onClick={onSubmitTest}><Wifi size={14} />{busy === 'test:draft' ? '测试中' : '测试当前配置'}</button>
      <button className="primary" disabled={busy === 'save'} onClick={onSubmitSave}><Save size={14} />{busy === 'save' ? '保存中' : '保存服务商'}</button>
      <button onClick={onCancel}>取消</button>
    </div>
  </div>;
}
