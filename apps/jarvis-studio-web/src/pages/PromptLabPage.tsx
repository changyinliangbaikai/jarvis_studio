import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, GitCommitVertical, Plus, Save, Sparkles } from 'lucide-react';
import { api, post } from '../api.ts';
import { Empty, Loading, PageHeader } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';

interface Prompt { id: string; name: string; version: string; content: string; variables: string[]; linkedSkill?: string; changelog?: string; createdAt: string }
export function PromptLabPage() {
  const [selectedId, setSelectedId] = useState('');
  const [content, setContent] = useState('');
  const [input, setInput] = useState('分析 customer_list.xlsx');
  const [result, setResult] = useState('');
  const [creating, setCreating] = useState(false);
  const load = useCallback((signal: AbortSignal) => api<Prompt[]>('/api/prompts', { signal }), []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['prompts'] });
  const prompts = resource.data;
  const selected = prompts?.find((prompt) => prompt.id === selectedId) ?? prompts?.[0];
  useEffect(() => {
    if (prompts) setSelectedId((value) => value || prompts[0]?.id || '');
  }, [prompts]);
  useEffect(() => { if (selected) setContent(selected.content); }, [selected?.id]);
  const createVersion = async () => {
    if (!selected) return;
    const next = await post<Prompt>(`/api/prompts/${selected.id}/new-version`, { content, changelog: '由 Prompt Lab 创建' });
    await resource.reload(); setSelectedId(next.id); setResult(`已创建 ${next.name}@${next.version}`);
  };
  const createPrompt = async () => {
    const item = await post<Prompt>('/api/prompts', { name: 'new-prompt', version: 'v0.1', content: '请处理以下任务：{{input}}', changelog: 'Prompt Lab 新建' });
    await resource.reload(); setSelectedId(item.id); setCreating(false);
  };
  const test = async () => {
    if (!selected) return;
    const variables = Object.fromEntries(selected.variables.map((variable) => [variable, variable === 'file_name' ? 'customer_list.xlsx' : input]));
    const data = await post<{ runId: string; rendered: string; response: string }>(`/api/prompts/${selected.id}/test`, { variables, inputMessage: input });
    setResult(`${data.response}\n\nRun: ${data.runId}\n\n--- Rendered Prompt ---\n${data.rendered}`);
  };
  if (!prompts) return <Loading />;
  return <section>
    <PageHeader eyebrow="06 / Prompt 实验室" title="Prompt 版本工坊 (Version Foundry)" description="版本化 Prompt、渲染变量，并通过 Mock Runtime 把测试结果自动写入 Runs。"
      actions={<button onClick={() => setCreating(true)}><Plus size={15} />新建 Prompt</button>} />
    {resource.error && <div className="notice warning">{resource.error}</div>}
    {prompts.length === 0 ? <Empty>还没有 Prompt 版本。</Empty> : <div className="prompt-layout">
      <div className="panel prompt-list"><div className="panel-title"><GitCommitVertical size={15} />版本谱系 (Version Lineage)</div>{prompts.map((prompt) =>
        <button key={prompt.id} className={selected?.id === prompt.id ? 'active' : ''} onClick={() => setSelectedId(prompt.id)}>
          <div><strong>{prompt.name}</strong><span>{prompt.changelog}</span></div><b>{prompt.version}</b>
        </button>)}</div>
      <div className="panel editor-panel"><div className="editor-toolbar"><div><span className="eyebrow">正在编辑</span><h2>{selected?.name}@{selected?.version}</h2></div><button className="primary" onClick={() => void createVersion()}><Save size={15} />另存新版本</button></div>
        <div className="editor-meta"><span>关联 Skill <b>{selected?.linkedSkill ?? '无'}</b></span><span>变量 <b>{selected?.variables.join(', ') || '无'}</b></span></div>
        <textarea className="code-editor" value={content} onChange={(event) => setContent(event.target.value)} />
        <div className="test-rig"><label>测试输入<input value={input} onChange={(event) => setInput(event.target.value)} /></label><button className="primary" onClick={() => void test()}><FlaskConical size={15} />运行测试</button></div>
        {result && <pre className="result-console">{result}</pre>}
      </div>
    </div>}
    {creating && <div className="modal-backdrop" onClick={() => setCreating(false)}><div className="modal" onClick={(event) => event.stopPropagation()}><Sparkles size={22} /><h2>创建 Prompt 基线</h2><p>创建后可以在编辑器中调整内容并保存新版本。</p><div className="modal-actions"><button onClick={() => setCreating(false)}>取消</button><button className="primary" onClick={() => void createPrompt()}>创建</button></div></div></div>}
  </section>;
}
