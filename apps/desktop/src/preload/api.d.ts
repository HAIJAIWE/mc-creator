import type { McApi } from './index.js';
declare global {
  interface Window {
    mcApi: McApi;
  }
}
export {};
