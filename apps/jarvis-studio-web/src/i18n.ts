import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

void i18n.use(initReactI18next).init({
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
  lng: 'zh',
  resources: {
    zh: {
      translation: {
        shell: {
          brand: 'JARVIS',
          mode: '本地观测台',
          online: '在线',
          tagline: 'Agent Runtime 评测与观测平台',
          endpoint: 'LOCAL://4310',
          footer: '治理门禁'
        },
        nav: {
          runtimeEval: 'Runtime 评测',
          observability: '运行观测',
          governance: '能力治理',
          context: '上下文治理',
          quality: '质量诊断',
          experiments: '实验优化'
        }
      }
    }
  }
});

export { i18n };
