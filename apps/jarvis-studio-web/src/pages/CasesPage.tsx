import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { api } from '../api.ts';
import { Empty, Loading, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';

interface EvalCase {
  id: string;
  name: string;
  category: string;
  priority: string;
  version: string;
  tags: string[];
  latestResult?: { status: string; passed: boolean; score: number; issueTags: string[] };
}

export function CasesPage() {
  const load = useCallback((signal: AbortSignal) => api<EvalCase[]>('/api/eval/cases', { signal }), []);
  const resource = useAsyncResource(load, [], true, { queryKey: ['eval-cases-light'] });
  const cases = resource.data;
  if (!cases) return <Loading />;
  return <section>
    <PageHeader eyebrow="05 / Cases" title="测试用例" description="Case 用于沉淀可复用输入、期望行为和评判规则。复杂 Dataset 入口保留在高级评测中。" />
    {resource.error && <div className="notice warning">{resource.error}</div>}
    {cases.length === 0 ? <Empty>还没有测试用例。建议先在 Playground 运行，再从 Trace 复盘中沉淀 Case。</Empty> : <div className="table-wrap"><table><thead><tr><th>名称</th><th>分类</th><th>优先级</th><th>标签</th><th>最近结果</th><th>操作</th></tr></thead><tbody>{cases.map((item) => <tr key={item.id}>
      <td className="run-name"><strong>{item.name}</strong><span>{item.id} · {item.version}</span></td>
      <td>{item.category}</td>
      <td><StatusBadge status={item.priority} /></td>
      <td>{item.tags?.join(', ') || '-'}</td>
      <td>{item.latestResult ? <StatusBadge status={item.latestResult.passed ? 'passed' : 'failed'} /> : <span className="status status-draft">未运行</span>}</td>
      <td><Link className="icon-link" to={`/evals/cases/${item.id}`} title="查看详情"><ClipboardList size={14} /></Link></td>
    </tr>)}</tbody></table></div>}
  </section>;
}
