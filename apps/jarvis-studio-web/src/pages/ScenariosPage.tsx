import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemedSelect } from "../components/ThemedSelect.tsx";
import { FilePlus2, Layers, Pencil, PlayCircle, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, Loading, Metric, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';
import { formatDate } from '../utils/format.ts';

interface Workspace { id: string; name: string }
interface Scenario {
  id: string;
  name: string;
  category?: string;
  description?: string;
  defaultSkillId?: string;
  requiredTools: string[];
  defaultOutputs: string[];
  preflight: unknown[];
  postflight: unknown[];
}

interface ScenarioForm {
  name: string;
  category: string;
  description: string;
  defaultSkillId: string;
  requiredTools: string;
  defaultOutputs: string;
  preflight: RuleDraft[];
  postflight: RuleDraft[];
  customPreflight: unknown[];
  customPostflight: unknown[];
}

interface RuleDraft {
  id: string;
  enabled: boolean;
  value: string;
}

interface RulePreset {
  id: string;
  label: string;
  description: string;
  valueLabel?: string;
  placeholder?: string;
  multiline?: boolean;
}

const preflightPresets: RulePreset[] = [
  { id: 'input_file_exists', label: '文件存在检查', description: '确认任务输入文件在评测空间内真实存在。' },
  { id: 'input_file_is_xlsx_or_csv', label: 'Excel/CSV 类型检查', description: '限制输入文件必须是 xlsx、xls 或 csv。' },
  { id: 'input_file_is_txt_or_docx', label: '文本/文档类型检查', description: '限制输入文件必须是 txt、md、markdown 或 docx。' },
  { id: 'file_size_under_limit', label: '文件大小限制', description: '确认输入文件不超过 25MB。' },
  { id: 'workspace_is_git_repo', label: 'Git 工作区检查', description: '确认 Workspace 位于 Git 工作区内。' },
  { id: 'required_skill_available', label: 'Skill 可用性', description: '确认默认 Skill 已注册且未禁用。' },
  { id: 'required_tools_available', label: 'Tool 注册检查', description: '确认场景必需工具都已在 Runtime 注册。' },
  { id: 'model_profile_available', label: '模型服务商检查', description: '确认默认模型 Profile 可解析。' }
];

const postflightPresets: RulePreset[] = [
  { id: 'artifact_exists', label: '最终产物校验', description: '确认运行后生成指定 Artifact。', valueLabel: 'Artifact 名称或后缀', placeholder: 'analysis_report.md' },
  { id: 'must_include_sections', label: '报告章节校验', description: '确认首个文本 Artifact 包含必需章节。', valueLabel: '必需章节', placeholder: '数据概况\n异常发现\n营销建议', multiline: true },
  { id: 'no_empty_sections', label: '非空内容校验', description: '确认文本产物不是空报告。' },
  { id: 'length_in_range', label: '报告长度范围', description: '确认报告长度在可审阅范围内。' },
  { id: 'no_source_file_changed_without_approval', label: '高风险修改审批', description: '确认源代码修改类工具调用已经审批。' }
];

const blankScenarioForm: ScenarioForm = {
  name: '客户清单异常分析',
  category: 'data-analysis',
  description: '验证 Agent 是否能读取 Excel、识别异常并生成营销建议。',
  defaultSkillId: 'excel-data-analysis',
  requiredTools: 'xlsx.inspect\npython.run\nfilesystem.write',
  defaultOutputs: 'analysis_report.md',
  preflight: preflightPresets.map((preset) => ({ id: preset.id, enabled: ['input_file_exists', 'input_file_is_xlsx_or_csv', 'required_skill_available', 'required_tools_available', 'model_profile_available'].includes(preset.id), value: '' })),
  postflight: postflightPresets.map((preset) => ({ id: preset.id, enabled: ['artifact_exists', 'must_include_sections', 'no_empty_sections', 'length_in_range'].includes(preset.id), value: preset.id === 'artifact_exists' ? 'analysis_report.md' : preset.id === 'must_include_sections' ? '数据概况\n异常发现\n营销建议' : '' })),
  customPreflight: [],
  customPostflight: []
};

export function ScenariosPage() {
  const [selectedId, setSelectedId] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [inputFiles, setInputFiles] = useState('input/customer_data.xlsx');
  const [preflight, setPreflight] = useState<unknown>();
  const [editingMode, setEditingMode] = useState<'new' | 'edit' | ''>('');
  const [form, setForm] = useState<ScenarioForm>(blankScenarioForm);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async (signal: AbortSignal) => {
    const [items, workspaces] = await Promise.all([
      api<Scenario[]>('/api/scenarios', { signal }),
      api<Workspace[]>('/api/workspaces', { signal })
    ]);
    return { items, workspaces };
  }, []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['scenarios-page'] });
  const items = resource.data?.items;
  const displayItems = items ?? [];
  const workspaces = resource.data?.workspaces ?? [];
  const selected = useMemo(() => displayItems.find((item) => item.id === selectedId) ?? displayItems[0], [displayItems, selectedId]);
  useEffect(() => {
    const data = resource.data;
    if (!data) return;
    setSelectedId((current) => current || data.items[0]?.id || '');
    setWorkspaceId((current) => current || data.workspaces[0]?.id || '');
  }, [resource.data]);
  const runPreflight = async () => {
    if (!selected) return;
    setNotice('');
    try {
      const result = await post(`/api/scenarios/${selected.id}/preflight`, {
        workspaceId,
        inputFiles: lines(inputFiles)
      });
      setPreflight(result);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Scenario Preflight 失败');
    }
  };
  const startCreate = () => {
    setSelectedId('');
    setPreflight(undefined);
    setForm(blankScenarioForm);
    setEditingMode('new');
  };
  const startEdit = () => {
    if (!selected) return;
    setNotice('');
    setPreflight(undefined);
    setForm(formFromScenario(selected));
    setEditingMode('edit');
  };
  const save = async () => {
    setBusy('save');
    setNotice('');
    try {
      const payload = scenarioPayload(form);
      const saved = editingMode === 'new'
        ? await post<Scenario>('/api/scenarios', payload)
        : await api<Scenario>(`/api/scenarios/${selected?.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      setEditingMode('');
      setSelectedId(saved.id);
      setNotice(`评测场景「${saved.name}」已保存。`);
      await resource.reload();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '保存评测场景失败');
    } finally {
      setBusy('');
    }
  };
  const remove = async () => {
    if (!selected || !window.confirm(`删除评测场景「${selected.name}」？已关联任务会解除场景绑定。`)) return;
    setBusy('delete');
    setNotice('');
    try {
      await api(`/api/scenarios/${selected.id}`, { method: 'DELETE' });
      resource.setData(resource.data ? { ...resource.data, items: resource.data.items.filter((item) => item.id !== selected.id) } : undefined);
      setSelectedId('');
      setPreflight(undefined);
      setEditingMode('');
      setNotice(`评测场景「${selected.name}」已删除。`);
      await resource.reload();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '删除评测场景失败');
    } finally {
      setBusy('');
    }
  };

  return <section>
    <PageHeader eyebrow="V0.5 / Eval Scenario Template" title="评测场景模板" description="维护可复用的 Agent Runtime 场景验证模板：默认 Skill、必需工具、前置检查和完成后验收规则，用于生成标准化测试任务。"
      actions={<><button onClick={() => void resource.reload()}><RefreshCw size={14} />刷新</button><button className="primary" onClick={startCreate}><Plus size={14} />新建场景</button></>} />
    {(resource.error || notice) && <div className="notice warning">{resource.error || notice}</div>}
    <div className="metric-grid compact">
      <Metric label="SCENARIOS" value={displayItems.length} tone="cyan" />
      <Metric label="SKILLS" value={new Set(displayItems.map((item) => item.defaultSkillId).filter(Boolean)).size} />
      <Metric label="TOOLS" value={new Set(displayItems.flatMap((item) => item.requiredTools)).size} tone="amber" />
      <Metric label="STATUS" value="preflightable" tone="green" />
      <Metric label="MODEL" value={selected?.category ?? '—'} />
    </div>
    <div className="workbench-grid">
      <div className="panel registry-list">
        <div className="panel-title"><Layers size={15} />评测场景列表 <span>{displayItems.length}</span></div>
        {resource.loading && !items ? <Loading /> : displayItems.length ? displayItems.map((item) => <button key={item.id} className={selected?.id === item.id ? 'active' : ''} onClick={() => { setSelectedId(item.id); setPreflight(undefined); setEditingMode(''); }}>
          <StatusBadge status="enabled" />
          <div><strong>{item.name}</strong><span>{item.category} · {item.defaultSkillId}</span><p>{item.description}</p></div>
          <aside><b>{item.requiredTools.length} tools</b><span>{item.defaultOutputs.join(', ')}</span></aside>
        </button>) : <Empty>尚未配置评测场景模板。</Empty>}
        <div className="mini-form task-create-entry"><button className="primary" onClick={startCreate}><FilePlus2 size={14} />打开新建场景表单</button></div>
      </div>
      <div className="panel workbench-detail">
        {editingMode ? <ScenarioEditor mode={editingMode} form={form} busy={busy === 'save'} onChange={setForm} onCancel={() => setEditingMode('')} onSave={() => void save()} />
          : selected ? <ScenarioDetail scenario={selected} preflight={preflight} workspaceId={workspaceId} workspaces={workspaces} inputFiles={inputFiles} busy={busy}
            onWorkspace={setWorkspaceId} onInputFiles={setInputFiles} onPreflight={() => void runPreflight()} onEdit={startEdit} onDelete={() => void remove()} />
            : <Empty>尚未创建评测场景模板。</Empty>}
      </div>
    </div>
  </section>;
}

function ScenarioDetail({ scenario, preflight, workspaceId, workspaces, inputFiles, busy, onWorkspace, onInputFiles, onPreflight, onEdit, onDelete }: {
  scenario: Scenario;
  preflight: unknown;
  workspaceId: string;
  workspaces: Workspace[];
  inputFiles: string;
  busy: string;
  onWorkspace: (value: string) => void;
  onInputFiles: (value: string) => void;
  onPreflight: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return <>
    <div className="panel-title">Eval Scenario Contract <span>{scenario.id}</span></div>
    <div className="provider-actions task-detail-actions">
      <Link className="primary-link" to={`/tasks?scenarioTemplateId=${encodeURIComponent(scenario.id)}&create=1`}>基于模板新建任务</Link>
      <button onClick={onEdit}><Pencil size={14} />编辑</button>
      <button className="danger" disabled={busy === 'delete'} onClick={onDelete}><Trash2 size={14} />删除</button>
    </div>
    <div className="registry-facts">
      <span>Skill<b>{scenario.defaultSkillId ?? '—'}</b></span>
      <span>Category<b>{scenario.category ?? '—'}</b></span>
      <span>Tools<b>{scenario.requiredTools.length}</b></span>
      <span>Outputs<b>{scenario.defaultOutputs.length}</b></span>
    </div>
    <div className="scenario-rule-summary">
      <RuleSummary title="Preflight 规则" rules={scenario.preflight} presets={preflightPresets} />
      <RuleSummary title="Postflight 规则" rules={scenario.postflight} presets={postflightPresets} />
    </div>
    <div className="scenario-preflight">
      <label>验证空间<ThemedSelect value={workspaceId} onChange={(event) => onWorkspace(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</ThemedSelect></label>
      <label>输入文件<textarea rows={2} placeholder="input/customer_data.xlsx" value={inputFiles} onChange={(event) => onInputFiles(event.target.value)} /></label>
      <button className="primary" onClick={onPreflight}><PlayCircle size={14} />运行 Preflight</button>
    </div>
    <div className="workbench-split">
      <CheckResultPanel title="Preflight Result" value={preflight} />
      <div><h3>模板输出约束</h3><div className="chip-row">{scenario.requiredTools.map((tool) => <span key={tool}>{tool}</span>)}{scenario.defaultOutputs.map((output) => <span key={output}>{output}</span>)}</div></div>
    </div>
  </>;
}

function ScenarioEditor({ mode, form, busy, onChange, onCancel, onSave }: {
  mode: 'new' | 'edit';
  form: ScenarioForm;
  busy: boolean;
  onChange: (form: ScenarioForm) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return <div className="scenario-editor">
    <div className="panel-title"><Pencil size={15} />{mode === 'new' ? '新建评测场景' : '编辑评测场景'} <span>{mode === 'new' ? 'POST /api/scenarios' : 'PUT /api/scenarios/:id'}</span></div>
    <div className="run-form-grid task-form-grid">
      <label>场景名称<input placeholder="例如：客户清单异常分析" value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} /></label>
      <label>分类<input placeholder="例如：data-analysis / coding / office" value={form.category} onChange={(event) => onChange({ ...form, category: event.target.value })} /></label>
      <label>默认 Skill<input placeholder="例如：excel-data-analysis" value={form.defaultSkillId} onChange={(event) => onChange({ ...form, defaultSkillId: event.target.value })} /></label>
      <label>默认输出<textarea rows={3} placeholder="每行一个输出文件名，例如：analysis_report.md" value={form.defaultOutputs} onChange={(event) => onChange({ ...form, defaultOutputs: event.target.value })} /></label>
      <label className="wide">场景说明<input placeholder="说明该模板验证的 Agent 能力与成功标准" value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} /></label>
      <label className="wide">必需工具<textarea rows={4} placeholder="每行一个工具名，例如：&#10;xlsx.inspect&#10;python.run&#10;filesystem.write" value={form.requiredTools} onChange={(event) => onChange({ ...form, requiredTools: event.target.value })} /></label>
    </div>
    <div className="scenario-builder-grid">
      <RuleBuilder title="Preflight 前置检查" presets={preflightPresets} rules={form.preflight} onChange={(preflight) => onChange({ ...form, preflight })} customRules={form.customPreflight} />
      <RuleBuilder title="Postflight 后置验收" presets={postflightPresets} rules={form.postflight} onChange={(postflight) => onChange({ ...form, postflight })} customRules={form.customPostflight} />
    </div>
    <div className="modal-actions"><button onClick={onCancel}><X size={14} />取消</button><button className="primary" disabled={busy || !form.name.trim()} onClick={onSave}><Save size={14} />{busy ? '保存中' : '保存场景'}</button></div>
  </div>;
}

function RuleBuilder({ title, presets, rules, customRules, onChange }: {
  title: string;
  presets: RulePreset[];
  rules: RuleDraft[];
  customRules: unknown[];
  onChange: (rules: RuleDraft[]) => void;
}) {
  const update = (id: string, patch: Partial<RuleDraft>) => onChange(rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  return <div className="panel rule-builder">
    <div className="panel-title"><Layers size={15} />{title}<span>{rules.filter((rule) => rule.enabled).length}</span></div>
    {rules.map((rule) => {
      const preset = presets.find((item) => item.id === rule.id);
      return <label className="rule-row" key={rule.id}>
        <input type="checkbox" checked={rule.enabled} onChange={(event) => update(rule.id, { enabled: event.target.checked })} />
        <span><b>{preset?.label ?? rule.id}</b><em>{preset?.description ?? rule.id}</em></span>
        {preset?.valueLabel && (preset.multiline
          ? <textarea rows={3} disabled={!rule.enabled} placeholder={preset.placeholder} value={rule.value} onChange={(event) => update(rule.id, { value: event.target.value })} />
          : <input disabled={!rule.enabled} placeholder={preset.placeholder} value={rule.value} onChange={(event) => update(rule.id, { value: event.target.value })} />)}
      </label>;
    })}
    {customRules.length > 0 && <div className="notice warning">存在 {customRules.length} 条未识别规则，保存时会原样保留。</div>}
  </div>;
}

function RuleSummary({ title, rules, presets }: { title: string; rules: unknown[]; presets: RulePreset[] }) {
  return <div className="panel rule-summary">
    <div className="panel-title">{title}<span>{rules.length}</span></div>
    {rules.length ? <div className="rule-summary-list">{rules.map((rule, index) => {
      const id = checkId(rule);
      const preset = presets.find((item) => item.id === id);
      return <div key={`${id}-${index}`}><StatusBadge status="enabled" /><strong>{preset?.label ?? id}</strong><span>{ruleText(rule)}</span></div>;
    })}</div> : <Empty>尚未配置规则。</Empty>}
  </div>;
}

function CheckResultPanel({ title, value }: { title: string; value: unknown }) {
  const summary = checkResultSummary(value);
  return <div>
    <h3>{title}</h3>
    <div className="check-result-head"><StatusBadge status={summary.status} /><span>{summary.checkedAt || '尚未执行'}</span></div>
    {summary.checks.length ? <div className="check-result-grid">{summary.checks.map((check, index) => <article key={`${check.id}-${index}`} className={`check-card check-${check.status}`}>
      <StatusBadge status={check.status} /><strong>{check.id}</strong><p>{check.detail}</p>
    </article>)}</div> : <Empty>{title} 尚未产生检查结果。</Empty>}
  </div>;
}

function formFromScenario(scenario: Scenario): ScenarioForm {
  return {
    name: scenario.name,
    category: scenario.category ?? '',
    description: scenario.description ?? '',
    defaultSkillId: scenario.defaultSkillId ?? '',
    requiredTools: scenario.requiredTools.join('\n'),
    defaultOutputs: scenario.defaultOutputs.join('\n'),
    preflight: draftsFromRules(preflightPresets, scenario.preflight),
    postflight: draftsFromRules(postflightPresets, scenario.postflight),
    customPreflight: scenario.preflight.filter((rule) => !preflightPresets.some((preset) => preset.id === checkId(rule))),
    customPostflight: scenario.postflight.filter((rule) => !postflightPresets.some((preset) => preset.id === checkId(rule)))
  };
}

function draftsFromRules(presets: RulePreset[], rules: unknown[]) {
  return presets.map((preset) => {
    const existing = rules.find((rule) => checkId(rule) === preset.id);
    return {
      id: preset.id,
      enabled: existing !== undefined,
      value: existing ? ruleValue(existing) : ''
    };
  });
}

function scenarioPayload(form: ScenarioForm) {
  return {
    name: form.name.trim(),
    category: form.category.trim() || undefined,
    description: form.description.trim() || undefined,
    defaultSkillId: form.defaultSkillId.trim() || undefined,
    requiredTools: lines(form.requiredTools),
    defaultOutputs: lines(form.defaultOutputs),
    preflight: [...form.customPreflight, ...preflightRules(form.preflight)],
    postflight: [...form.customPostflight, ...postflightRules(form.postflight)]
  };
}

function preflightRules(rules: RuleDraft[]) {
  return rules.filter((rule) => rule.enabled).map((rule) => rule.id);
}

function postflightRules(rules: RuleDraft[]) {
  return rules.filter((rule) => rule.enabled).map((rule) => {
    if (rule.id === 'artifact_exists') return { artifact_exists: rule.value.trim() || 'analysis_report.md' };
    if (rule.id === 'must_include_sections') return { must_include_sections: lines(rule.value) };
    return rule.id;
  });
}

function ruleValue(rule: unknown) {
  if (!rule || typeof rule !== 'object') return '';
  const record = rule as Record<string, unknown>;
  if ('artifact_exists' in record) return String(record.artifact_exists ?? '');
  if ('must_include_sections' in record) return Array.isArray(record.must_include_sections) ? record.must_include_sections.map(String).join('\n') : '';
  return '';
}

function checkId(rule: unknown) {
  if (typeof rule === 'string') return rule;
  if (rule && typeof rule === 'object') return Object.keys(rule as Record<string, unknown>)[0] ?? 'unknown';
  return 'unknown';
}

function ruleText(rule: unknown) {
  const value = ruleValue(rule);
  if (value) return value.replace(/\n/g, ' / ');
  return checkId(rule);
}

function lines(text: string) {
  return text.split('\n').flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean);
}

function checkResultSummary(value: unknown) {
  if (!value || typeof value !== 'object') return { status: 'pending', checkedAt: '', checks: [] as Array<{ id: string; status: string; detail: string }> };
  const record = value as Record<string, unknown>;
  const rawChecks = Array.isArray(record.checks) ? record.checks : [];
  return {
    status: typeof record.status === 'string' ? record.status : 'pending',
    checkedAt: typeof record.checkedAt === 'string' ? formatDate(record.checkedAt) : '',
    checks: rawChecks.map((item) => {
      const check = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return {
        id: typeof check.id === 'string' ? check.id : 'unknown_check',
        status: typeof check.status === 'string' ? check.status : 'warning',
        detail: typeof check.detail === 'string' ? check.detail : JSON.stringify(check)
      };
    })
  };
}
