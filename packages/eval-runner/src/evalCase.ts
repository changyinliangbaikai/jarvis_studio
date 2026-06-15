import { z } from 'zod';

const fileSchema = z.object({
  path: z.string().min(1),
  type: z.string().optional(),
  role: z.string().optional(),
  required: z.boolean().default(true)
});

const artifactSchema = z.object({
  type: z.string().min(1),
  nameContains: z.string().optional()
});

const scoringDimensionSchema = z.object({
  name: z.string().min(1),
  weight: z.number().nonnegative(),
  description: z.string().optional()
});

function normalizeCase(raw: unknown) {
  if (!raw || typeof raw !== 'object') return raw;
  const value = raw as Record<string, any>;
  const expected = (value.expected ?? {}) as Record<string, any>;
  const scoring = (value.scoring ?? {}) as Record<string, any>;
  const dimensions = scoring.dimensions ?? [];
  return {
    ...value,
    priority: value.priority ?? 'p1',
    version: value.version ?? '1.0.0',
    runtimeOverrides: value.runtimeOverrides ?? value.runtime_overrides ?? value.config ?? {},
    expected: {
      ...expected,
      mustSelectSkill: expected.mustSelectSkill ?? expected.must_select_skill ?? [],
      mustCallTools: expected.mustCallTools ?? expected.must_call_tools ?? [],
      forbiddenToolCalls: expected.forbiddenToolCalls ?? expected.forbidden_tool_calls ?? [],
      mustGenerate: expected.mustGenerate ?? expected.must_generate_artifacts ?? [],
      mustInclude: expected.mustInclude ?? expected.must_include ?? [],
      mustNotInclude: expected.mustNotInclude ?? expected.must_not_include ?? [],
      constraints: expected.constraints ?? {}
    },
    scoring: {
      ...scoring,
      profile: scoring.profile,
      maxScore: scoring.maxScore ?? scoring.max_score ?? 5,
      dimensions: Array.isArray(dimensions)
        ? dimensions
        : Object.entries(dimensions).map(([name, item]) => ({
          name,
          ...(item && typeof item === 'object' ? item : { weight: Number(item) })
        }))
    },
    passCriteria: value.passCriteria ?? value.pass_criteria ?? {
      minTotalScore: value.releaseGate?.minScore ?? value.release_gate?.min_score ?? 4,
      requiredChecks: []
    }
  };
}

export const evalCaseSchema = z.preprocess(normalizeCase, z.object({
  id: z.string().min(1),
  datasetId: z.string().optional(),
  name: z.string().min(1),
  category: z.string().min(1),
  priority: z.enum(['p0', 'p1', 'p2', 'p3']).default('p1'),
  version: z.string().min(1).default('1.0.0'),
  tags: z.array(z.string()).default([]),
  input: z.object({
    message: z.string().min(1),
    files: z.array(fileSchema).default([])
  }),
  runtimeOverrides: z.record(z.unknown()).default({}),
  expected: z.object({
    mustSelectSkill: z.array(z.string()).default([]),
    mustCallTools: z.array(z.string()).default([]),
    forbiddenToolCalls: z.array(z.string()).default([]),
    mustGenerate: z.array(artifactSchema).default([]),
    mustInclude: z.array(z.string()).default([]),
    mustNotInclude: z.array(z.string()).default([]),
    constraints: z.record(z.unknown()).default({})
  }),
  scoring: z.object({
    profile: z.string().optional(),
    maxScore: z.number().positive().default(5),
    dimensions: z.array(scoringDimensionSchema).default([])
  }),
  passCriteria: z.object({
    minTotalScore: z.number().min(0).max(5).default(4),
    requiredChecks: z.array(z.string()).default([])
  }).default({ minTotalScore: 4, requiredChecks: [] }),
  filePath: z.string().optional()
}));

function normalizeDataset(raw: unknown) {
  if (!raw || typeof raw !== 'object') return raw;
  const value = raw as Record<string, unknown>;
  return {
    ...value,
    createdAt: value.createdAt ?? value.created_at,
    caseGlob: value.caseGlob ?? value.case_glob ?? ['cases/*.yaml'],
    defaultRuntime: value.defaultRuntime ?? value.default_runtime ?? {},
    scoringProfile: value.scoringProfile ?? value.scoring_profile,
    releaseGate: value.releaseGate ?? value.release_gate,
    cases: value.cases ?? []
  };
}

export const evalDatasetSchema = z.preprocess(normalizeDataset, z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  category: z.string().default('general'),
  description: z.string().default(''),
  owner: z.string().default('jarvis'),
  createdAt: z.string().optional(),
  caseGlob: z.array(z.string()).default(['cases/*.yaml']),
  defaultRuntime: z.record(z.unknown()).default({}),
  scoringProfile: z.string().optional(),
  releaseGate: z.string().optional(),
  cases: z.array(z.unknown()).default([])
}));

export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalDataset = z.infer<typeof evalDatasetSchema>;
