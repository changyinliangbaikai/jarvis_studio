import { useTranslation } from 'react-i18next';
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

const getPreflightPresets = (t: (key: string) => string): RulePreset[] => [
  { id: 'input_file_exists', label: t('pages.scenarios.string_31'), description: t('pages.scenarios.string_32') },
  { id: 'input_file_is_xlsx_or_csv', label: t('pages.scenarios.string_33'), description: t('pages.scenarios.string_34') },
  { id: 'input_file_is_txt_or_docx', label: t('pages.scenarios.string_35'), description: t('pages.scenarios.string_36') },
  { id: 'file_size_under_limit', label: t('pages.scenarios.string_37'), description: t('pages.scenarios.string_38') },
  { id: 'workspace_is_git_repo', label: t('pages.scenarios.string_39'), description: t('pages.scenarios.string_40') },
  { id: 'required_skill_available', label: t('pages.scenarios.string_41'), description: t('pages.scenarios.string_42') },
  { id: 'required_tools_available', label: t('pages.scenarios.string_43'), description: t('pages.scenarios.string_44') },
  { id: 'model_profile_available', label: t('pages.scenarios.string_45'), description: t('pages.scenarios.string_46') }
];

const getPostflightPresets = (t: (key: string) => string): RulePreset[] => [
  { id: 'artifact_exists', label: t('pages.scenarios.string_47'), description: t('pages.scenarios.string_48'), valueLabel: t('pages.scenarios.string_49'), placeholder: 'analysis_report.md' },
  { id: 'must_include_sections', label: t('pages.scenarios.string_50'), description: t('pages.scenarios.string_51'), valueLabel: t('pages.scenarios.string_52'), placeholder: t('pages.scenarios.string_53'), multiline: true },
  { id: 'no_empty_sections', label: t('pages.scenarios.string_54'), description: t('pages.scenarios.string_55') },
  { id: 'length_in_range', label: t('pages.scenarios.string_56'), description: t('pages.scenarios.string_57') },
  { id: 'no_source_file_changed_without_approval', label: t('pages.scenarios.string_58'), description: t('pages.scenarios.string_59') }
];

const defaultExcelInputFile = 'input/customer_data.xlsx';
const defaultDocumentInputFile = 'input/weekly_raw.txt';

const getBlankScenarioForm = (t: (key: string) => string, preflightPresets: RulePreset[], postflightPresets: RulePreset[]): ScenarioForm => ({
  name: t('pages.scenarios.string_60'),
  category: 'data-analysis',
  description: t('pages.scenarios.string_61'),
  defaultSkillId: 'excel-data-analysis',
  requiredTools: 'xlsx.inspect\npython.run\nfilesystem.write',
  defaultOutputs: 'analysis_report.md',
  preflight: preflightPresets.map((preset) => ({ id: preset.id, enabled: ['input_file_exists', 'input_file_is_xlsx_or_csv', 'required_skill_available', 'required_tools_available', 'model_profile_available'].includes(preset.id), value: '' })),
  postflight: postflightPresets.map((preset) => ({ id: preset.id, enabled: ['artifact_exists', 'must_include_sections', 'no_empty_sections', 'length_in_range'].includes(preset.id), value: preset.id === 'artifact_exists' ? 'analysis_report.md' : preset.id === 'must_include_sections' ? t('pages.scenarios.string_62') : '' })),
  customPreflight: [],
  customPostflight: []
});

