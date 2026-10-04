/** v2.0 皮肤版本历史（Git-like 轻量版：提交/恢复/删除，localStorage 持久化） */

export interface SkinVersion {
  id: string;
  createdAt: number;
  message: string;
  dataUrl: string;
}

const KEY_PREFIX = 'mc-creator-skin-history:';
const LIMIT = 20;

export type HistoryScope = 'skin' | 'cape';

function keyOf(playerName: string, scope: HistoryScope = 'skin'): string {
  const base = `${KEY_PREFIX}${playerName || 'Player'}`;
  // skin 沿用老 key（兼容已有版本），cape 用独立 key
  return scope === 'skin' ? base : `${base}:cape`;
}

export function loadHistory(playerName: string, scope: HistoryScope = 'skin'): SkinVersion[] {
  try {
    const raw = localStorage.getItem(keyOf(playerName, scope));
    if (!raw) return [];
    const arr = JSON.parse(raw) as SkinVersion[];
    return Array.isArray(arr) ? arr.filter((v) => v && v.dataUrl) : [];
  } catch {
    return [];
  }
}

function persist(playerName: string, list: SkinVersion[], scope: HistoryScope = 'skin'): void {
  try {
    localStorage.setItem(keyOf(playerName, scope), JSON.stringify(list.slice(0, LIMIT)));
  } catch {
    /* 配额不足时静默跳过 */
  }
}

export function commitVersion(
  playerName: string,
  dataUrl: string,
  message?: string,
  scope: HistoryScope = 'skin',
): SkinVersion {
  const item: SkinVersion = {
    id: `v-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    createdAt: Date.now(),
    message: message?.trim() || `版本 ${new Date().toLocaleString()}`,
    dataUrl,
  };
  const next = [item, ...loadHistory(playerName, scope)].slice(0, LIMIT);
  persist(playerName, next, scope);
  return item;
}

export function deleteVersion(playerName: string, id: string, scope: HistoryScope = 'skin'): SkinVersion[] {
  const next = loadHistory(playerName, scope).filter((v) => v.id !== id);
  persist(playerName, next, scope);
  return next;
}

export function clearHistory(playerName: string, scope: HistoryScope = 'skin'): void {
  try {
    localStorage.removeItem(keyOf(playerName, scope));
  } catch {
    /* ignore */
  }
}
