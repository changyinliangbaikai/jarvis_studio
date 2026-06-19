import { z } from 'zod';

export const looseObjectSchema = z.record(z.unknown());

const entitySchema = z.object({ id: z.string() }).passthrough();

export const workspaceSchema = entitySchema.extend({
  name: z.string(),
  rootPath: z.string(),
  settings: looseObjectSchema.default({}),
  taskCount: z.coerce.number().default(0),
  artifactCount: z.coerce.number().default(0)
}).passthrough();

export const scenarioSchema = entitySchema.extend({
  name: z.string(),
  category: z.string().optional(),
  description: z.string().optional(),
  defaultSkillId: z.string().optional(),
  requiredTools: z.array(z.string()).default([]),
  defaultOutputs: z.array(z.string()).default([]),
  preflight: z.array(z.unknown()).default([]),
  postflight: z.array(z.unknown()).default([])
}).passthrough();

export const taskSchema = entitySchema.extend({
  title: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  workspaceId: z.string(),
  workspaceName: z.string().optional(),
  scenarioTemplateId: z.string().optional(),
  scenarioName: z.string().optional(),
  status: z.string(),
  priority: z.string(),
  input: looseObjectSchema.default({}),
  selectedModelProfileId: z.string().optional(),
  selectedSkillId: z.string().optional(),
  currentRunId: z.string().optional(),
  score: z.number().nullable().optional(),
  preflight: z.unknown().optional(),
  postflight: z.unknown().optional(),
  updatedAt: z.string().optional()
}).passthrough();

export const modelProviderSchema = entitySchema.extend({
  name: z.string(),
  providerType: z.union([z.literal('deterministic'), z.literal('openai-compatible')]),
  defaultModel: z.string(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  readOnly: z.boolean(),
  source: z.union([z.literal('builtin'), z.literal('environment'), z.literal('registry')]),
  apiKeyConfigured: z.boolean(),
  inputPricePer1MTokens: z.coerce.number().default(0),
  outputPricePer1MTokens: z.coerce.number().default(0),
  currency: z.string().default('USD')
}).passthrough();

export const modelProviderListSchema = z.array(modelProviderSchema);

export const toolRegistryItemSchema = entitySchema.extend({
  name: z.string(),
  version: z.string(),
  riskLevel: z.string(),
  defaultPolicy: z.string(),
  enabled: z.boolean(),
  manifest: looseObjectSchema,
  callCount: z.coerce.number().default(0),
  successRate: z.coerce.number().default(0),
  avgLatencyMs: z.coerce.number().default(0),
  avgOutputTokens: z.coerce.number().default(0),
  errorRate: z.coerce.number().default(0)
}).passthrough();

export const runtimeCapabilitySchema = z.object({
  version: z.string(),
  workspacePath: z.string(),
  providers: z.array(z.object({
    id: z.string(),
    label: z.string(),
    provider: z.union([z.literal('deterministic'), z.literal('openai-compatible')]),
    available: z.boolean(),
    model: z.string(),
    source: z.string(),
    isDefault: z.boolean(),
    lastTestStatus: z.string().optional()
  }).passthrough()),
  skills: z.array(z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string(),
    requiredTools: z.array(z.string()),
    defaultTask: z.string().optional(),
    defaultFiles: z.array(z.string()).optional()
  }).passthrough())
}).passthrough();

export const traceEventSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  timestamp: z.string(),
  runId: z.string().optional(),
  payload: looseObjectSchema.default({})
}).passthrough();
