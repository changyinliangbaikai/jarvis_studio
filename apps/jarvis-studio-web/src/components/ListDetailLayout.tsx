import type { ReactNode } from 'react';

export function ListDetailLayout({
  children,
  className = 'workbench-grid'
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}

export function EntityListPanel({ children }: { children: ReactNode }) {
  return <div className="panel registry-list">{children}</div>;
}

export function EntityDetailPanel({ children }: { children: ReactNode }) {
  return <div className="panel workbench-detail">{children}</div>;
}
