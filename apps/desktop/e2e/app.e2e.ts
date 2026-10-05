/**
 * Electron E2E 用例集（设计文档 §15「Vitest 单元 + Playwright E2E」）。
 *
 * ## 定位：这不是「把 vitest 再写一遍」
 *
 * vitest 那 1931 条用例里没有一条真的启动过 Electron。它们 mock 掉 `electron`
 * 模块、mock 掉 `window.mcApi`，所以下面这些**只有真跑才会暴露**的问题一直是绿的：
 *
 * - 主进程产物能不能被 Node 加载（`out/main/index.js` 里的 `require` 能不能解析）；
 * - preload 的 `contextBridge` 在 `sandbox: true` 下能不能真的把 API 送到渲染层；
 * - `IPC → 主进程 → 磁盘` 的往返有没有断；
 * - 启动过程会不会偷偷打外网 / 写真实 userData。
 *
 * 第一条已经抓到东西了：`@mc-creator/shell` 是「TS 源码包」，被 externalize 成
 * 运行时 `require`，结果 Node 找不到 `./errors.js`，**应用启动即崩**。见
 * `electron.vite.config.ts` 里 `workspacePkgs` 的注释。
 *
 * ## 覆盖范围（11 条，少而精）
 *
 * 1. 启动 + 首窗 + 加载的是编译产物（E2E 的地基，挂了后面全没意义）
 * 2. preload 桥真的到位（反向断言「不是 preview:web 的 Proxy 桩」）
 * 3. Dashboard 首屏关键元素
 * 4. UI 新建项目 → 真实 IPC 往返 → 落盘到假实例目录
 * 5. 只读 IPC `process:list`（§7.1 白名单里唯一的只读查询）
 * 6. ActivityBar 切面板（交互）
 * 7. 主题切换真的改了 CSS 变量、computed 颜色并持久化
 * 8. 切颜色模式会换掉主题列表
 * 9. **全程零出站请求 / 零更新器调用 / 零真实 userData 写入**（§15 明文）
 * 10. 数据确实写在临时实例目录里
 * 11. **闸门自检**：主动打一次外网，证明上面那条不是空转通过
 *
 * ## 硬约束
 *
 * - 不断言「应用做了什么」，只断言「应用没做什么不该做的」+ 关键链路通。
 * - 不新增依赖：只用 `@playwright/test`。
 * - 不 skip、不删任何既有 vitest 用例。
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/electron-app.js';

/** 项目名：故意带中文与空格，顺带验证路径/编码在三层（UI→IPC→磁盘）都没被搞坏。 */
const PROJECT_NAME = 'E2E 演示项目';

/** 下界主题的强调色三元组，来自 lib/themes.ts 的 MC_THEMES['nether']。 */
const NETHER_ACCENT = '214 110 71';

/**
 * 从 Dashboard 走真实 UI 建一个项目，落到工作台。
 *
 * 这条路径 = 点按钮 → ProjectCreateDialog → saveProject IPC → project-store 落盘
 * → loadProject IPC → 确保工作区目录 → 切 view。是本文件里覆盖最宽的一段。
 */
async function createProjectFromUi(page: Page): Promise<void> {
  // 注意：Dashboard 的「新建项目」按钮**没有 aria-label**，它的可访问名是
  // 「plus 新建项目」—— McIcon 渲染的是带 aria-label 的 svg(role=img)，
  // 会混进按钮的可访问名里。所以这里用子串匹配，不能用 exact。
  // （活动栏按钮相反：有 aria-label，可访问名就是纯文案，exact 才成立。）
  await page.getByRole('banner').getByRole('button', { name: '新建项目' }).click();
  await expect(page.getByRole('heading', { name: '新建项目' })).toBeVisible();
  await page.getByPlaceholder('输入项目名称（如 My Awesome Mod）').fill(PROJECT_NAME);
  await page.getByRole('button', { name: '创建并打开编辑器' }).click();
  // 落到工作台的判据：活动栏出现（Dashboard 首屏没有它）
  await expect(page.getByRole('toolbar', { name: '活动栏' })).toBeVisible();
}

/** 打开设置面板（工作台 → 活动栏「设置」）。 */
async function openSettings(page: Page): Promise<void> {
  const bar = page.getByRole('toolbar', { name: '活动栏' });
  await bar.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '外观', exact: true })).toBeVisible();
}

