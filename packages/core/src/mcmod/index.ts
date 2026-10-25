/**
 * MC百科（mcmod.cn）的名字查询。
 *
 * 只做「中文词 → 英文项目名」这一件事：它不托管任何 mod 文件
 * （实测词条页 `.jar` 出现 0 次，外链全指向 Modrinth / CurseForge / GitHub），
 * 拿它下 mod 走不通；它唯一独有而又对得上是**中文名**。
 */
export type { McmodAlias } from './alias.js';
export {
  parseMcmodAliasPage,
  searchMcmodAliases,
  pickEnglishNames,
  mcmodEntryUrl,
  McmodRateLimitError,
} from './alias.js';
