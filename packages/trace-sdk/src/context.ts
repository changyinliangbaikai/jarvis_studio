export interface ContextSegment {
  id: string;
  type: string;
  name: string;
  version?: string;
  contentRef?: string;
  preview?: string;
  tokens: number;
  included: boolean;
  truncated?: boolean;
  compressed?: boolean;
  priority?: number;
  reason?: string;
}

export interface ContextSnapshot {
  id: string;
  runId: string;
  turnId?: string;
  llmCallId?: string;
  totalTokens: number;
  maxContextTokens: number;
  truncated: boolean;
  compressed: boolean;
  createdAt: string;
  segments: ContextSegment[];
  finalPromptRef?: string;
}