test.describe('启动地基', () => {
  test('应用能启动，首个窗口出现且加载的是编译产物', async ({ mcApp }) => {
    const { page } = mcApp;

    await expect(page).toHaveTitle('MC Creator');

    // 必须是 file:// 直读 out/renderer/index.html —— 这正是选 Electron E2E 的前提：
    // 我们测的是编译产物而不是 vite dev server
    const url = decodeURIComponent(page.url());
    expect(url.startsWith('file://')).toBe(true);
    expect(url.replace(/\\/g, '/')).toContain('/apps/desktop/out/renderer/index.html');
  });

  test('preload 桥真的到位（不是 preview:web 的 Proxy 桩）', async ({ mcApp }) => {
    const { page } = mcApp;

    const bridge = await page.evaluate(() => {
      const g = window as unknown as {
        mcApi?: { processList?: unknown; saveProject?: unknown; listProjects?: unknown };
        api?: { nodeGraph?: { save?: unknown } };
        __MC_PREVIEW__?: boolean;
      };
      return {
        hasMcApi: typeof g.mcApi === 'object' && g.mcApi !== null,
        hasProcessList: typeof g.mcApi?.processList === 'function',
        hasSaveProject: typeof g.mcApi?.saveProject === 'function',
        hasNodeGraph: typeof g.api?.nodeGraph?.save === 'function',
        // preview:web 那条路会置这个标记；真 Electron 路径必须是 false
        isPreviewStub: g.__MC_PREVIEW__ === true,
      };
    });

    expect(bridge.hasMcApi).toBe(true);
    expect(bridge.hasProcessList).toBe(true);
    expect(bridge.hasSaveProject).toBe(true);
    expect(bridge.hasNodeGraph).toBe(true);
    // 反向断言：确认我们没在测那条「window.mcApi 是 Proxy 桩」的旁路
    expect(bridge.isPreviewStub).toBe(false);
  });

  test('主界面关键元素可见', async ({ mcApp }) => {
    const { page } = mcApp;

    // 默认首屏是 Dashboard（project-store 的 view 初值）
    await expect(page.getByRole('heading', { level: 1 })).toContainText('MC 创作器');
    await expect(page.getByRole('heading', { name: '选择你要创建的内容类型' })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('button', { name: '新建项目' })).toBeVisible();
    // 内容类型卡片：说明面板注册表 + 懒加载 chunk 都通了
    await expect(page.getByRole('button', { name: /模组/ }).first()).toBeVisible();
  });
});

test.describe('真实 IPC 往返', () => {
  test('通过 UI 新建项目后进入工作台，且项目落在假实例目录里', async ({ mcApp }) => {
    const { page, instanceDir } = mcApp;

    await createProjectFromUi(page);

    // 磁盘侧证据：project-store 写在 <userData>/projects/<id>.json，
    // 而 userData 已被重定向到本用例的临时实例目录
    const projectsDir = join(instanceDir, 'userData', 'projects');
    const files = await readdir(projectsDir);
    expect(files.filter((f) => f.endsWith('.json'))).toHaveLength(1);

    // 顶部工具栏显示的应是刚建的项目名（证明 loadProject 把数据填回了 store）。
    // 工作台的 TopToolbar 是个普通 div（不是 <header>），所以这里不能按 banner 定位
    await expect(page.getByText(PROJECT_NAME, { exact: true }).first()).toBeVisible();
  });

  test('只读 IPC process:list 返回空托管进程表', async ({ mcApp }) => {
    const { page } = mcApp;

    // processList 是 §7.1 白名单里刻意保留的只读查询（渲染层不得直接 spawn 进程）
    const result = await page.evaluate(async () => {
      const res = (await window.mcApi.processList()) as { processes?: unknown[] };
      return { processes: res.processes };
    });

    // 假实例目录里没有真实服务端在跑，托管表必须是空的
    expect(result.processes).toEqual([]);
  });
});

