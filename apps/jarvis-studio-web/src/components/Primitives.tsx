import type { ReactNode } from 'react';

const statusLabels: Record<string, string> = {
  success: '成功 (Success)',
  completed: '完成 (Completed)',
  failed: '失败 (Failed)',
  error: '错误 (Error)',
  running: '运行中 (Running)',
  created: '已创建 (Created)',
  scoring: '评分中 (Scoring)',
  cancelled: '已取消 (Cancelled)',
  improved: '改善 (Improved)',
  regressed: '退步 (Regressed)',
  changed: '有变化 (Changed)',
  unchanged: '持平 (Unchanged)',
  unmatched: '未匹配 (Unmatched)',
  p0: 'P0',
  p1: 'P1',
  p2: 'P2',
  p3: 'P3',
  enabled: '启用 (Enabled)',
  disabled: '停用 (Disabled)',
  deprecated: '弃用 (Deprecated)',
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '严重风险',
  allow: '允许 (Allow)',
  approve: '审批 (Approve)',
  deny: '拒绝 (Deny)',
  open: '待处理',
  investigating: '调查中',
  fixed: '已修复',
  ignored: '已忽略',
  healthy: '健康',
  draft: '草稿',
  ready: '就绪',
  waiting_approval: '等待审批',
  accepted: '已采纳',
  archived: '已归档',
  pending: '待审批',
  approved: '已批准',
  approved_with_changes: '带修改批准',
  rejected: '已拒绝',
  passed: '通过',
  warning: '警告'
};

const metricLabels: Record<string, string> = {
  DATASETS: '数据集 (Datasets)',
  'VERSIONED CASES': '用例 (Cases)',
  'EVAL RUNS': '评测运行 (Eval Runs)',
  'LATEST PASS RATE': '最新通过率 (Latest Pass Rate)',
  'PASS RATE': '通过率 (Pass Rate)',
  'AVG SCORE': '平均分 (Avg Score)',
  'AVG LATENCY': '平均耗时 (Avg Latency)',
  'AVG TOKENS / COST': '平均 Token / 成本',
  'RUNS CAPTURED': '已捕获运行 (Runs)',
  'SUCCESS RATE': '成功率 (Success Rate)',
  'TOKENS OBSERVED': 'Token 总量',
  MODEL: '模型 (Model)',
  PROMPT: 'Prompt 版本',
  LATENCY: '耗时 (Latency)',
  TOKENS: 'Token',
  SCORE: '评分 (Score)',
  'USED TOKENS': '已用 Token',
  'CONTEXT LIMIT': '上下文上限',
  UTILIZATION: '利用率 (Utilization)',
  SEGMENTS: '片段 (Segments)',
  EXCLUDED: '已排除 (Excluded)',
  'LIVE EVENTS': '实时事件',
  'CONTEXT SNAPSHOTS': '上下文快照',
  'TOOL CALLS': '工具调用',
  STATUS: '状态 (Status)',
  RUN: '运行 (Run)',
  IMPROVED: '改善',
  REGRESSED: '退步',
  UNCHANGED: '持平',
  'NEW FAILURES': '新增失败',
  'TOTAL COST': '总成本',
  'PROVIDER PROFILES': '服务商配置',
  'REGISTRY MANAGED': '注册表托管',
  'HEALTHY SIGNALS': '健康连接',
  'ENCRYPTED KEYS': '已加密密钥',
  SKILLS: 'Skills',
  TOOLS: 'Tools',
  'OPEN FAILURES': '待处理 Failure',
  'PENDING APPROVALS': '待审批',
  'DENIED CALLS': '已拒绝调用',
  SNAPSHOTS: '回放快照',
  EXPERIMENTS: '实验矩阵',
  'AVG OUTPUT TOKENS': '平均输出 Token'
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{statusLabels[status] ?? status}</span>;
}

export function Metric({ label, value, tone = 'default' }: { label: string; value: ReactNode; tone?: string }) {
  return <div className={`metric metric-${tone}`}><span>{metricLabels[label] ?? label}</span><strong>{value}</strong></div>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header">
    <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty"><span>暂无数据 (No signal)</span><p>{children}</p></div>;
}

export function JsonView({ value }: { value: unknown }) {
  return <pre className="json-view">{safeStringify(value)}</pre>;
}

export function Loading() {
  return <div className="loading"><i /><span>正在同步观测数据</span><Skeleton rows={3} /></div>;
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="skeleton" aria-hidden="true">
    {Array.from({ length: rows }, (_, index) => <span key={index} style={{ width: `${96 - index * 13}%` }} />)}
  </div>;
}

export const jsonViewLimits = {
  maxArrayItems: 120,
  maxDepth: 8,
  maxLength: 40000,
  maxNodes: 1200,
  maxObjectKeys: 160
};

export function safeStringify(value: unknown) {
  try {
    const text = JSON.stringify(limitJson(value), null, 2) ?? String(value);
    return text.length > jsonViewLimits.maxLength
      ? `${text.slice(0, jsonViewLimits.maxLength)}\n... 已截断，完整 JSON 超过 ${jsonViewLimits.maxLength} 字符 ...`
      : text;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return `无法格式化 JSON: ${message}`;
  }
}

function limitJson(value: unknown) {
  const seen = new WeakSet<object>();
  const state = { nodes: 0, truncated: false };
  const next = walkJson(value, 0, seen, state);
  if (!state.truncated) return next;
  return { __truncated: `JSON 超过 ${jsonViewLimits.maxDepth} 层或 ${jsonViewLimits.maxNodes} 个节点，已截断。`, value: next };
}

function walkJson(value: unknown, depth: number, seen: WeakSet<object>, state: { nodes: number; truncated: boolean }): unknown {
  state.nodes += 1;
  if (state.nodes > jsonViewLimits.maxNodes) {
    state.truncated = true;
    return '[Truncated: node limit]';
  }
  // Trace 事件常包含高精度 BigInt 时间戳。原生 JSON.stringify 会对 BigInt 抛 TypeError，
  // 这里提前转换为字符串，保留可读性且避免降级到错误兜底文本。
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (depth >= jsonViewLimits.maxDepth) {
    state.truncated = true;
    return Array.isArray(value) ? `[Truncated Array(${value.length})]` : '[Truncated Object]';
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, jsonViewLimits.maxArrayItems).map((item) => walkJson(item, depth + 1, seen, state));
    if (value.length > jsonViewLimits.maxArrayItems) {
      state.truncated = true;
      items.push(`... ${value.length - jsonViewLimits.maxArrayItems} more items`);
    }
    return items;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const limitedEntries = entries.slice(0, jsonViewLimits.maxObjectKeys).map(([key, item]) => [key, walkJson(item, depth + 1, seen, state)]);
  const output = Object.fromEntries(limitedEntries);
  if (entries.length > jsonViewLimits.maxObjectKeys) {
    state.truncated = true;
    output.__truncatedKeys = `${entries.length - jsonViewLimits.maxObjectKeys} more keys`;
  }
  return output;
}
