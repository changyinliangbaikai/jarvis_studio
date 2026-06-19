import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { errorMessage, isAbortError } from '../api.ts';

export interface AsyncResourceState<T> {
  data: T | undefined;
  loading: boolean;
  error: string;
  reload: () => Promise<T | undefined>;
  setData: (value: T | undefined) => void;
  clearError: () => void;
}

interface AsyncResourceOptions {
  queryKey?: QueryKey;
  staleTime?: number;
}

export function useAsyncResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  enabled = true,
  options: AsyncResourceOptions = {}
): AsyncResourceState<T> {
  const queryClient = useQueryClient();
  const rawQueryKey = options.queryKey ?? ['async-resource', ...deps];
  const queryKeyHash = JSON.stringify(rawQueryKey);
  const queryKey = useMemo(() => rawQueryKey, [queryKeyHash]);
  const query = useQuery<T>({
    enabled,
    placeholderData: (previous) => previous,
    queryFn: ({ signal }) => loader(signal),
    queryKey,
    staleTime: options.staleTime
  });

  const setData = useCallback((value: T | undefined) => {
    queryClient.setQueryData(queryKey, value);
  }, [queryClient, queryKey]);

  const reload = useCallback(async () => {
    if (!enabled) return undefined;
    try {
      return await queryClient.fetchQuery<T>({ queryFn: ({ signal }) => loader(signal), queryKey, staleTime: 0 });
    } catch (caught) {
      if (isAbortError(caught)) return undefined;
      return undefined;
    }
  }, [enabled, loader, queryClient, queryKey]);

  const clearError = useCallback(() => {
    void queryClient.resetQueries({ exact: true, queryKey });
  }, [queryClient, queryKey]);

  return {
    data: query.data,
    loading: query.isLoading || query.isFetching,
    error: query.error && !isAbortError(query.error) ? errorMessage(query.error) : '',
    reload,
    setData,
    clearError
  };
}
