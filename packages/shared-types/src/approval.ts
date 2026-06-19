export interface PermissionDecision {
  decisionId: string;
  toolCallId: string;
  toolId: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requestedPermissions: string[];
  decision: 'allow' | 'approve' | 'deny';
  reason: string;
  policyId: string;
}

export interface RuntimeApprovalRequest {
  approvalId: string;
  decisionId: string;
  toolCallId: string;
  toolId: string;
  riskLevel: PermissionDecision['riskLevel'];
  reason: string;
  requestedPermissions: string[];
  argumentsSummary: Record<string, unknown>;
  args: Record<string, unknown>;
  workspaceId?: string;
  taskId?: string;
  runId: string;
}

export interface RuntimeApprovalResult {
  decision: 'approved' | 'approved_with_changes' | 'rejected';
  note?: string;
  args?: Record<string, unknown>;
}
