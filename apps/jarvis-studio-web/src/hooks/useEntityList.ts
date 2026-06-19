import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ZodType, ZodTypeDef } from 'zod';
import { api, errorMessage, isAbortError } from '../api.ts';

export interface EntityWithId {
  id: string;
}

interface EntityListOptions<T> {
  schema?: ZodType<T[], ZodTypeDef, unknown>;
  staleTime?: number;
}

export function useEntityList<T extends EntityWithId>(path: string, initialSelectedId = '', options: EntityListOptions<T> = {}) {
  const queryClient = useQueryClient();
  // selectedId 保存"用户意图"（包括手动清空），不再用 useEffect 强行回写以避免 Double Pass Render。
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [actionError, setActionError] = useState('');
  const queryKey = useMemo(() => ['entity-list', path] as const, [path]);
  const query = useQuery<T[]>({
    placeholderData: (previous) => previous,
    queryFn: ({ signal }) => api<T[]>(path, { schema: options.schema, signal }),
    queryKey,
    staleTime: options.staleTime
  });
  const items = query.data;

  // selected 走渲染期派生：若用户意图项已不存在则兜底到第一项，无需再通过 useEffect 同步回 state。
  const selected = useMemo(() => {
    if (!items || items.length === 0) return undefined;
    if (!selectedId) return items[0];
    return items.find((item) => item.id === selectedId) ?? items[0];
  }, [items, selectedId]);

  const refresh = useCallback(async (preferId?: string) => {
    setActionError('');
    try {
      const data = await queryClient.fetchQuery<T[]>({
        queryFn: ({ signal }) => api<T[]>(path, { schema: options.schema, signal }),
        queryKey,
        staleTime: 0
      });
      // preferId 显式传入时切换；否则保留当前用户意图，selected 由 useMemo 兜底到第一项。
      if (preferId !== undefined) setSelectedId(preferId);
      return data;
    } catch (caught) {
      if (!isAbortError(caught)) setActionError(errorMessage(caught));
      return undefined;
    }
  }, [options.schema, path, queryClient, queryKey]);

  return {
    items,
    selected,
    selectedId,
    setSelectedId,
    loading: query.isLoading || query.isFetching,
    error: actionError || (query.error && !isAbortError(query.error) ? errorMessage(query.error) : ''),
    setError: setActionError,
    refresh
  };
}
