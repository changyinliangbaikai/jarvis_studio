import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { readTraceJsonl } from './trace.ts';

describe('trace command parser', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
  });

  it('validates trace JSONL and reports invalid lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-trace-'));
    tempDirs.push(dir);
    const file = join(dir, 'trace.jsonl');
    writeFileSync(file, [
      JSON.stringify({ eventId: 'evt_1', eventType: 'run.start', timestamp: '2026-06-19T00:00:00.000Z', runId: 'run_1', payload: {} }),
      '{"eventType":"bad"}',
      'not json'
    ].join('\n'));

    const result = await readTraceJsonl(file);

    expect(result.events).toHaveLength(1);
    expect(result.invalidLines.map((item) => item.line)).toEqual([2, 3]);
  });
});
