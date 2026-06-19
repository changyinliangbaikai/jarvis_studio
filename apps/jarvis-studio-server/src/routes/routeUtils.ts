import type { FastifyReply } from 'fastify';
import { ZodError, type ZodType } from 'zod';

export function respond<T>(reply: FastifyReply, action: () => T | Promise<T>, fallback = '请求处理失败') {
  // 统一兜底：若 action 内部已经显式 reply.send（如 modelProviders.ts 在 catch 中已记录日志并发送 400），
  // 直接返回 reply 即可，避免对同一请求再次 send 触发 Fastify "Double Send" 警告。
  const sendErrorIfPending = (error: unknown) => {
    if (reply.sent) {
      reply.log.warn({ err: error }, '[respond] reply 已发送，忽略后续错误兜底以避免 Double Send');
      return reply;
    }
    return badRequest(reply, error, fallback);
  };
  try {
    const result = action();
    if (isPromiseLike(result) && !isFastifyReply(result)) {
      return result.catch(sendErrorIfPending);
    }
    return result;
  } catch (error) {
    return sendErrorIfPending(error);
  }
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return Boolean(value && typeof value === 'object' && 'then' in value && typeof value.then === 'function');
}

function isFastifyReply(value: unknown): value is FastifyReply {
  return Boolean(value && typeof value === 'object' && 'send' in value && 'code' in value && 'raw' in value);
}

export function parseBody<T>(body: unknown, schema: ZodType<T>, label = '请求体') {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new Error(`${label}格式无效: ${formatZodError(parsed.error)}`);
  return parsed.data;
}

export function badRequest(reply: FastifyReply, error: unknown, fallback = '请求处理失败') {
  return reply.code(400).send({ error: error instanceof Error ? error.message : fallback });
}

function formatZodError(error: ZodError) {
  return error.issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : 'root';
      return `${path} ${issue.message}`;
    })
    .join('; ');
}
