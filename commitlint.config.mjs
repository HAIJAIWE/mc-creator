// Commitlint 配置：Conventional Commits 规范
// https://commitlint.js.org/reference/configuration.html
export default {
  extends: ['@commitlint/config-conventional'],
  // 项目实际使用的 scope 列表（不在列表内的 scope 会被警告）
  // 注：scope 可选，未填 scope 的 commit（如 docs:）也通过
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    // subject 不超过 100 字符（GitHub 默认 72，这里宽松一点支持中文）
    'subject-max-length': [2, 'always', 100],
    'subject-min-length': [2, 'always', 5],
    // body 每行不超过 200 字符
    'body-max-line-length': [1, 'always', 200],
    // footer 每行不超过 200 字符
    'footer-max-line-length': [1, 'always', 200],
  },
};
