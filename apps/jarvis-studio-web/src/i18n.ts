import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { zh } from './locales/zh.ts';
import { en } from './locales/en.ts';

const savedLang = localStorage.getItem('i18n_lang') || 'zh';

void i18n.use(initReactI18next).init({
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
  lng: savedLang,
  resources: {
    zh: {
      translation: zh
    },
    en: {
      translation: en
    }
  }
});

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('i18n_lang', lng);
});

export { i18n };

