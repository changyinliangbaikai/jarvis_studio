import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, PlayCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, post } from '../api.ts';
import { Empty, Loading, PageHeader } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';

interface Agent { id: string; name: string; defaultPromptId?: string }
interface Prompt { id: string; agentId?: string; name: string; version: string; status: string; variables: string[] }
interface PlaygroundResult { runId: string; rendered: string; response: string }

export function PlaygroundPage() {
  const loadAgents = useCallback((signal: AbortSignal) => api<Agent[]>('/api/agents', { signal }), []);
  const loadPrompts = useCallback((signal: AbortSignal) => api<Prompt[]>('/api/prompts', { signal }), []);
  const agentsResource = useAsyncResource(loadAgents, [], true, { queryKey: ['agents', 'playground'] });
  const promptsResource = useAsyncResource(loadPrompts, [], true, { queryKey: ['prompts', 'playground'] });
  const agents = agentsResource.data;
  const prompts = promptsResource.data;
  const [agentId, setAgentId] = useState('');
  const [promptId, setPromptId] = useState('');
  const [inputMessage, setInputMessage] = useState('帮我检查这个 Agent 当前 Prompt 是否适合做资料整理任务。');
  const [variablesText, setVariablesText] = useState('{}');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PlaygroundResult | undefined>();
  const [error, setError] = useState('');
  const agent = agents?.find((item) => item.id === agentId);
  const availablePrompts = useMemo(() => prompts?.filter((prompt) => !agentId || !prompt.agentId || prompt.agentId === agentId) ?? [], [prompts, agentId]);

  useEffect(() => {
    if (agents) setAgentId((value) => value || agents[0]?.id || '');
  }, [agents]);
  useEffect(() => {
    if (!prompts) return;
    const next = agent?.defaultPromptId || availablePrompts.find((prompt) => prompt.status === 'active')?.id || availablePrompts[0]?.id || '';
    setPromptId((value) => value && availablePrompts.some((prompt) => prompt.id === value) ? value : next);
  }, [agent?.defaultPromptId, prompts?.length, availablePrompts.length]);

  const run = async () => {
    setRunning(true);
    setError('');
    try {
      const variables = JSON.parse(variablesText || '{}') as Record<string, string>;
      const data = await post<PlaygroundResult>('/api/playground/run', { agentId, promptId, inputMessage, variables });
      setResult(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '运行失败');
    } finally {
      setRunning(false);
    }
  };

  if (!agents || !prompts) return <Loading />;
  return <section>
    <PageHeader eyebrow="03 / Playground" title="Playground" description="选择 Agent 和 Prompt 版本，输入测试消息，运行后自动生成 Run 与 Trace。这里是 Prompt → Trace 的最短闭环。" actions={<button className="primary" disabled={running || !promptId} onClick={() => void run()}><PlayCircle size={15} />{running ? '运行中' : '运行'}</button>} />
    {(agentsResource.error || promptsResource.error || error) && <div className="notice warning">{agentsResource.error || promptsResource.error || error}</div>}
    {agents.length === 0 || prompts.length === 0 ? <Empty>请先创建 Agent 和 Prompt，再进入 Playground。</Empty> : <div className="workbench-grid">
      <div className="panel editor-panel">
        <div className="panel-title">运行配置<span>Prompt-first</span></div>
        <div className="mini-form">
          <label>Agent<select value={agentId} onChange={(event) => setAgentId(event.target.value)}>{agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Prompt Version<select value={promptId} onChange={(event) => setPromptId(event.target.value)}>{availablePrompts.map((prompt) => <option key={prompt.id} value={prompt.id}>{prompt.name}@{prompt.version} · {prompt.status}</option>)}</select></label>
          <label>用户输入<textarea rows={7} value={inputMessage} onChange={(event) => setInputMessage(event.target.value)} /></label>
          <label>变量 JSON<textarea rows={6} value={variablesText} onChange={(event) => setVariablesText(event.target.value)} /></label>
        </div>
      </div>
      <div className="panel editor-panel">
        <div className="panel-title">运行结果<span>{result?.runId ?? '未运行'}</span></div>
        {!result ? <Empty>运行后会展示输出、Run ID 和渲染后的 Prompt 快照。</Empty> : <>
          <div className="editor-toolbar"><div><span className="eyebrow">Assistant Output</span><h2>运行成功</h2></div><Link className="primary-link" to={`/runs/${result.runId}`}><ExternalLink size={14} />查看 Trace</Link></div>
          <pre className="result-console">{result.response}</pre>
          <h3>Rendered Prompt</h3>
          <pre className="json-view">{result.rendered}</pre>
        </>}
      </div>
    </div>}
  </section>;
}
