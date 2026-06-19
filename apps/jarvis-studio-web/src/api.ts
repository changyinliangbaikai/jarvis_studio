import type { ZodType, ZodTypeDef } from 'zod';

type ApiOptions<T> = RequestInit & {
  schema?: ZodType<T, ZodTypeDef, unknown>;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError';
}

export function errorMessage(error: unknown, fallback = '请求失败') {
  if (isAbortError(error)) return '';
  if (error instanceof Error) return error.message;
  return fallback;
}

export async function api<T>(path: string, options?: ApiOptions<T>): Promise<T> {
  const { schema, ...fetchOptions } = options ?? {};
  const headers = new Headers(fetchOptions.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  if (fetchOptions.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(path, {
    ...fetchOptions,
    headers
  });
  const body = await response.text();
  let data: unknown;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    throw new ApiError(`服务端返回了无法解析的响应（HTTP ${response.status}）`, response.status, path, body.slice(0, 500));
  }
  if (!response.ok) {
    const errorBody = data && typeof data === 'object' ? data as { error?: unknown; message?: unknown } : {};
    const message = typeof errorBody.error === 'string'
      ? errorBody.error
      : typeof errorBody.message === 'string'
        ? errorBody.message
        : `HTTP ${response.status}`;
    throw new ApiError(message, response.status, path, data);
  }
  if (!schema) return data as T;
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError('服务端响应结构与前端契约不匹配', response.status, path, parsed.error.flatten());
  }
  return parsed.data;
}

export function post<T = unknown>(path: string, body: unknown, options?: ApiOptions<T>) {
  return api<T>(path, { ...options, method: 'POST', body: body != null ? JSON.stringify(body) : undefined });
}

export function parseJsonWithSchema<T>(text: string, schema: ZodType<T, ZodTypeDef, unknown>, message = 'JSON 结构校验失败'): T {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON 解析失败');
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error(message);
  return parsed.data;
}

export async function download(path: string, filename: string, options?: RequestInit) {
  const response = await fetch(path, options);
  if (!response.ok) throw new ApiError(`下载失败（HTTP ${response.status}）`, response.status, path);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
