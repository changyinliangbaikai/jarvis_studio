export interface RunArtifact {
  id: string;
  type: string;
  path: string;
  sizeBytes: number;
  toolCallId?: string;
  workspaceId?: string;
  taskId?: string;
}
