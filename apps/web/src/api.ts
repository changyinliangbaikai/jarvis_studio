export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers }
  });
  const body = await response.text();
  let data: T & { error?: string };
  try {
    data = (body ? JSON.parse(body) : {}) as T & { error?: string };
  } catch {
    throw new Error(`服务端返回了无法解析的响应（HTTP ${response.status}）`);
  }
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export function post<T>(path: string, body: unknown) {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function formatNumber(value: unknown) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(Number(value ?? 0));
}

export function formatDuration(value: unknown) {
  const ms = Number(value ?? 0);
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function formatDate(value: unknown) {
  return value ? new Date(String(value)).toLocaleString('zh-CN', { hour12: false }) : '—';
}
