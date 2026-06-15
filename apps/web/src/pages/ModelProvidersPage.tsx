import { useEffect, useMemo, useState } from 'react';
import { Check, CloudCog, KeyRound, Plus, Save, Server, ShieldCheck, Trash2, Wifi, X } from 'lucide-react';
import { api, formatDate, formatDuration, post } from '../api.ts';
import { Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';

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
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [selectedId, setSelectedId] = useState('builtin-deterministic');
  const [editingId, setEditingId] = useState<string>();
  const [form, setForm] = useState<ProviderForm>(blank);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [draftTest, setDraftTest] = useState<TestResult>();
  const selected = useMemo(() => providers.find((provider) => provider.id === selectedId), [providers, selectedId]);

  const load = async (preferId?: string) => {
    const items = await api<ModelProvider[]>('/api/model-providers');
    setProviders(items);
    setSelectedId((current) => preferId ?? (items.some((item) => item.id === current) ? current : items[0]?.id ?? ''));
  };
  useEffect(() => { void load(); }, []);

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
  const save = async () => {
    setBusy('save'); setError(''); setNotice('');
    try {
      const saved = editingId === 'new'
        ? await post<ModelProvider>('/api/model-providers', form)
        : await api<ModelProvider>(`/api/model-providers/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
      setEditingId(undefined);
      setNotice(`已保存 Provider「${saved.name}」，API Key 不会返回到浏览器。`);
      await load(saved.id);
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
      await load('builtin-deterministic');
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
      await load(provider.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '连接测试失败');
    } finally {
      setBusy('');
    }
  };
  const testDraft = async () => {
    setBusy('test:draft'); setError(''); setNotice(''); setDraftTest(undefined);
    try {
      const result = await post<TestResult>('/api/model-providers/test-connection', {
        ...form,
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
  return <section>
    <PageHeader eyebrow="10 / MODEL PROVIDERS" title="Provider Signal Bay" description="集中配置 OpenAI-compatible 大模型服务。密钥在服务端加密保存，Runtime 只使用 Provider ID。"
      actions={<button className="primary" onClick={() => create()}><Plus size={15} />新增 Provider</button>} />
    {notice && <div className="notice"><Check size={14} />{notice}</div>}
    {error && <div className="notice warning"><X size={14} />{error}</div>}
    <div className="metric-grid">
      <Metric label="PROVIDER PROFILES" value={providers.length} tone="cyan" />
      <Metric label="REGISTRY MANAGED" value={registryCount} />
      <Metric label="HEALTHY SIGNALS" value={healthyCount} tone="green" />
      <Metric label="ENCRYPTED KEYS" value={keyCount} tone="amber" />
    </div>
    <div className="provider-layout">
      <div className="panel provider-list">
        <div className="panel-title"><CloudCog size={15} />PROVIDER REGISTRY <span>{providers.length} profiles</span></div>
        <div className="provider-items">{providers.map((provider) =>
          <button key={provider.id} className={selectedId === provider.id ? 'active' : ''} onClick={() => edit(provider)}>
            <i className={`provider-signal signal-${provider.lastTestStatus ?? (provider.enabled ? 'unknown' : 'disabled')}`} />
            <div><strong>{provider.name}</strong><span>{provider.source} · {provider.providerType}</span><code>{provider.defaultModel}</code></div>
            <aside>{provider.isDefault && <b>DEFAULT</b>}<em>{provider.enabled ? 'enabled' : 'disabled'}</em></aside>
          </button>)}
        </div>
        <div className="provider-security"><ShieldCheck size={15} /><div><strong>SECRET BOUNDARY</strong><span>API Key 使用本机密钥 AES-256-GCM 加密，列表与 Runtime 请求均不返回明文。</span></div></div>
      </div>
      <div className="provider-workbench">
        {editingId ? <ProviderEditor form={form} setForm={(next) => { setForm(next); setDraftTest(undefined); }} existing={editingId !== 'new'} busy={busy} testResult={draftTest} onSave={save} onTest={() => void testDraft()} onCancel={() => setEditingId(undefined)} onTemplate={create} />
          : selected ? <ProviderDetail provider={selected} busy={busy} onEdit={() => edit(selected)} onTest={() => void test(selected)} onDelete={() => void remove()} />
            : <div className="panel provider-empty"><Server size={28} /><h2>Register a model signal</h2><p>选择模板或新增一个 OpenAI-compatible Provider。</p><button className="primary" onClick={() => create()}><Plus size={14} />新增 Provider</button></div>}
      </div>
    </div>
  </section>;
}

function ProviderDetail({ provider, busy, onEdit, onTest, onDelete }: { provider: ModelProvider; busy: string; onEdit: () => void; onTest: () => void; onDelete: () => void }) {
  return <div className="panel provider-detail">
    <div className="panel-title"><Server size={15} />PROVIDER PROFILE <span>{provider.id}</span></div>
    <div className="provider-hero">
      <div className={`provider-orbit orbit-${provider.lastTestStatus ?? 'unknown'}`}><Wifi size={28} /></div>
      <div><span className="eyebrow">{provider.source.toUpperCase()} / {provider.providerType.toUpperCase()}</span><h2>{provider.name}</h2><p>{provider.readOnly ? '此配置由系统或环境变量管理。' : '此配置保存在本地 Provider Registry。'}</p></div>
      <StatusBadge status={provider.lastTestStatus === 'failed' ? 'failed' : provider.enabled ? 'success' : 'running'} />
    </div>
    <div className="provider-facts">
      <div><span>BASE URL</span><code>{provider.baseUrl ?? 'local://deterministic'}</code></div>
      <div><span>DEFAULT MODEL</span><code>{provider.defaultModel}</code></div>
      <div><span>API KEY</span><code>{provider.apiKeyHint ?? (provider.apiKeyConfigured ? '•••• configured' : 'not required')}</code></div>
      <div><span>DEFAULT ROUTE</span><code>{provider.isDefault ? 'yes' : 'no'}</code></div>
      <div><span>INPUT PRICE / 1M TOKENS</span><code>{provider.inputPricePer1MTokens} {provider.currency}</code></div>
      <div><span>OUTPUT PRICE / 1M TOKENS</span><code>{provider.outputPricePer1MTokens} {provider.currency}</code></div>
    </div>
    <div className={`connection-readout readout-${provider.lastTestStatus ?? 'unknown'}`}>
      <Wifi size={16} /><div><strong>{provider.lastTestStatus ?? 'UNTESTED'}</strong><span>{provider.lastTestMessage ?? '尚未执行连接测试。'}</span></div>
      <aside><b>{provider.lastTestLatencyMs === undefined ? '—' : formatDuration(provider.lastTestLatencyMs)}</b><span>{formatDate(provider.lastTestedAt)}</span></aside>
    </div>
    <div className="provider-actions">
      <button className="primary" disabled={busy === `test:${provider.id}`} onClick={onTest}><Wifi size={14} />{busy === `test:${provider.id}` ? '测试中' : '测试连接'}</button>
      {!provider.readOnly && <button onClick={onEdit}><CloudCog size={14} />编辑配置</button>}
      {!provider.readOnly && <button className="danger" disabled={busy === 'delete'} onClick={onDelete}><Trash2 size={14} />删除</button>}
    </div>
  </div>;
}

function ProviderEditor({ form, setForm, existing, busy, testResult, onSave, onTest, onCancel, onTemplate }: {
  form: ProviderForm;
  setForm: (form: ProviderForm) => void;
  existing: boolean;
  busy: string;
  testResult?: TestResult;
  onSave: () => void;
  onTest: () => void;
  onCancel: () => void;
  onTemplate: (template: typeof templates[number]) => void;
}) {
  const field = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) => setForm({ ...form, [key]: value });
  return <div className="panel provider-editor">
    <div className="panel-title"><CloudCog size={15} />{existing ? 'EDIT PROVIDER' : 'REGISTER PROVIDER'} <span>OpenAI-compatible</span></div>
    {!existing && <div className="provider-templates">{templates.map((template) =>
      <button key={template.label} onClick={() => onTemplate(template)}><Server size={13} /><span>{template.label}</span><b>{template.baseUrl.replace(/^https?:\/\//, '')}</b></button>)}</div>}
    <div className="provider-form-grid">
      <label>PROFILE NAME<input value={form.name} onChange={(event) => field('name', event.target.value)} placeholder="Team Model Gateway" /></label>
      <label>DEFAULT MODEL<input value={form.defaultModel} onChange={(event) => field('defaultModel', event.target.value)} placeholder="model-name" /></label>
      <label className="wide">BASE URL<input value={form.baseUrl} onChange={(event) => field('baseUrl', event.target.value)} placeholder="https://gateway.example.com/v1" /></label>
      <label className="wide">API KEY <span>{existing ? '留空则保留已保存密钥' : '本地加密保存'}</span><div className="secret-input"><KeyRound size={14} /><input type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => field('apiKey', event.target.value)} placeholder={existing ? '•••• keep existing' : 'sk-...'} /></div></label>
      <label>INPUT PRICE / 1M TOKENS<input type="number" min="0" step="0.000001" value={form.inputPricePer1MTokens} onChange={(event) => field('inputPricePer1MTokens', Number(event.target.value))} /></label>
      <label>OUTPUT PRICE / 1M TOKENS<input type="number" min="0" step="0.000001" value={form.outputPricePer1MTokens} onChange={(event) => field('outputPricePer1MTokens', Number(event.target.value))} /></label>
      <label>CURRENCY<input value={form.currency} onChange={(event) => field('currency', event.target.value.toUpperCase())} placeholder="USD" /></label>
    </div>
    <div className="provider-switches">
      <label><input type="checkbox" checked={form.enabled} onChange={(event) => field('enabled', event.target.checked)} /><span><b>ENABLED</b>允许 Runtime 使用此配置</span></label>
      <label><input type="checkbox" checked={form.isDefault} onChange={(event) => field('isDefault', event.target.checked)} /><span><b>DEFAULT ROUTE</b>新建 Run 默认使用此配置</span></label>
      {existing && <label><input type="checkbox" checked={form.clearApiKey} onChange={(event) => field('clearApiKey', event.target.checked)} /><span><b>CLEAR SECRET</b>删除已保存的 API Key</span></label>}
    </div>
    {testResult && <div className={`draft-test-result readout-${testResult.status}`}>
      <Wifi size={15} /><div><strong>{testResult.status === 'healthy' ? '当前配置连接成功' : '当前配置连接失败'}</strong><span>{testResult.message}</span></div>
      <aside><b>{formatDuration(testResult.latencyMs)}</b><span>{testResult.modelCount} models</span></aside>
    </div>}
    <div className="provider-actions">
      <button disabled={busy === 'test:draft'} onClick={onTest}><Wifi size={14} />{busy === 'test:draft' ? '测试中' : '测试当前配置'}</button>
      <button className="primary" disabled={busy === 'save'} onClick={onSave}><Save size={14} />{busy === 'save' ? '保存中' : '保存 Provider'}</button>
      <button onClick={onCancel}>取消</button>
    </div>
  </div>;
}
