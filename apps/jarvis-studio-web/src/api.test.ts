import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, api, parseJsonWithSchema } from './api.ts';

describe('frontend api helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses typed JSON with runtime validation', () => {
    const schema = z.object({ name: z.string(), retries: z.number().int() });
    expect(parseJsonWithSchema('{"name":"daily","retries":2}', schema)).toEqual({ name: 'daily', retries: 2 });
    expect(() => parseJsonWithSchema('{"name":"daily"}', schema, 'invalid payload')).toThrow('invalid payload');
    expect(() => parseJsonWithSchema('{bad json}', schema)).toThrow('JSON 解析失败');
  });

  it('validates API responses and surfaces structured errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'tool.excel', enabled: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 7 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'not allowed' }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    const schema = z.object({ id: z.string(), enabled: z.boolean() });
    await expect(api('/api/tools/tool.excel', { schema })).resolves.toEqual({ id: 'tool.excel', enabled: true });
    await expect(api('/api/tools/bad', { schema })).rejects.toMatchObject({ name: 'ApiError', status: 200 });
    await expect(api('/api/tools/forbidden', { schema })).rejects.toMatchObject({ name: 'ApiError', status: 403, message: 'not allowed' });
  });

  it('wraps invalid JSON responses in ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 502 })));

    await expect(api('/api/broken')).rejects.toBeInstanceOf(ApiError);
  });
});
