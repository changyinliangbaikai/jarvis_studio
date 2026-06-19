const secretPatterns = [
  /Bearer\s+[^\s"']+/gi,
  /sk-[a-zA-Z0-9_-]{12,}/g,
  /("?(?:api[_-]?key|authorization)"?\s*[:=]\s*")[^"]+"/gi
];

export function redactDiagnostic(value: unknown): unknown {
  if (typeof value === 'string') {
    return secretPatterns.reduce((text, pattern) => text.replace(pattern, (match) => {
      const separator = match.includes(':') ? match.slice(0, match.indexOf(':') + 1) : '';
      return separator ? `${separator}"[REDACTED]"` : '[REDACTED]';
    }), value);
  }
  if (Array.isArray(value)) return value.map(redactDiagnostic);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /api[_-]?key|authorization/i.test(key) ? '[REDACTED]' : redactDiagnostic(item)
    ]));
  }
  return value;
}

export function logModelProviderError(event: string, details: Record<string, unknown>) {
  const entry = redactDiagnostic({
    timestamp: new Date().toISOString(),
    event,
    ...details
  });
  console.error(`[jarvis:model-provider:error] ${JSON.stringify(entry)}`);
}

export function diagnosticErrorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(error.cause === undefined ? {} : {
      cause: error.cause instanceof Error ? diagnosticErrorDetails(error.cause) : error.cause
    })
  };
}
