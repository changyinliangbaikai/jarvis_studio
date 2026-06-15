import { describe, expect, it } from 'vitest';
import { extractVariables, renderPrompt } from './promptRenderer.ts';

describe('prompt renderer', () => {
  it('extracts unique variables and renders supplied values', () => {
    const content = '分析 {{ file }}，遵循 {{rule}}，再次检查 {{file}}。';
    expect(extractVariables(content)).toEqual(['file', 'rule']);
    expect(renderPrompt(content, { file: '客户清单.xlsx', rule: '不得编造' })).toBe('分析 客户清单.xlsx，遵循 不得编造，再次检查 客户清单.xlsx。');
  });
});
