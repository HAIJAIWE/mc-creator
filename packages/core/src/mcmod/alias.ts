/**
 * MC百科（mcmod.cn）的**中文名 ↔ 英文名**查询。
 *
 * ## 为什么只做这一件事
 *
 * MC百科 是「百科」不是下载站：实测词条页里 `.jar` 出现 0 次、下载 URL 0 处，
 * 外部链接全是 `link.mcmod.cn/target/<base64>` 跳转壳，解开后指向
 * CurseForge / Modrinth / GitHub —— **文件一个都不在它那里**。所以拿它下 mod 是
 * 走不通的，PCL 也只拿它当中英文名对照（详情页上「转到 Modrinth」旁边那个
 * 「转到 MC 百科」就是外链）。
 *
 * 而它提供的东西是 Modrinth/CurseForge 都没有的：**中文名**。搜「钠」出
 * Sodium，搜「机械动力」出 Create。PCL 的做法（见其搜索框提示）就是
 * 「搜中文词时，先用 MC百科 查出对应英文项目名，再」去 Modrinth 搜 —— 这样
 * 数据仍然走 Modrinth 的 JSON API（快），中文只是查词时的一次别名解析。
 *
 * ## 实测约束（都是坑）
 *
 * - **没有 JSON API**，只有 `modlist.html?key=…&page=N` 的 HTML。
 * - **限流**：实测连着几个请求就 429。所以调用方必须自己限流/缓存，
 *   这里只负责把 429 说成「被限流」而不是「没找到」。
 * - 搜索是**全文模糊**的：搜「钠」返回 56 条（Sodium / Chlorine / Indium …，
 *   连描述里带「钠」的都算），所以拿到的是**候选**，得由调用方挑。
 * - `ename` 可能是 `&nbsp;`（该条目没有英文名）。
 */

const MODLIST_URL = 'https://www.mcmod.cn/modlist.html';

/** 一条别名候选。 */
export interface McmodAlias {
  /** MC百科 词条 id（用于拼 `https://www.mcmod.cn/class/<id>.html`）。 */
  mcmodId: string;
  /** 中文名（`<p class="name">`）。 */
  cnName: string;
  /** 英文名（`<p class="ename">`）。为空表示这条没有英文名。 */
  enName: string;
  /** 一句话简介（`<div class="intro">` 里的 span）。 */
  summary: string;
}

/** 最小够用的 HTML 实体解码。词条名里常见的就是 `&nbsp;` 和 `&amp;`。 */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)));
}

/** 去掉标签与首尾空白。 */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 解析 `modlist.html` 的一页结果。
 *
 * 纯函数，不碰网络 —— 所以可以为它写精确的单元测试（用实测 HTML 片段），
 * 而不用 mock fetch。这也是把它单独拆出来的主要原因。
 *
 * ⚠️ 这里刻意**不用** DOM 解析器：主进程侧引一个 HTML parser 是为这点事
 * 引重依赖，而页面结构很规整（每条目一个 `modlist-block`）。
 * 代价是页面一改结构就失效 —— 所以解析不出东西时要返回空数组而不是抛，
 * 上层会显示「没查到中文名」而不是崩掉。
 */
export function parseMcmodAliasPage(html: string): McmodAlias[] {
  const out: McmodAlias[] = [];
  // 按条目块切。块内可能出现多个 /class/<id>.html（intro/cover/name/ename 各一个），
  // 所以 id 从块内第一次出现处取。
  const blocks = html.split(/<div class="modlist-block">/).slice(1);
  for (const b of blocks) {
    const idM = /\/class\/(\d+)\.html/.exec(b);
    if (idM === null) continue;
    const nameM = /<p class="name">([\s\S]*?)<\/p>/.exec(b);
    const enM = /<p class="ename">([\s\S]*?)<\/p>/.exec(b);
    const introM = /<div class="intro">[\s\S]*?<span>([\s\S]*?)<\/span>/.exec(b);
    const cnName = nameM ? textOf(nameM[1]!) : '';
    const enName = enM ? textOf(enM[1]!) : '';
    // 中英文都空的是空壳条目，没当别名的价值
    if (cnName === '' && enName === '') continue;
    out.push({
      mcmodId: idM[1]!,
      cnName,
      enName,
      summary: introM ? textOf(introM[1]!) : '',
    });
  }
  return out;
}

export class McmodRateLimitError extends Error {
  constructor() {
    super('MC百科 触发了限流（HTTP 429），稍后再试。');
    this.name = 'McmodRateLimitError';
  }
}

/**
 * 查中文词 → 英文项目名候选。
 *
 * 只取第一页：实测每页约 16 条，而目的是拿英文名去 Modrinth 搜，
 * 第一页通常够用。翻更多页只会更快撞限流。
 */
export async function searchMcmodAliases(key: string): Promise<McmodAlias[]> {
  const q = key.trim();
  if (q === '') return [];
  const url = `${MODLIST_URL}?key=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: {
      // 不给 UA 大概率被当爬虫挡掉。带个像浏览器的值即可，不伪造系统信息。
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 429) throw new McmodRateLimitError();
  if (!res.ok) throw new Error(`MC百科 查询失败: HTTP ${res.status}`);
  return parseMcmodAliasPage(await res.text());
}

/**
 * 从候选里挑出最该拿去找 Modrinth 的英文名。
 *
 * 排序依据（实测得来的）：
 * 1. **中文名完全相等**最可信 —— 搜「钠」时 56 条里只有一条叫「钠」。
 * 2. 其次 `alt="中文 (英文)"` 完全相等的（解析不到的备用判据这里不用）。
 * 3. 英文名非空是硬条件：空英文名没法拿去搜 Modrinth。
 *
 * 返回的是**去重后**的英文名列表（最多 `limit` 个）—— 交给调用方依次试，
 * 比只猜一个更稳（搜「钠」时 Sodium 和它的移植版都合理）。
 */
export function pickEnglishNames(
  aliases: McmodAlias[],
  originalQuery: string,
  limit = 3,
): string[] {
  const q = originalQuery.trim();
  const scored = aliases
    .filter((a) => a.enName !== '')
    .map((a) => {
      let score = 0;
      if (a.cnName === q) score += 100;
      else if (a.cnName.includes(q)) score += 40;
      if (a.enName.toLowerCase().includes(q.toLowerCase())) score += 20;
      // 简介里提到原词的，说明是相关条目而不是本体
      if (a.summary.includes(q)) score += 5;
      return { a, score };
    })
    .sort((x, y) => y.score - x.score);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const { a } of scored) {
    const k = a.enName.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a.enName);
    if (out.length >= limit) break;
  }
  return out;
}

/** 词条页链接（给 UI 做「转到 MC 百科」）。 */
export function mcmodEntryUrl(mcmodId: string): string {
  return `https://www.mcmod.cn/class/${mcmodId}.html`;
}
