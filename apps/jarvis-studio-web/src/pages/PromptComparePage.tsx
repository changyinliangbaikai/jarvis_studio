import { useTranslation } from 'react-i18next';
import { useCallback, useMemo, useState } from 'react';
import { PlayCircle } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.ts';
import { JsonView, Loading, PageHeader, StatusBadge } from '../components/Primitives.tsx';
import { useAsyncResource } from '../hooks/useAsyncResource.ts';

interface Prompt {
  id: string;
  agentId?: string;
  name: string;
  version: string;
  status: string;
}
interface PromptCompare {
  left: Prompt;
  right: Prompt;
  diffs: Array<{ field: string; left: unknown; right: unknown; changed: boolean }>;
}

export function PromptComparePage() {
  const { t } = useTranslation();
  const { promptId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [leftId, setLeftId] = useState(searchParams.get('left') ?? '');
  const [rightId, setRightId] = useState(searchParams.get('right') ?? '');
  const load = useCallback(async (signal: AbortSignal) => {
    const versions = await api<Prompt[]>(`/api/prompts/${promptId}/versions`, { signal });
    const left = leftId || versions[1]?.id || versions[0]?.id || '';
    const right = rightId || versions[0]?.id || '';
    if (!leftId && left) setLeftId(left);
    if (!rightId && right) setRightId(right);
    const compare = await api<PromptCompare>(`/api/prompts/${promptId}/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`, { signal });
    return { versions, compare };
  }, [promptId, leftId, rightId]);
  const resource = useAsyncResource(load, [promptId, leftId, rightId], Boolean(promptId), { queryKey: ['prompt-compare', promptId, leftId, rightId] });
  const versions = resource.data?.versions ?? [];
  const compare = resource.data?.compare;
  const changed = useMemo(() => compare?.diffs.filter((diff) => diff.changed) ?? [], [compare]);
  const updateSide = (side: 'left' | 'right', value: string) => {
    if (side === 'left') setLeftId(value);
    else setRightId(value);
    setSearchParams({ left: side === 'left' ? value : leftId, right: side === 'right' ? value : rightId });
  };

  if (!resource.data || !compare) return <Loading />;
  return <section>
    <PageHeader eyebrow="02 / Prompt Compare" title={t('pages.promptCompare.string_1')} description={t('pages.promptCompare.string_2')} />
    {resource.error && <div className="notice warning">{resource.error}</div>}
    <div className="section-bar">
      <div><strong>{compare.left.name}</strong><span>{changed.length} 个字段有变化</span></div>
      <div className="page-actions">
        <select value={leftId} onChange={(event) => updateSide('left', event.target.value)}>{versions.map((version) => <option key={version.id} value={version.id}>{version.version} · {version.status}</option>)}</select>
        <select value={rightId} onChange={(event) => updateSide('right', event.target.value)}>{versions.map((version) => <option key={version.id} value={version.id}>{version.version} · {version.status}</option>)}</select>
      </div>
    </div>
    <div className="workbench-split">
      {[compare.left, compare.right].map((prompt) => <div className="panel" key={prompt.id}>
        <div className="panel-title">{prompt.version}<StatusBadge status={prompt.status} /></div>
        <p>{prompt.name}</p>
        <Link className="primary-link" to={`/playground?agentId=${prompt.agentId ?? ''}&promptVersionId=${prompt.id}`}><PlayCircle size={14} />{t('pages.promptCompare.string_3')}</Link>
      </div>)}
    </div>
    <div className="panel">
      <div className="panel-title">{t('pages.promptCompare.string_4')}<span>{changed.length}/{compare.diffs.length}</span></div>
      <div className="table-wrap"><table><thead><tr><th>{t('pages.promptCompare.string_5')}</th><th>{t('pages.promptCompare.string_6')}</th><th>{t('pages.promptCompare.string_7')}</th></tr></thead><tbody>{compare.diffs.map((diff) => <tr key={diff.field} className={diff.changed ? 'diff-changed' : ''}>
        <td><strong>{diff.field}</strong></td>
        <td><JsonView value={diff.left} /></td>
        <td><JsonView value={diff.right} /></td>
      </tr>)}</tbody></table></div>
    </div>
  </section>;
}