export function ScenariosPage() {
  const { t } = useTranslation();
  const preflightPresets = useMemo(() => getPreflightPresets(t), [t]);
  const postflightPresets = useMemo(() => getPostflightPresets(t), [t]);
  const blankScenarioForm = useMemo(() => getBlankScenarioForm(t, preflightPresets, postflightPresets), [t, preflightPresets, postflightPresets]);

  const [selectedId, setSelectedId] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [inputFiles, setInputFiles] = useState(defaultExcelInputFile);
  const [preflight, setPreflight] = useState<unknown>();
  const [editingMode, setEditingMode] = useState<'new' | 'edit' | ''>('');
  const [form, setForm] = useState<ScenarioForm>(() => getBlankScenarioForm(t, getPreflightPresets(t), getPostflightPresets(t)));
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
  useEffect(() => {
    if (!selected) return;
    setInputFiles(defaultInputFilesForScenario(selected));
  }, [selected?.id]);
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
      setNotice(caught instanceof Error ? caught.message : t('pages.scenarios.string_63'));
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
    setForm(formFromScenario(selected, preflightPresets, postflightPresets));
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
      setNotice(t('pages.scenarios.string_64'));
      await resource.reload();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : t('pages.scenarios.string_65'));
    } finally {
      setBusy('');
    }
  };
  const remove = async () => {
    if (!selected || !window.confirm(t('pages.scenarios.string_66'))) return;
    setBusy('delete');
    setNotice('');
    try {
      await api(`/api/scenarios/${selected.id}`, { method: 'DELETE' });
      resource.setData(resource.data ? { ...resource.data, items: resource.data.items.filter((item) => item.id !== selected.id) } : undefined);
      setSelectedId('');
      setPreflight(undefined);
      setEditingMode('');
      setNotice(t('pages.scenarios.string_67'));
      await resource.reload();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : t('pages.scenarios.string_68'));
    } finally {
      setBusy('');
    }
  };

  return <section>
    <PageHeader eyebrow="V0.5 / Eval Scenario Template" title={t('pages.scenarios.string_1')} description={t('pages.scenarios.string_2')}
      actions={<><button onClick={() => void resource.reload()}><RefreshCw size={14} />{t('pages.scenarios.string_13')}</button><button className="primary" onClick={startCreate}><Plus size={14} />{t('pages.scenarios.string_14')}</button></>} />
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
        <div className="panel-title"><Layers size={15} />{t('pages.scenarios.string_15')}<span>{displayItems.length}</span></div>
        {resource.loading && !items ? <Loading /> : displayItems.length ? displayItems.map((item) => <button key={item.id} className={selected?.id === item.id ? 'active' : ''} onClick={() => { setSelectedId(item.id); setPreflight(undefined); setEditingMode(''); }}>
          <StatusBadge status="enabled" />
          <div><strong>{item.name}</strong><span>{item.category} · {item.defaultSkillId}</span><p>{item.description}</p></div>
          <aside><b>{item.requiredTools.length} tools</b><span>{item.defaultOutputs.join(', ')}</span></aside>
        </button>) : <Empty>{t('pages.scenarios.string_16')}</Empty>}
        <div className="mini-form task-create-entry"><button className="primary" onClick={startCreate}><FilePlus2 size={14} />{t('pages.scenarios.string_17')}</button></div>
      </div>
      <div className="panel workbench-detail">
        {editingMode ? <ScenarioEditor mode={editingMode} form={form} busy={busy === 'save'} onChange={setForm} onCancel={() => setEditingMode('')} onSave={() => void save()} />
          : selected ? <ScenarioDetail scenario={selected} preflight={preflight} workspaceId={workspaceId} workspaces={workspaces} inputFiles={inputFiles} busy={busy}
            onWorkspace={setWorkspaceId} onInputFiles={setInputFiles} onPreflight={() => void runPreflight()} onEdit={startEdit} onDelete={() => void remove()} />
            : <Empty>{t('pages.scenarios.string_18')}</Empty>}
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
  const { t } = useTranslation();
  const preflightPresets = useMemo(() => getPreflightPresets(t), [t]);
  const postflightPresets = useMemo(() => getPostflightPresets(t), [t]);
  return <>
    <div className="panel-title">Eval Scenario Contract <span>{scenario.id}</span></div>
    <div className="provider-actions task-detail-actions">
      <Link className="primary-link" to={`/tasks?scenarioTemplateId=${encodeURIComponent(scenario.id)}&create=1`}>{t('pages.scenarios.string_19')}</Link>
      <button onClick={onEdit}><Pencil size={14} />{t('common.edit')}</button>
      <button className="danger" disabled={busy === 'delete'} onClick={onDelete}><Trash2 size={14} />{t('common.delete')}</button>
    </div>
    <div className="registry-facts">
      <span>Skill<b>{scenario.defaultSkillId ?? '—'}</b></span>
      <span>Category<b>{scenario.category ?? '—'}</b></span>
      <span>Tools<b>{scenario.requiredTools.length}</b></span>
      <span>Outputs<b>{scenario.defaultOutputs.length}</b></span>
    </div>
    <div className="scenario-rule-summary">
      <RuleSummary title={t('pages.scenarios.string_3')} rules={scenario.preflight} presets={preflightPresets} tone="preflight" />
      <RuleSummary title={t('pages.scenarios.string_4')} rules={scenario.postflight} presets={postflightPresets} tone="postflight" />
    </div>
    <div className="scenario-preflight">
      <label>{t('pages.scenarios.string_20')}<ThemedSelect value={workspaceId} onChange={(event) => onWorkspace(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</ThemedSelect></label>
      <label>{t('pages.scenarios.string_21')}<textarea rows={2} placeholder={defaultInputFilesForScenario(scenario) || t('pages.scenarios.string_69')} value={inputFiles} onChange={(event) => onInputFiles(event.target.value)} /></label>
      <button className="primary" onClick={onPreflight}><PlayCircle size={14} />{t('pages.scenarios.string_22')}</button>
    </div>
    <div className="workbench-split">
      <CheckResultPanel title="Preflight Result" value={preflight} />
      <div><h3>{t('pages.scenarios.string_23')}</h3><div className="chip-row">{scenario.requiredTools.map((tool) => <span key={tool}>{tool}</span>)}{scenario.defaultOutputs.map((output) => <span key={output}>{output}</span>)}</div></div>
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
  const { t } = useTranslation();
  const preflightPresets = useMemo(() => getPreflightPresets(t), [t]);
  const postflightPresets = useMemo(() => getPostflightPresets(t), [t]);
  return <div className="scenario-editor">
    <div className="panel-title"><Pencil size={15} />{mode === 'new' ? t('pages.scenarios.string_70') : t('pages.scenarios.string_71')} <span>{mode === 'new' ? 'POST /api/scenarios' : 'PUT /api/scenarios/:id'}</span></div>
    <div className="run-form-grid task-form-grid">
      <label>{t('pages.scenarios.string_24')}<input placeholder={t('pages.scenarios.string_5')} value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} /></label>
      <label>{t('pages.scenarios.string_25')}<input placeholder={t('pages.scenarios.string_6')} value={form.category} onChange={(event) => onChange({ ...form, category: event.target.value })} /></label>
      <label>{t('pages.scenarios.string_26')}<input placeholder={t('pages.scenarios.string_7')} value={form.defaultSkillId} onChange={(event) => onChange({ ...form, defaultSkillId: event.target.value })} /></label>
      <label>{t('pages.scenarios.string_27')}<textarea rows={3} placeholder={t('pages.scenarios.string_8')} value={form.defaultOutputs} onChange={(event) => onChange({ ...form, defaultOutputs: event.target.value })} /></label>
      <label className="wide">{t('pages.scenarios.string_28')}<input placeholder={t('pages.scenarios.string_9')} value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} /></label>
      <label className="wide">{t('pages.scenarios.string_29')}<textarea rows={4} placeholder={t('pages.scenarios.string_10')} value={form.requiredTools} onChange={(event) => onChange({ ...form, requiredTools: event.target.value })} /></label>
    </div>
    <div className="scenario-builder-grid">
      <RuleBuilder title={t('pages.scenarios.string_11')} presets={preflightPresets} rules={form.preflight} onChange={(preflight) => onChange({ ...form, preflight })} customRules={form.customPreflight} />
      <RuleBuilder title={t('pages.scenarios.string_12')} presets={postflightPresets} rules={form.postflight} onChange={(postflight) => onChange({ ...form, postflight })} customRules={form.customPostflight} />
    </div>
    <div className="modal-actions"><button onClick={onCancel}><X size={14} />{t('common.cancel')}</button><button className="primary" disabled={busy || !form.name.trim()} onClick={onSave}><Save size={14} />{busy ? t('pages.scenarios.string_72') : t('pages.scenarios.string_73')}</button></div>
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

