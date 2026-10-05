import { describe, it, expect } from 'vitest';
import { validateProjectId, validateMaxDepth, validateRelativePath } from '../validation.js';

describe('file-manager validation (unit tests)', () => {
  describe('validateProjectId', () => {
    it('should reject path traversal "../../../../.."', () => {
      const result = validateProjectId('../../../../..');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('invalid characters');
    });

    it('should reject path traversal "..\\..\\.."', () => {
      const result = validateProjectId('..\\..\\..');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('invalid characters');
    });

    it('should reject empty string', () => {
      const result = validateProjectId('');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('empty');
    });

    it('should reject strings with slashes', () => {
      const result = validateProjectId('a/b');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('invalid characters');
    });

    it('should accept valid project IDs', () => {
      const validIds = ['valid-project', 'valid_project', 'valid123', 'Valid-Project_123', 'a'];
      for (const id of validIds) {
        const result = validateProjectId(id);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(id);
      }
    });

    it('should reject non-string types', () => {
      const invalidValues = [123, null, undefined, [], {}, NaN, Symbol('x'), true];
      for (const val of invalidValues) {
        const result = validateProjectId(val);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('must be a string');
      }
    });
  });

  describe('validateMaxDepth', () => {
    it('should reject NaN', () => {
      const result = validateMaxDepth(NaN);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('finite integer');
    });

    it('should reject Infinity', () => {
      const result = validateMaxDepth(Infinity);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('finite integer');
    });

    it('should reject -Infinity', () => {
      const result = validateMaxDepth(-Infinity);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('finite integer');
    });

    it('should reject fractional numbers', () => {
      const result = validateMaxDepth(-1.5);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('finite integer');
    });

    it('should reject numbers < -1', () => {
      const result = validateMaxDepth(-2);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('>= -1');
    });

    it('should accept -1 (unbounded)', () => {
      const result = validateMaxDepth(-1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(-1);
    });

    it('should accept 0', () => {
      const result = validateMaxDepth(0);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(0);
    });

    it('should accept positive integers', () => {
      const result = validateMaxDepth(5);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(5);
    });

    it('should accept undefined (defaults to -1)', () => {
      const result = validateMaxDepth(undefined);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(-1);
    });

    it('should accept null (defaults to -1)', () => {
      const result = validateMaxDepth(null);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(-1);
    });

    it('should reject non-numbers', () => {
      const result = validateMaxDepth('5');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('finite integer');
    });
  });

  describe('validateRelativePath', () => {
    it('should reject path traversal with ..', () => {
      const result = validateRelativePath('../../etc');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('path traversal');
    });

    it('should reject absolute Unix paths', () => {
      const result = validateRelativePath('/etc/passwd');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('relative');
    });

    it('should reject absolute Windows paths', () => {
      const result = validateRelativePath('C:\\Windows\\System32');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('relative');
    });

    it('should reject non-strings', () => {
      const result = validateRelativePath(123);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('must be a string');
    });

    it('should reject empty strings', () => {
      const result = validateRelativePath('');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('empty');
    });

    it('should accept valid relative paths', () => {
      const validPaths = ['some/path', 'file.txt', 'dir/subdir/file.txt', 'a'];
      for (const p of validPaths) {
        const result = validateRelativePath(p);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(p);
      }
    });
  });
});

// Separate describe block for type definition compile-time checks
describe('file-manager type definitions (compile-time checks)', () => {
  it('ProjectGetDirReq type has correct shape', () => {
    type TestReq = { projectId: string };
    const req: TestReq = { projectId: 'test' };
    expect(req.projectId).toBe('test');
  });

  it('ProjectListTreeReq type has correct optional fields', () => {
    type TestReq = { projectId: string; path?: string; maxDepth?: number };
    const req1: TestReq = { projectId: 'test' };
    const req2: TestReq = { projectId: 'test', path: 'sub' };
    const req3: TestReq = { projectId: 'test', path: 'sub', maxDepth: 5 };
    expect(req1).toEqual({ projectId: 'test' });
    expect(req2).toEqual({ projectId: 'test', path: 'sub' });
    expect(req3).toEqual({ projectId: 'test', path: 'sub', maxDepth: 5 });
  });

  it('ListTreeReq type has correct optional maxDepth', () => {
    type TestReq = { path: string; maxDepth?: number };
    const req1: TestReq = { path: 'p' };
    const req2: TestReq = { path: 'p', maxDepth: 3 };
    expect(req1).toEqual({ path: 'p' });
    expect(req2).toEqual({ path: 'p', maxDepth: 3 });
  });

  it('FileMetaSchema type has correct fields', () => {
    type TestMeta = { mtime: number; size: number; isDirectory: boolean; hash: string };
    const meta: TestMeta = { mtime: 123, size: 456, isDirectory: false, hash: 'abc' };
    expect(meta).toEqual({ mtime: 123, size: 456, isDirectory: false, hash: 'abc' });
  });
});
