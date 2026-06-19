import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'jarvis-studio-theme';

// 与 index.html 的内联脚本保持一致，确保首屏 SSR/CSR 主题判断同源
function readInitialTheme(): Theme {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'light';
  const fromAttribute = document.documentElement.dataset.theme;
  if (fromAttribute === 'light' || fromAttribute === 'dark') return fromAttribute;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (caught) {
    console.warn('[useTheme] localStorage read failed', caught);
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  // 主题变更时：同步到 <html data-theme>、写入 localStorage、更新 mobile theme-color、暴露给原生 color-scheme
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const themeColor = theme === 'dark' ? '#1c130d' : '#fcecd5';
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', themeColor);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (caught) {
      console.warn('[useTheme] localStorage write failed', caught);
    }
    console.debug('[useTheme] applied', { theme });
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, setTheme, toggle };
}
