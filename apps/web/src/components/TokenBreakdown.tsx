const colors = ['#63e6be', '#ffd166', '#57c7ff', '#ff7b72', '#bd93f9', '#8be9fd', '#f1fa8c'];

export function TokenBreakdown({ segments, total }: { segments: Array<{ id: string; name: string; type: string; tokens: number; included: boolean }>; total: number }) {
  const included = segments.filter((segment) => segment.included);
  return <div className="token-breakdown">
    <div className="token-bar">{included.map((segment, index) =>
      <i key={segment.id} title={`${segment.name}: ${segment.tokens}`} style={{ width: `${(segment.tokens / Math.max(total, 1)) * 100}%`, background: colors[index % colors.length] }} />
    )}</div>
    <div className="token-legend">{included.map((segment, index) => <span key={segment.id}><i style={{ background: colors[index % colors.length] }} />{segment.type}<b>{((segment.tokens / Math.max(total, 1)) * 100).toFixed(1)}%</b></span>)}</div>
  </div>;
}
