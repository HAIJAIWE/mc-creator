import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.js';
import { ToastProvider } from './components/ToastProvider.js';
import { initTheme } from './lib/themes.js';

// 首屏渲染前同步应用已保存主题，避免闪烁/刷新回默认
initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