test.describe('交互', () => {
  test('ActivityBar 切换面板会换掉中部主视图', async ({ mcApp }) => {
    const { page } = mcApp;

    await createProjectFromUi(page);

    const bar = page.getByRole('toolbar', { name: '活动栏' });
    const explorer = bar.getByRole('button', { name: '资源管理器', exact: true });
    const git = bar.getByRole('button', { name: '源代码管理', exact: true });

    // 默认激活 explorer：aria-pressed 是活动栏唯一的「当前选中」事实来源
    await expect(explorer).toHaveAttribute('aria-pressed', 'true');

    await git.click();
    await expect(git).toHaveAttribute('aria-pressed', 'true');
    await expect(explorer).toHaveAttribute('aria-pressed', 'false');
    // GitPanel 的懒加载 chunk 挂上来了（它首屏是「选一个仓库」的引导态）
    await expect(page.getByText('选择一个 git 仓库目录以查看状态、提交与同步')).toBeVisible();

    await explorer.click();
    await expect(explorer).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('主题换肤', () => {
  test('切换主题真的改了 CSS 变量、界面颜色并持久化', async ({ mcApp }) => {
    const { page } = mcApp;

    await createProjectFromUi(page);
    await openSettings(page);

    await page.getByRole('button', { name: '外观', exact: true }).click();
    // 主题列表按颜色模式过滤，先钉死成暗色，免得跟随系统的 CI runner
    // 因为 prefers-color-scheme 不同而给出另一套主题列表
    await page.getByRole('button', { name: '暗色', exact: true }).click();

    const readAccent = (): Promise<string> =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--mc-accent').trim());

    // 默认（craft/grass）强调色是草绿，和下界绯红必须不同，否则断言没有分辨力
    const before = await readAccent();
    expect(before).not.toBe(NETHER_ACCENT);

    await page.getByRole('button', { name: '下界 · 绯红', exact: true }).click();

    // ① CSS 变量真的被改写（applyTheme 写 documentElement.style）
    await expect.poll(readAccent).toBe(NETHER_ACCENT);

    // ② 界面真的跟着变：品牌色方块用的是 bg-mc-accent = rgb(var(--mc-accent) / 1)，
    //    所以 computed backgroundColor 必须等于换肤后的三元组 —— 这一条证明
    //    「变量变了」不是自嗨，而是真的传导到了渲染结果
    const stripColor = await page
      .locator('div.bg-mc-accent')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(stripColor).toBe('rgb(214, 110, 71)');

    // ③ 选择被持久化（下次启动首屏不闪回默认）
    const stored = await page.evaluate(() => localStorage.getItem('mc-creator-dark-theme'));
    expect(stored).toBe('nether');
  });

  test('切到亮色模式会换掉主题列表（跟随系统改成显式选择后立即生效）', async ({ mcApp }) => {
    const { page } = mcApp;

    await createProjectFromUi(page);
    await openSettings(page);
    await page.getByRole('button', { name: '外观', exact: true }).click();

    await page.getByRole('button', { name: '暗色', exact: true }).click();
    await expect(page.getByRole('button', { name: '下界 · 绯红', exact: true })).toBeVisible();

    // 亮色模式有独立的一套主题（MC_THEMES 里 mode==='light' 的三套）
    await page.getByRole('button', { name: '亮色', exact: true }).click();
    await expect(page.getByRole('button', { name: '草绿 · 晨光', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '下界 · 绯红', exact: true })).toHaveCount(0);

    // 模式本身也要落盘，否则下次启动又回系统
    expect(await page.evaluate(() => localStorage.getItem('mc-creator-color-mode'))).toBe('light');
  });
});

test.describe('§15 硬约束：E2E 不得触碰真实更新源与外部 API', () => {
  test('全程零出站请求、零更新器调用、零真实 userData 写入', async ({ mcApp }) => {
    const { page } = mcApp;

    // 先跑一遍最重的真实链路：UI 建项目会走 IPC → 主进程 → 磁盘，
    // 如果这条路上偷偷打了外网（Modrinth / CurseForge / Mojang 版本清单等），
    // 这里就是最后一道 catches-all 的断言点
    await createProjectFromUi(page);
    await openSettings(page);
    await page.getByRole('button', { name: '外观', exact: true }).click();
    await page.getByRole('button', { name: '暗色', exact: true }).click();

    const ledger = await mcApp.readLedger();

    // ① 主进程：fetch / net.request / http(s) 三类出口一个都没被触发
    expect(ledger.attempts, `主进程出现出站请求：\n${ledger.attempts.join('\n')}`).toEqual([]);

    // ② 渲染进程：fetch / XHR / WebSocket 同理
    const rendererAttempts = await mcApp.readRendererAttempts();
    expect(rendererAttempts, `渲染进程出现出站请求：\n${rendererAttempts.join('\n')}`).toEqual([]);

    // ③ 更新器：仓库当前没有 electron-updater，所以既不该装、也不该被调用。
    //    这条断言是给「将来有人接上自动更新」埋的雷 —— 接上的那天它会先变红，
    //    逼着接的人先想清楚 E2E 里怎么 mock，而不是让 CI 去拉真实更新包。
    expect(ledger.electronUpdaterResolvable).toBe(false);
    expect(ledger.updaterCalls).toEqual([]);

    // ④ 真实 userData 一个字节都没被写脏
    //    （守卫在重定向之前拍了一张快照，这里和收尾快照逐项比对）
    expect(ledger.realUserDataNow).toEqual(ledger.realUserDataAtStart);
  });

  test('应用把自己的数据写在临时实例目录里，不在真实 userData', async ({ mcApp }) => {
    const { instanceDir } = mcApp;
    const ledger = await mcApp.readLedger();

    // userData 被重定向到 <instanceDir>/userData —— 主进程所有磁盘读写都走
    // app.getPath('userData')，所以这一条等价于「所有写盘都在临时目录里」
    expect(ledger.instanceDir).toBe(instanceDir);
    expect(ledger.realUserData).not.toBe(join(instanceDir, 'userData'));
  });

  /**
   * 闸门自检 —— 这条是上面两条的**前提**。
   *
   * 「全程零出站请求」这种断言有个致命盲区：如果守卫压根没装上（路径写错、
   * patch 时机不对、Electron 版本换了 API），断言会**空转通过**，给出
   * 「网络已经被 mock 住」的假安全感。所以必须有一条用例主动打一次外网，
   * 证明闸门真的会响。
   *
   * 顺带证明 index.html 的 CSP `connect-src` 是放行外网的（`'self' ws: http: https:`），
   * 也就是说**唯一**拦住这些请求的就是 E2E 守卫本身 —— 不是浏览器兜的底。
   */
  test('闸门自检：主动打一次外网，确认渲染层与主进程两侧都会被记账并拒绝', async ({ mcApp }) => {
    const { page } = mcApp;

    // 渲染进程：window.fetch 被 init script 拦下
    const rendererOutcome = await page.evaluate(async () => {
      try {
        await window.fetch('https://api.modrinth.com/v2/search?query=e2e-canary');
        return 'resolved';
      } catch (error) {
        return `rejected: ${(error as Error).message}`;
      }
    });
    expect(rendererOutcome).toContain('rejected');

    // 主进程 fetch（core / VercelAiProvider 这类库的出口）
    const mainFetchOutcome = await mcApp.app.evaluate(async () => {
      try {
        await globalThis.fetch('https://api.curseforge.com/v1/mods/search');
        return 'resolved';
      } catch (error) {
        return `rejected: ${(error as Error).message}`;
      }
    });
    expect(mainFetchOutcome).toContain('rejected');

    // 主进程 net.request（Electron 侧访问外部 API 的正统方式）
    const netOutcome = await mcApp.app.evaluate(
      ({ net }) =>
        new Promise<string>((resolve) => {
          const client = net.request(
            'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json',
          );
          client.on('error', () => resolve('error'));
          client.on('response', () => resolve('response'));
          setTimeout(() => resolve('timeout'), 5_000);
        }),
    );
    // 被 abort 掉 => 只会走 error 分支；绝不能出现 response
    expect(netOutcome).not.toBe('response');

    const ledger = await mcApp.readLedger();
    // 渲染层与主进程是**两本独立的账**（渲染层的在 window 上，主进程的在
    // globalThis 上），所以要分别去对应那本账里查，不能只查主进程那本
    const rendererAttempts = await mcApp.readRendererAttempts();
    expect(rendererAttempts.join('\n')).toContain('api.modrinth.com');
    expect(ledger.attempts.join('\n')).toContain('api.curseforge.com');
    expect(ledger.attempts.join('\n')).toContain('launchermeta.mojang.com');
  });
});