function RuleSummary({ title, rules, presets, tone }: { title: string; rules: unknown[]; presets: RulePreset[]; tone: 'preflight' | 'postflight' }) {
  const { t } = useTranslation();
  return <div className={`panel rule-summary rule-summary-${tone}`}>
    <div className="panel-title">{title}<span>{rules.length}</span></div>
    {rules.length ? <div className="rule-summary-list">{rules.map((rule, index) => {
      const id = checkId(rule);
      const preset = presets.find((item) => item.id === id);
      return <div key={`${id}-${index}`}><StatusBadge status="enabled" /><strong>{preset?.label ?? id}</strong><span>{ruleText(rule)}</span></div>;
    })}</div> : <Empty>{t('pages.scenarios.string_30')}</Empty>}
  </div>;
}

function CheckResultPanel({ title, value }: { title: string; value: unknown }) {
  const { t } = useTranslation();
  const summary = checkResultSummary(value);
  return <div>
    <h3>{title}</h3>
    <div className="check-result-head"><StatusBadge status={summary.status} /><span>{summary.checkedAt || t('pages.scenarios.string_74')}</span></div>
    {summary.checks.length ? <div className="check-result-grid">{summary.checks.map((check, index) => <article key={`${check.id}-${index}`} className={`check-card check-${check.status}`}>
      <StatusBadge status={check.status} /><strong>{check.id}</strong><p>{check.detail}</p>
    </article>)}</div> : <Empty>{title} 尚未产生检查结果。</Empty>}
  </div>;
}

function formFromScenario(scenario: Scenario, preflightPresets: RulePreset[], postflightPresets: RulePreset[]): ScenarioForm {
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

function defaultInputFilesForScenario(scenario: Scenario) {
  const preflightIds = new Set(scenario.preflight.map(checkId));
  const skill = scenario.defaultSkillId?.toLowerCase() ?? '';
  const category = scenario.category?.toLowerCase() ?? '';
  if (preflightIds.has('input_file_is_txt_or_docx') || skill.includes('weekly') || skill.includes('doc') || category.includes('office')) {
    return defaultDocumentInputFile;
  }
  if (preflightIds.has('input_file_is_xlsx_or_csv') || skill.includes('excel') || category.includes('data')) {
    return defaultExcelInputFile;
  }
  return preflightIds.has('input_file_exists') ? defaultExcelInputFile : '';
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
