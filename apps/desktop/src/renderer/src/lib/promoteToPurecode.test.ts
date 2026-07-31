import { describe, it, expect } from 'vitest';
import {
  promoteCodeNodeToPurecode,
  promoteMultipleCodeNodes,
  type CodeNodeDataForPromotion,
} from './promoteToPurecode.js';

// === 测试辅助函数 ===

/** 构造一个默认的 CodeNodeDataForPromotion，允许部分覆盖 */
function makeCodeNode(overrides: Partial<CodeNodeDataForPromotion> = {}): CodeNodeDataForPromotion {
  return {
    nodeId: 'code_test_1',
    label: '测试代码节点',
    note: '测试备注',
    language: 'java',
    code: 'return input;',
    inputSignature: '{"input": "item_stack"}',
    outputSignature: '{"output": "item_stack"}',
    methodName: 'process',
    ...overrides,
  };
}

/** 从结果中按后缀查找文件 */
function findFile(result: { files: { path: string; content: string }[] }, suffix: string) {
  return result.files.find((f) => f.path.endsWith(suffix));
}

describe('promoteToPurecode', () => {
  describe('promoteCodeNodeToPurecode - 单节点提升', () => {
    it('1. 生成 4 个文件（ModMain.java、ModCustomCode.java、fabric.mod.json、build.gradle）', () => {
      const result = promoteCodeNodeToPurecode(makeCodeNode(), 'ruby_tools');
      const paths = result.files.map((f) => f.path);
      expect(paths).toContain('src/main/java/com/example/ruby_tools/RubyToolsMod.java');
      expect(paths).toContain('src/main/java/com/example/ruby_tools/ModCustomCode.java');
      expect(paths).toContain('src/main/resources/fabric.mod.json');
      expect(paths).toContain('build.gradle');
      expect(result.files).toHaveLength(4);
    });

    it('2. ModCustomCode.java 包含用户代码', () => {
      const result = promoteCodeNodeToPurecode(
        makeCodeNode({ code: 'ItemStack output = input.copy();\nreturn output;' }),
        'ruby_tools',
      );
      const customCode = findFile(result, 'ModCustomCode.java');
      expect(customCode).toBeDefined();
      expect(customCode!.content).toContain('ItemStack output = input.copy();');
      expect(customCode!.content).toContain('return output;');
    });

    it('3. ModCustomCode.java 包含方法签名注释（nodeId/label/note）', () => {
      const result = promoteCodeNodeToPurecode(
        makeCodeNode({ nodeId: 'code_abc', label: '我的节点', note: '我的备注' }),
        'demo',
      );
      const customCode = findFile(result, 'ModCustomCode.java');
      expect(customCode).toBeDefined();
      expect(customCode!.content).toContain('nodeId: code_abc');
      expect(customCode!.content).toContain('label: 我的节点');
      expect(customCode!.content).toContain('note: 我的备注');
    });

    it('4. 主类 Java 文件调用 ModCustomCode.initialize()', () => {
      const result = promoteCodeNodeToPurecode(makeCodeNode(), 'demo');
      // 主类文件名为 <PascalCase>Mod.java，modId 'demo' → DemoMod.java
      const main = findFile(result, 'DemoMod.java');
      expect(main).toBeDefined();
      expect(main!.content).toContain('ModCustomCode.initialize();');
      // 主类应实现 ModInitializer 接口
      expect(main!.content).toContain('implements ModInitializer');
    });

    it('5. 包名/类名转换：modId "ruby_tools" → 包名 com.example.ruby_tools + 主类 RubyToolsMod', () => {
      const result = promoteCodeNodeToPurecode(makeCodeNode(), 'ruby_tools');
      expect(result.packageName).toBe('com.example.ruby_tools');
      expect(result.mainClassName).toBe('RubyToolsMod');
      const main = findFile(result, 'RubyToolsMod.java');
      expect(main).toBeDefined();
      expect(main!.content).toContain('package com.example.ruby_tools;');
      expect(main!.content).toContain('public class RubyToolsMod implements ModInitializer {');
    });
  });

  describe('promoteMultipleCodeNodes - 多节点提升', () => {
    it('6. 2 个 code 节点 → ModCustomCode.java 包含 2 个方法', () => {
      const nodes = [
        makeCodeNode({ nodeId: 'code_1', methodName: 'process', code: 'return input;' }),
        makeCodeNode({ nodeId: 'code_2', methodName: 'enchant', code: 'return null;' }),
      ];
      const result = promoteMultipleCodeNodes(nodes, 'demo');
      const customCode = findFile(result, 'ModCustomCode.java');
      expect(customCode).toBeDefined();
      // 两个方法名都应作为 public static 出现
      expect(customCode!.content).toMatch(/public static \w+ process\(/);
      expect(customCode!.content).toMatch(/public static \w+ enchant\(/);
      // 两个 nodeId 注释都应出现
      expect(customCode!.content).toContain('nodeId: code_1');
      expect(customCode!.content).toContain('nodeId: code_2');
      // 同时包含两段用户代码
      expect(customCode!.content).toContain('return input;');
      expect(customCode!.content).toContain('return null;');
    });
  });

  describe('边界处理', () => {
    it('7. code 字段为空时生成 TODO 占位', () => {
      const result = promoteCodeNodeToPurecode(makeCodeNode({ code: '' }), 'demo');
      const customCode = findFile(result, 'ModCustomCode.java');
      expect(customCode).toBeDefined();
      expect(customCode!.content).toContain('// TODO: 在此实现逻辑');
    });

    it('8. 非法 methodName 被清理（特殊字符 → 下划线）', () => {
      const result = promoteCodeNodeToPurecode(
        makeCodeNode({ methodName: 'pro-cess!name' }),
        'demo',
      );
      const customCode = findFile(result, 'ModCustomCode.java');
      expect(customCode).toBeDefined();
      // 'pro-cess!name' → 'pro_cess_name'
      expect(customCode!.content).toMatch(/public static \w+ pro_cess_name\(/);
      // 原非法名不应作为方法签名出现
      expect(customCode!.content).not.toMatch(/public static \w+ pro-cess!name\(/);
    });

    it('9. 空 modId 回退到 untitled', () => {
      const result = promoteCodeNodeToPurecode(makeCodeNode(), '');
      expect(result.packageName).toBe('com.example.untitled');
      expect(result.mainClassName).toBe('UntitledMod');
      const paths = result.files.map((f) => f.path);
      expect(paths.some((p) => p.includes('com/example/untitled/'))).toBe(true);
      expect(paths).toContain('src/main/java/com/example/untitled/UntitledMod.java');
      expect(paths).toContain('src/main/java/com/example/untitled/ModCustomCode.java');
    });
  });

  describe('生成的配置文件', () => {
    it('10. fabric.mod.json 是合法 JSON（可被 JSON.parse）', () => {
      const result = promoteCodeNodeToPurecode(makeCodeNode(), 'demo');
      const fmj = findFile(result, 'fabric.mod.json');
      expect(fmj).toBeDefined();
      expect(() => JSON.parse(fmj!.content)).not.toThrow();
      const parsed = JSON.parse(fmj!.content) as {
        schemaVersion: number;
        id: string;
        entrypoints: { main: string[] };
        depends: Record<string, string>;
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.id).toBe('demo');
      expect(parsed.entrypoints.main).toContain('com.example.demo.DemoMod');
      expect(parsed.depends.java).toBe('>=21');
    });

    it('11. build.gradle 包含 fabric-loom 与 Java 21', () => {
      const result = promoteCodeNodeToPurecode(makeCodeNode(), 'demo');
      const bg = result.files.find((f) => f.path === 'build.gradle');
      expect(bg).toBeDefined();
      expect(bg!.content).toContain('fabric-loom');
      expect(bg!.content).toContain('JavaVersion.VERSION_21');
    });
  });

  describe('PromotionResult 摘要', () => {
    it('12. summary 包含节点数与文件数', () => {
      const result = promoteCodeNodeToPurecode(makeCodeNode(), 'demo');
      expect(result.summary).toContain('1');
      expect(result.summary).toContain('4');
      expect(result.summary).toContain('DemoMod');
    });

    it('13. 多节点 summary 包含正确的节点数', () => {
      const nodes = [
        makeCodeNode({ nodeId: 'a', methodName: 'a' }),
        makeCodeNode({ nodeId: 'b', methodName: 'b' }),
        makeCodeNode({ nodeId: 'c', methodName: 'c' }),
      ];
      const result = promoteMultipleCodeNodes(nodes, 'demo');
      expect(result.summary).toContain('3');
      expect(result.summary).toContain('4');
    });
  });

  describe('签名解析', () => {
    it('14. inputSignature 解析为 Java 参数类型', () => {
      const result = promoteCodeNodeToPurecode(
        makeCodeNode({
          inputSignature: '{"input": "item_stack", "count": "integer"}',
          outputSignature: '{"result": "boolean"}',
        }),
        'demo',
      );
      const customCode = findFile(result, 'ModCustomCode.java');
      expect(customCode).toBeDefined();
      // 输入参数：ItemStack input, int count
      expect(customCode!.content).toMatch(
        /public static boolean process\(ItemStack input, int count\)/,
      );
    });

    it('15. 非法 JSON 签名回退到无参数 / void', () => {
      const result = promoteCodeNodeToPurecode(
        makeCodeNode({
          inputSignature: 'not a json',
          outputSignature: '{{invalid',
        }),
        'demo',
      );
      const customCode = findFile(result, 'ModCustomCode.java');
      expect(customCode).toBeDefined();
      // 无输入参数、无输出 → void process()
      expect(customCode!.content).toMatch(/public static void process\(\)/);
    });

    it('16. 仅空白的 code 也生成 TODO 占位', () => {
      const result = promoteCodeNodeToPurecode(makeCodeNode({ code: '   \n\t  ' }), 'demo');
      const customCode = findFile(result, 'ModCustomCode.java');
      expect(customCode).toBeDefined();
      expect(customCode!.content).toContain('// TODO: 在此实现逻辑');
    });
  });
});
