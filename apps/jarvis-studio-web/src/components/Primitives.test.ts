import { describe, expect, it } from 'vitest';
import { jsonViewLimits, safeStringify } from './Primitives.tsx';

describe('JsonView safeStringify', () => {
  it('handles circular objects without throwing', () => {
    const value: { name: string; self?: unknown } = { name: 'trace' };
    value.self = value;

    expect(safeStringify(value)).toContain('[Circular]');
  });

  it('limits oversized arrays and output length', () => {
    const value = {
      events: Array.from({ length: jsonViewLimits.maxArrayItems + 5 }, (_, index) => ({ index, payload: 'x'.repeat(1000) }))
    };

    const text = safeStringify(value);

    expect(text.length).toBeLessThanOrEqual(jsonViewLimits.maxLength + 80);
    expect(text).toContain('已截断');
  });

  it('limits deep nesting before rendering', () => {
    let value: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < jsonViewLimits.maxDepth + 3; index += 1) {
      value = { child: value };
    }

    expect(safeStringify(value)).toContain('Truncated');
  });

  it('serializes BigInt values without throwing', () => {
    const value = {
      eventId: 'evt_1',
      nanoTimestamp: 1734601234567890123n,
      payload: { offsets: [12345678901234567890n, 1n] }
    };

    const text = safeStringify(value);

    expect(text).toContain('1734601234567890123n');
    expect(text).toContain('12345678901234567890n');
    expect(text).not.toContain('无法格式化 JSON');
  });
});
