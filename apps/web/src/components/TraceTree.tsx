import { Box, Braces, Cpu, FileOutput, ShieldCheck, TerminalSquare } from 'lucide-react';

interface Span { id: string; parentId?: string; type: string; name: string; status: string; latencyMs?: number }
const iconFor = (type: string) => type === 'llm.call' ? Cpu : type === 'tool.call' ? TerminalSquare : type === 'context.build' ? Braces : type === 'artifact.write' ? FileOutput : type === 'permission.check' ? ShieldCheck : Box;

export function TraceTree({ spans, selected, onSelect }: { spans: Span[]; selected?: string; onSelect: (span: Span) => void }) {
  const roots = spans.filter((span) => !span.parentId || !spans.some((candidate) => candidate.id === span.parentId));
  const render = (span: Span, depth = 0): React.ReactNode => {
    const Icon = iconFor(span.type);
    return <div key={span.id}>
      <button className={`trace-node ${selected === span.id ? 'active' : ''}`} style={{ paddingLeft: 12 + depth * 18 }} onClick={() => onSelect(span)}>
        <Icon size={14} /><span><strong>{span.name}</strong><small>{span.type}</small></span><b>{span.latencyMs ? `${span.latencyMs}ms` : ''}</b>
      </button>
      {spans.filter((child) => child.parentId === span.id).map((child) => render(child, depth + 1))}
    </div>;
  };
  return <div className="trace-tree">{roots.map((span) => render(span))}</div>;
}
