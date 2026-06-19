export function formatNumber(value: unknown) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(Number.isFinite(number) ? number : 0);
}

export function formatDisplayValue(value: unknown, fallback = '—') {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return fallback;
}

export function formatDuration(value: unknown) {
  const rawMs = Number(value ?? 0);
  const ms = Number.isFinite(rawMs) ? rawMs : 0;
  const abs = Math.abs(ms);
  const formatted = abs >= 1000 ? `${(abs / 1000).toFixed(1)}s` : `${abs}ms`;
  return ms < 0 ? `-${formatted}` : formatted;
}

export function formatDate(value: unknown) {
  return formatDateTime(value);
}

export function formatDateTime(value: unknown) {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function formatRelativeTime(value: unknown, now = Date.now()) {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  const deltaSeconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(deltaSeconds);
  const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  if (abs < 60) return rtf.format(deltaSeconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(deltaSeconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(deltaSeconds / 3600), 'hour');
  return rtf.format(Math.round(deltaSeconds / 86400), 'day');
}
