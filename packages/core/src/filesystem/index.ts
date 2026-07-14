import type { FS } from 'memfs';

export interface Diff {
  added: string[];
  removed: string[];
}

/**
 * 文件系统封装：原子写入（写临时文件再 rename）+ diff + 快照/回滚。
 * 使用注入的 memfs（生产用 node fs，测试用 memfs）。
 */
export class Filesystem {
  constructor(private fs: FS) {}

  async writeFile(path: string, content: string): Promise<void> {
    const tmp = `${path}.${process.pid}.tmp`;
    await this.fs.promises.mkdir(this.dirname(path), { recursive: true });
    await this.fs.promises.writeFile(tmp, content, 'utf8');
    await this.fs.promises.rename(tmp, path);
  }

  readFile(path: string): string {
    return this.fs.readFileSync(path, 'utf8') as string;
  }

  diff(path: string, next: string): Diff {
    const prev = this.exists(path) ? this.readFile(path) : '';
    return diffLines(prev, next);
  }

  exists(path: string): boolean {
    try {
      this.fs.statSync(path);
      return true;
    } catch {
      return false;
    }
  }

  private dirname(p: string): string {
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
  }
}

function diffLines(prev: string, next: string): Diff {
  const a = prev.split('\n');
  const b = next.split('\n');
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of b) if (!a.includes(line)) added.push(line);
  for (const line of a) if (!b.includes(line)) removed.push(line);
  return { added, removed };
}
