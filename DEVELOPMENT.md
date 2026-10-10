# 维护说明

这个仓库生成 KLucen 的 GitHub Profile 数据面板。`README.md`、`assets/*-light.svg`、`assets/*-dark.svg` 是生成文件；修改文案与组合布局时修改 `scripts/render.mjs`，统计图在 `scripts/cards.mjs`，导航与语言入口在 `scripts/links.mjs`，有限循环动效在 `scripts/motion.mjs`，文章卡片在 `scripts/articles.mjs`。下一次更新会重新生成 README。`data/stats.json` 和 `data/blog.json` 保留面板对应的数据快照。

## 本地更新

需要 Node.js 22 或更新版本。

```sh
npm ci
npm test
npm run update
```

`npm run update` 依次采集 GitHub、博客 RSS，再生成浅色和深色 SVG 卡片与 README。已有数据只需重新渲染时运行 `npm run render`；此命令使用当前 JSON 快照，不会请求新的统计数据。可在支持 SVG 的浏览器中直接打开生成的卡片；Profile 的 `<picture>` 元素按 GitHub 主题选择浅色或深色版本。

本地可通过进程环境变量 `GITHUB_TOKEN` 提供 GitHub 令牌。未提供时，采集器可在内存中使用已配置的 Git HTTPS 凭据；令牌不写入文件，不传入命令行参数，不输出日志。无可用令牌时使用公开 REST API 的降级口径。不要把令牌写入代码、JSON、README 或 Git。

## 跳转与动效

GitHub README 不运行 JavaScript。导航、统计、语言筛选和文章卡片通过外层链接跳转；图标来自固定版本的 Lucide，图片内嵌图标路径与许可证，不请求第三方资源。语言按钮按仓库主要语言筛选，和按所有仓库代码字节汇总的环形图口径不同。

状态点只表示每日更新机制，不代表用户在线。状态点呼吸播放两轮，每轮 4 秒；贡献轨迹按真实日历汇总为 UTC 周节点，装饰像素巡游播放两轮，每轮 20 秒。统计数字和数据节点保持静止。SVG 内支持减少动效，README 的 picture 也优先为系统减少动效模式选择静态变体。

## 统计定义

- 仓库、Stars 与语言统计只包含 `KLucen` 自有的公开非 fork 仓库；归档仓库也包含在内。Followers 来自公开用户信息，`totalPublicRepos` 可额外记录包含 fork 的公开仓库总数。
- Commit 卡使用 GitHub GraphQL 的 Commit 贡献记录，并过滤到自有公开非 fork 仓库。它遵循 GitHub 的贡献资格规则，例如 GitHub 识别的作者身份、默认分支或符合规则的 `gh-pages` 分支；因此不是所有分支 `git log` 的 Commit 总数。
- 日历由公开仓库的 Commit、Issue、Pull Request、Review 和建仓贡献节点重建。统计范围是自有公开非 fork 仓库，包含归档仓库；它不同于 GitHub 用户主页的全部贡献，也不会展示私有贡献或外部仓库贡献。
- 日期统一使用 UTC，覆盖截止采集时刻的 365 个 UTC 日期。北京时间凌晨附近的活动可能落在前一个 UTC 日期；数据中的 `from`、`to` 标明实际时间范围。
- 语言占比来自 GitHub Linguist 的代码字节数，按仓库字节合计计算。它不代表使用时间、Commit 数或个人熟练度。历史静态网站的 HTML 也按真实字节参与统计。
- 无 GraphQL 时，REST 降级只统计自有公开非 fork 仓库当前默认分支中 GitHub 识别为该用户 authored 的 Commit，按 committer 时间筛选并统一到 UTC 日期，日历也只表示这些 Commit。`commits.metric` 与 `contributions.kind` 标明降级口径，不能与 GraphQL 贡献数混用。
- 博客面板读取公开 `https://www.klucen.cn/rss.xml`。RSS 条目数表示当前 feed 包含的条目数量，不宣称是全部文章数；最近文章按 RSS 发布日期排序。

GitHub 数据的 `collection` 记录完整性、错误和缓存来源。无法确认的值保存为 `null` 并写明 `sourceReason`，不会用 `0` 或推测值替代。任一仓库语言数据缺失时不生成伪完整的语言占比。REST 缓存保留原采集时间，并标明是否过期。博客 RSS 暂时不可用时可保留最后有效快照及原时间，没有有效快照则保存缺失状态。

## 自动更新

`.github/workflows/update-profile.yml` 每天北京时间 09:17（UTC 01:17）运行，也支持 Actions 页面手动运行。定时任务可能因 GitHub 负载延后，不保证精确到分钟；GitHub 定时任务只在默认分支执行。工作流不监听 `push`，自动提交不会触发更新循环。

工作流使用 Node.js 22，依次执行 `npm ci`、`npm test`、`npm run update`，由 `secrets.GITHUB_TOKEN` 提供令牌，权限为 `contents: write`。GitHub 数据采集强制 `PROFILE_REQUIRE_COMPLETE=1` 和 `PROFILE_REQUIRE_GRAPHQL=1`，采集或渲染失败则不提交。令牌用于读取 GitHub API 与提交这个公开 Profile 仓库；输出仍会过滤私有数据。

更新成功后，仅暂存 README、浅色和深色 SVG 面板、两个数据 JSON；不会把本地预览、缓存或其他临时文件纳入自动提交。工作流以 `github-actions[bot]` 提交并推送，没有生成文件变更时直接结束。Actions 依赖固定为经过官方 API 核实的完整提交 SHA；升级时重新验证版本指向，再更新工作流。

公开仓库连续 60 天没有仓库活动时，GitHub 可能自动停用定时工作流。遇到面板长时间未更新，先查看 Actions 中是否禁用或失败，再启用工作流或手动运行。仓库写权限、分支保护或 API 限制导致失败时，查看日志中的实际错误后修复；不要删除失败检查来掩盖数据缺失。
