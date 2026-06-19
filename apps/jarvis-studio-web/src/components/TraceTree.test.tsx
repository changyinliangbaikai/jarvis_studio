// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TraceTree } from './TraceTree.tsx';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index,
      key: index,
      size: estimateSize(),
      start: index * estimateSize()
    }))
  })
}));

describe('TraceTree', () => {
  it('renders hierarchical spans through the virtualized list', async () => {
    const onSelect = vi.fn();
    render(<TraceTree
      selected="tool"
      onSelect={onSelect}
      spans={[
        { id: 'root', type: 'llm.call', name: 'Planner', status: 'success', latencyMs: 20 },
        { id: 'tool', parentId: 'root', type: 'tool.call', name: 'Excel Tool', status: 'success', latencyMs: 15 },
        { id: 'artifact', parentId: 'tool', type: 'artifact.write', name: 'Report', status: 'success' }
      ]}
    />);

    const tool = await screen.findByText('Excel Tool');
    fireEvent.click(tool.closest('button')!);

    expect(screen.getByText('Planner')).toBeTruthy();
    expect(screen.getByText('Report')).toBeTruthy();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'tool' }));
  });
});
