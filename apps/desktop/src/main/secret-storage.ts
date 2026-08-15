import { safeStorage } from 'electron';

/**
 * safeStorage 加密工具（model-config 与 curseforge-config 共用）。
 *
 * 策略：
 * - 加密后以 'enc:' 前缀 + base64 存储
 * - 解密失败回退为空串
 * - 平台不支持加密（如 Linux 无 secret service）时退化为明文
 */
export function encryptSecret(value: string): string {
  if (value && safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(value).toString('base64');
  }
  return value;
}

export function decryptSecret(stored: string): string {
  if (stored && stored.startsWith('enc:') && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    } catch {
      // 解密失败（如跨机器迁移 / 系统密钥变更）：回退为空串避免崩溃，并给出提示
      console.warn(
        '[mc-creator] 解密 API Key 失败，已回退为空（可能是跨机器迁移或系统密钥变更导致）',
      );
      return '';
    }
  }
  return stored;
}
