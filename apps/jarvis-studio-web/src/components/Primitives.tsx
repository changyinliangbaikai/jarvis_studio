import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <span className={`status status-${status}`}>{t(`status.${status}`, { defaultValue: status })}</span>;
}

export function Metric({ label, value, tone = 'default' }: { label: string; value: ReactNode; tone?: string }) {
  const { t } = useTranslation();
  return <div className={`metric metric-${tone}`}><span>{t(`metric.${label}`, { defaultValue: label })}</span><strong>{value}</strong></div>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header">
    <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>;
}

export function Empty({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return <div className="empty"><span>{t('common.noData')}</span><p>{children}</p></div>;
}

export function JsonView({ value }: { value: unknown }) {
  return <pre className="json-view">{safeStringify(value)}</pre>;
}

export function Loading() {
  const { t } = useTranslation();
  return <div className="loading"><i /><span>{t('common.loading')}</span><Skeleton rows={3} /></div>;
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="skeleton" aria-hidden="true">
    {Array.from({ length: rows }, (_, index) => <span key={index} style={{ width: `${96 - index * 13}%` }} />)}
  </div>;
}

export const jsonViewLimits = {
  maxArrayItems: 120,
  maxDepth: 8,
  maxLength: 40000,
  maxNodes: 1200,
  maxObjectKeys: 160
};

export function safeStringify(value: unknown) {
  try {
    const text = JSON.stringify(limitJson(value), null, 2) ?? String(value);
    return text.length > jsonViewLimits.maxLength
      ? `${text.slice(0, jsonViewLimits.maxLength)}\n... 已截断，完整 JSON 超过 ${jsonViewLimits.maxLength} 字符 ...`
      : text;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return `无法格式化 JSON: ${message}`;
  }
}

function limitJson(value: unknown) {
  const seen = new WeakSet<object>();
  const state = { nodes: 0, truncated: false };
  const next = walkJson(value, 0, seen, state);
  if (!state.truncated) return next;
  return { __truncated: `JSON 超过 ${jsonViewLimits.maxDepth} 层或 ${jsonViewLimits.maxNodes} 个节点，已截断。`, value: next };
}

function walkJson(value: unknown, depth: number, seen: WeakSet<object>, state: { nodes: number; truncated: boolean }): unknown {
  state.nodes += 1;
  if (state.nodes > jsonViewLimits.maxNodes) {
    state.truncated = true;
    return '[Truncated: node limit]';
  }
  // Trace 事件常包含高精度 BigInt 时间戳。原生 JSON.stringify 会对 BigInt 抛 TypeError，
  // 这里提前转换为字符串，保留可读性且避免降级到错误兜底文本。
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (depth >= jsonViewLimits.maxDepth) {
    state.truncated = true;
    return Array.isArray(value) ? `[Truncated Array(${value.length})]` : '[Truncated Object]';
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, jsonViewLimits.maxArrayItems).map((item) => walkJson(item, depth + 1, seen, state));
    if (value.length > jsonViewLimits.maxArrayItems) {
      state.truncated = true;
      items.push(`... ${value.length - jsonViewLimits.maxArrayItems} more items`);
    }
    return items;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const limitedEntries = entries.slice(0, jsonViewLimits.maxObjectKeys).map(([key, item]) => [key, walkJson(item, depth + 1, seen, state)]);
  const output = Object.fromEntries(limitedEntries);
  if (entries.length > jsonViewLimits.maxObjectKeys) {
    state.truncated = true;
    output.__truncatedKeys = `${entries.length - jsonViewLimits.maxObjectKeys} more keys`;
  }
  return output;
}
