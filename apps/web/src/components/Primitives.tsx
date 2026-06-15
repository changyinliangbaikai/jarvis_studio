import type { ReactNode } from 'react';

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{status}</span>;
}

export function Metric({ label, value, tone = 'default' }: { label: string; value: ReactNode; tone?: string }) {
  return <div className={`metric metric-${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header">
    <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty"><span>NO SIGNAL</span><p>{children}</p></div>;
}

export function JsonView({ value }: { value: unknown }) {
  return <pre className="json-view">{JSON.stringify(value, null, 2)}</pre>;
}

export function Loading() {
  return <div className="loading"><i /><span>同步观测数据</span></div>;
}
