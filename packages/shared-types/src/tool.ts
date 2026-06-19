export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permission: string;
  version?: string;
  category?: string;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  defaultPolicy?: 'allow' | 'approve' | 'deny';
  outputSchema?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  contextInjection?: Record<string, unknown>;
}

export interface ToolExecutionContext {
  workspacePath: string;
  runId: string;
}
