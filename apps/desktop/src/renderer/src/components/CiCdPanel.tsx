import { useState } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { Copy, CheckCircle2, Save, Loader2, AlertTriangle } from 'lucide-react';
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';

type CiPlatform = 'github' | 'gitlab' | 'jenkins';

const PLATFORMS: { id: CiPlatform; label: string; icon: string }[] = [
  { id: 'github', label: 'GitHub Actions', icon: 'star' },
  { id: 'gitlab', label: 'GitLab CI', icon: 'box' },
  { id: 'jenkins', label: 'Jenkins', icon: 'terminal' },
];

/** 根据 MC 版本推导建议的 Java 版本（≤1.16.5→8，1.17-1.20.4→17，1.20.5+→21） */
export function suggestJavaVersion(mcVersion: string): number {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(mcVersion);
  if (!match) return 21;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? 0);
  if (major < 1 || (major === 1 && minor < 17)) return 8;
  if (major === 1 && minor >= 17 && (minor < 20 || (minor === 20 && patch <= 4))) return 17;
  return 21;
}

/** 生成 GitHub Actions 工作流 YAML */
function generateGithubWorkflow(opts: {
  javaVersion: number;
  loader: string;
  mcVersion: string;
}): string {
  return `name: Build Mod

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    strategy:
      matrix:
        java: [${opts.javaVersion}]

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Java \${{ matrix.java }}
        uses: actions/setup-java@v4
        with:
          java-version: \${{ matrix.java }}
          distribution: temurin
          cache: gradle

      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v4

      - name: Grant execute permission for gradlew
        run: chmod +x gradlew

      - name: Build with Gradle
        run: ./gradlew build compileJava --stacktrace
        env:
          LOADER: ${opts.loader}
          MC_VERSION: ${opts.mcVersion}

      - name: Run Tests
        run: ./gradlew test

      - name: Upload Artifacts
        uses: actions/upload-artifact@v4
        if: success()
        with:
          name: mod-artifacts
          path: build/libs/*.jar
`;
}

/** 生成 GitLab CI YAML */
function generateGitlabCi(opts: { javaVersion: number }): string {
  return `image: eclipse-temurin:${opts.javaVersion}-jdk

stages:
  - build
  - test

build:
  stage: build
  script:
    - ./gradlew build
  artifacts:
    paths:
      - build/libs/*.jar
    expire_in: 1 week

test:
  stage: test
  script:
    - ./gradlew test
`;
}

/** 生成 Jenkinsfile */
function generateJenkinsfile(opts: { javaVersion: number }): string {
  return `pipeline {
    agent any

    tools {
        jdk "JDK_${opts.javaVersion}"
    }

    stages {
        stage('Build') {
            steps {
                sh './gradlew build'
            }
            post {
                success {
                    archiveArtifacts artifacts: 'build/libs/*.jar', fingerprint: true
                }
            }
        }
        stage('Test') {
            steps {
                sh './gradlew test'
            }
        }
    }
}
`;
}

/**
 * CI/CD 脚本生成面板：生成 GitHub Actions / GitLab CI / Jenkinsfile。
 */
export function CiCdPanel() {
  const storeLoader = useModStore((s) => s.loader);
  const storeMcVersion = useModStore((s) => s.mcVersion);
  const [platform, setPlatform] = useState<CiPlatform>('github');
  const [javaVersion, setJavaVersion] = useState(() => suggestJavaVersion(storeMcVersion));
  const [loader, setLoader] = useState<string>(storeLoader);
  const [mcVersion, setMcVersion] = useState<string>(storeMcVersion);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const suggestedJava = suggestJavaVersion(mcVersion);

  const output = (() => {
    switch (platform) {
      case 'github':
        return generateGithubWorkflow({ javaVersion, loader, mcVersion });
      case 'gitlab':
        return generateGitlabCi({ javaVersion });
      case 'jenkins':
        return generateJenkinsfile({ javaVersion });
    }
  })();

  const fileName = (() => {
    switch (platform) {
      case 'github':
        return '.github/workflows/build.yml';
      case 'gitlab':
        return '.gitlab-ci.yml';
      case 'jenkins':
        return 'Jenkinsfile';
    }
  })();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSavedPath(null);
    try {
      const res = await ipcClient.saveFile({ path: fileName, content: output });
      if (res.ok) setSavedPath(res.savedPath ?? fileName);
      else if (!res.canceled) setSaveError('保存失败，请重试');
    } catch {
      setSaveError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-mc-surface">
      {/* 标题 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <McIcon scope="pixel" name="terminal" size={14} className="text-mc-accent" />
        <span className="text-xs font-medium text-mc-text">CI/CD 脚本生成</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* 平台选择 */}
        <div className="mb-3">
          <div className="mb-1 text-[11px] text-mc-dim">CI 平台</div>
          <div className="flex gap-1">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id)}
                className={`flex items-center gap-1 rounded-mc px-2 py-1 text-xs transition-colors ${
                  platform === p.id
                    ? 'bg-mc-accent text-white'
                    : 'border border-mc-border bg-mc-surface-2 text-mc-dim hover:bg-mc-surface-3 hover:text-mc-text'
                }`}
              >
                <McIcon scope="pixel" name={p.icon} size={10} />
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* 参数 */}
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div>
            <label className="mb-0.5 block text-[10px] text-mc-mute">Java 版本</label>
            <select
              value={javaVersion}
              onChange={(e) => setJavaVersion(Number(e.target.value))}
              className="w-full rounded-mc border border-mc-border bg-mc-surface-2 px-1 py-0.5 text-[11px] text-mc-text outline-none"
            >
              {[8, 11, 17, 21].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            {suggestedJava !== javaVersion && (
              <button
                onClick={() => setJavaVersion(suggestedJava)}
                className="mt-0.5 text-[9px] text-mc-accent hover:underline"
              >
                采用建议 {suggestedJava}
              </button>
            )}
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] text-mc-mute">Loader</label>
            <select
              value={loader}
              onChange={(e) => setLoader(e.target.value)}
              className="w-full rounded-mc border border-mc-border bg-mc-surface-2 px-1 py-0.5 text-[11px] text-mc-text outline-none"
            >
              {['fabric', 'forge', 'neoforge', 'quilt'].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] text-mc-mute">MC 版本</label>
            <input
              value={mcVersion}
              onChange={(e) => setMcVersion(e.target.value)}
              className="w-full rounded-mc border border-mc-border bg-mc-surface-2 px-1 py-0.5 text-[11px] text-mc-text outline-none"
            />
          </div>
        </div>

        {/* 输出文件名 */}
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] font-mono text-mc-dim">{fileName}</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 rounded-mc px-1.5 py-0.5 text-[10px] text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {saving ? '保存中…' : savedPath ? '已保存' : '保存文件'}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-mc px-1.5 py-0.5 text-[10px] text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
          >
            {copied ? (
              <CheckCircle2 className="h-3 w-3 text-green-400" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? '已复制' : '复制'}
          </button>
        </div>

        {savedPath && <div className="mb-1 text-[10px] text-green-400">已保存至 {savedPath}</div>}
        {saveError && (
          <div className="mb-1 flex items-center gap-1 text-[10px] text-red-400">
            <AlertTriangle className="h-3 w-3" /> {saveError}
          </div>
        )}

        {/* 输出代码 */}
        <pre className="max-h-80 overflow-auto rounded-mc border border-mc-border bg-mc-bg p-2 font-mono text-[10px] text-mc-text">
          {output}
        </pre>
      </div>
    </div>
  );
}
