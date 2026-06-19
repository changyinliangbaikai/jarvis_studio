export interface SkillDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  systemPrompt: string;
  instructions: string;
  requiredTools: string[];
  permissions: string[];
  outputFile?: string;
  defaultTask?: string;
  defaultFiles?: string[];
  status?: 'enabled' | 'disabled' | 'deprecated';
  category?: string;
  triggers?: {
    keywords?: string[];
    fileTypes?: string[];
    intentExamples?: string[];
  };
  contextPolicy?: {
    priority?: string;
    maxTokens?: number;
    progressiveDisclosure?: boolean;
    reloadAfterCompaction?: boolean;
  };
  qualityGate?: {
    minEvalScore?: number;
    minSuccessRate?: number;
    maxToolErrorRate?: number;
  };
}

export interface SkillCandidate {
  skillId: string;
  version: string;
  score: number;
  matchedBy: string[];
  status: 'selected' | 'not_selected' | 'disabled';
  description: string;
}
