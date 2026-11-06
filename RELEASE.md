# 发布清单 · 鲸语 dsh-whale-whispers

写于 2026-11-03 04:05（我自己的时间）。目标：他把 token 给我之后，一条命令就能发出去，不用再想。

## 0. 现在到哪一步了

- 代码、文案、locale、icon、README、LICENSE 都齐了；版本 **1.1.1**（三个工具 + 换行保留 + remove 匹配修复）。
- `pnpm pack` 通过，9 个文件：
  `package.json` / `index.js` / `client.js` / `cordis.patch.yml` / `locale/zh.json` / `locale/en.json` / `icon.svg` / `README.md` / `LICENSE`
- 本机已装（`plugin_manager install_bundle` → `restart-required`），等他重启 DSH 才生效。
- 没做的：npm 上还没有这个包（要 token）、awesome-dsh-plugin 的目录条目还没提（要 GitHub 登录）。

## 1. 发布（需要他的 npm Automation token）

1. 他给 token 后，写一行进 `D:\dsh work\plugin-quotes\.npmrc`：
   ```
   //registry.npmjs.org/:_authToken=npm_XXXX
   ```
2. 跑：
   ```bash
   NODE="D:/deepseek/resources/runtime/primary-runtime/dependencies/node/bin/node.exe"
   PNPM="D:/deepseek/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
   cd "D:/dsh work/plugin-quotes" && "$NODE" "$PNPM" publish --access public
   ```
3. 发完**立刻删掉 `.npmrc`**（token 不留在盘上）。
4. 验证：
   ```bash
   npm view dsh-whale-whispers version dist.tarball
   ```
   再在干净目录 `dsh plugin add dsh-whale-whispers` 装一次，确认从 registry 拿得到、面板能开。

## 2. 上架市场（可选，但要有人能搜到就得做）

`dshmarket` 的目录不来自 npm 搜索，来自两个地方（`C:/Users/杨欣荣/.dsh/profiles/desktop/node_modules/dshmarket/lib/regions.js`）：

- 官方目录 `CATALOG_OFFICIAL='https://awesome-dsh-plugin.com/plugins.json'`（`regions.js:70`）
- 中国区 npm 包 `dsh-plugin-catalog`（`regions.js:87`）

所以要么给 `awesome-dsh-plugin/awesome-dsh-plugin` 提 PR（CI 每日刷新，约一天生效），要么等 `dsh-plugin-catalog` 更新。
条目 schema（照 `index.json` 4281 条里任意一条抄）：

```json
{
  "name": "dsh-whale-whispers",
  "title": "鲸语",
  "description": {
    "zh": "有些话说出口就沉下去了。鲸语把它们捞回来，收进输入框下面的小抽屉。",
    "en": "A drawer for the lines that sank: read a markdown file, keep what is worth keeping."
  },
  "homepage": "https://github.com/<owner>/dsh-whale-whispers",
  "repository": { "url": "https://github.com/<owner>/dsh-whale-whispers" },
  "metadata": { "category": "memory", "keywords": ["quotes", "memory", "notes"], "labels": ["ui"] },
  "versions": [{ "version": "1.1.1", "publishTimestamp": 0, "source": { "type": "npm" } }]
}
```

**前置**：先有 GitHub 仓库（`gh` 现在没登录，`gh auth login` 要他在浏览器点一次）。仓库建好后 `git init` → push → 再提 PR。

## 3. 剩下的技术债（不着急）

- `client.js` 是手写 `__ModuleLoader__.load`，没有构建步骤；DSH 客户端 API 变了要跟着改。
- 工具写入只支持「# 标题 + ## 日期 + - 句子」这一种结构；格式不同的文件会被当成空。
- 没有并发写保护（两个人同时 append 可能丢一条）；目前单人用够。

## 4. 一句话状态

**发得出去，只差 token 和重启。** 上架市场要 GitHub，能等。
