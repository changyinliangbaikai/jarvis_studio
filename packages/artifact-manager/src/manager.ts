import { randomUUID, createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { basename, relative, resolve, extname } from 'node:path';
import type { RuntimeResult } from '@jarvis/shared-types';
import type { TraceEvent } from '@jarvis/trace-sdk';

export interface RunArtifact {
  id: string;
  runId: string;
  taskId?: string;
  type: string;
  name: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  toolCallId?: string;
  createdAt: string;
}

const MIME: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

export interface ArtifactManagerInput {
  result: RuntimeResult;
  workspacePath: string;
  artifactDir: string;
  runId: string;
  taskId?: string;
  emit: (event: TraceEvent) => void;
  ids: { projectId?: string; sessionId?: string; turnId?: string };
}

export function collectArtifacts(input: ArtifactManagerInput): RunArtifact[] {
  const { result, workspacePath, artifactDir, runId, taskId } = input;
  mkdirSync(artifactDir, { recursive: true });
  const manifest: RunArtifact[] = [];

  for (const artifact of result.artifacts) {
    const source = resolve(workspacePath, artifact.path);
    if (!existsSync(source)) {
      console.warn(`[artifact] 跳过不存在: ${source}`);
      continue;
    }
    const fileName = basename(artifact.path);
    const target = resolve(artifactDir, fileName);
    copyFileSync(source, target);
    const bytes = statSync(target).size;
    const checksum = `sha256:${createHash('sha256').update(readFileSync(target)).digest('hex')}`;
    const item: RunArtifact = {
      id: artifact.id ?? `artifact_${randomUUID()}`,
      runId,
      taskId: artifact.taskId ?? taskId,
      type: artifact.type ?? 'file',
      name: fileName,
      path: relative(workspacePath, target).split('\\').join('/'),
      mimeType: MIME[extname(fileName).toLowerCase()] ?? 'application/octet-stream',
      sizeBytes: bytes,
      checksum,
      toolCallId: artifact.toolCallId,
      createdAt: new Date().toISOString()
    };
    manifest.push(item);
    console.log(`[artifact] 注册产物 ${item.name} (${bytes} bytes)`);
    // 补发 artifact.register 事件（Runtime emit artifact.write，CLI 补充注册语义，向前兼容）
    input.emit({
      eventId: `evt_${randomUUID()}`,
      eventType: 'artifact.register',
      timestamp: item.createdAt,
      projectId: input.ids.projectId,
      sessionId: input.ids.sessionId,
      turnId: input.ids.turnId,
      runId,
      spanId: `span_${randomUUID()}`,
      payload: { name: `artifact.register: ${item.name}`, artifact: item }
    });
  }

  const manifestPath = resolve(artifactDir, `${runId}.artifacts.json`);
  writeFileSync(manifestPath, `${JSON.stringify({ runId, taskId, artifacts: manifest }, null, 2)}\n`, 'utf8');
  console.log(`[artifact] manifest: ${manifestPath} (${manifest.length} 个产物)`);
  return manifest;
}
