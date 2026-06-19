import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Box, Braces, Cpu, FileOutput, ShieldCheck, TerminalSquare } from 'lucide-react';

interface Span { id: string; parentId?: string; type: string; name: string; status: string; latencyMs?: number }
interface TraceRow { span: Span; depth: number }
const iconFor = (type: string) => type === 'llm.call' ? Cpu : type === 'tool.call' ? TerminalSquare : type === 'context.build' ? Braces : type === 'artifact.write' ? FileOutput : type === 'permission.check' ? ShieldCheck : Box;

export function TraceTree({ spans, selected, onSelect }: { spans: Span[]; selected?: string; onSelect: (span: Span) => void }) {
  const rows = useMemo(() => {
    const ids = new Set(spans.map((span) => span.id));
    const nextRoots: Span[] = [];
    const nextChildren = new Map<string, Span[]>();
    for (const span of spans) {
      if (span.parentId && ids.has(span.parentId)) {
        const children = nextChildren.get(span.parentId);
        if (children) children.push(span);
        else nextChildren.set(span.parentId, [span]);
      } else {
        nextRoots.push(span);
      }
    }
    const flattened: TraceRow[] = [];
    const visit = (span: Span, depth: number) => {
      flattened.push({ span, depth });
      for (const child of nextChildren.get(span.id) ?? []) visit(child, depth + 1);
    };
    for (const root of nextRoots) visit(root, 0);
    return flattened;
  }, [spans]);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => 44,
    getScrollElement: () => parentRef.current,
    overscan: 12
  });
  return <div className="trace-tree trace-tree-virtual" ref={parentRef}>
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index];
        if (!row) return null;
        const { span, depth } = row;
        const Icon = iconFor(span.type);
        return <button
          className={`trace-node ${selected === span.id ? 'active' : ''}`}
          key={span.id}
          onClick={() => onSelect(span)}
          style={{ paddingLeft: 12 + depth * 18, position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%' }}
        >
          <Icon size={14} /><span><strong>{span.name}</strong><small>{span.type}</small></span><b>{span.latencyMs ? `${span.latencyMs}ms` : ''}</b>
        </button>;
      })}
    </div>
  </div>;
}
