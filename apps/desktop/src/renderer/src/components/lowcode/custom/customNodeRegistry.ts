import {
  CustomNodeSchema,
  type CustomNodeSchema as CustomNodeSchemaType,
} from '@mc-creator/shared';

/**
 * 自定义节点注册表（单例）
 *
 * 维护已注册的自定义节点类型（CustomNodeSchema），支持：
 * - register/get/has/list/clear 基础操作
 * - importJSON：从 JSON 字符串导入并注册（含 Zod 校验）
 * - export/exportAll：导出为 JSON 字符串（可分享给其他用户）
 */
export class CustomNodeRegistry {
  private map = new Map<string, CustomNodeSchemaType>();

  register(schema: CustomNodeSchemaType): void {
    this.map.set(schema.typeId, schema);
  }

  get(typeId: string): CustomNodeSchemaType | undefined {
    return this.map.get(typeId);
  }

  has(typeId: string): boolean {
    return this.map.has(typeId);
  }

  list(): CustomNodeSchemaType[] {
    return [...this.map.values()];
  }

  clear(): void {
    this.map.clear();
  }

  importJSON(json: string): { ok: true } | { ok: false; error: string } {
    try {
      const raw = JSON.parse(json);
      const result = CustomNodeSchema.safeParse(raw);
      if (!result.success) {
        return { ok: false, error: result.error.message };
      }
      this.register(result.data);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  export(typeId: string): string {
    const schema = this.map.get(typeId);
    if (!schema) return '{}';
    return JSON.stringify(schema, null, 2);
  }

  exportAll(): string {
    return JSON.stringify(this.list(), null, 2);
  }
}

export const customNodeRegistry = new CustomNodeRegistry();
