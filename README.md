# 纯电汽车电耗统计 · Cloudflare Pages

保留 B20261001 Excel 版统计口径的多用户网页应用。支持 Cloudflare 免费计划，不设 500 条或其他固定记录数量上限。数据分块保存，实际容量受浏览器内存、Cloudflare 存储、每日操作额度及请求大小限制。

## 功能

- 用户名、密码、一次性邀请码注册；用户名规范化后不区分大小写。错误、过期、已使用的邀请码均提示“邀请码已失效”。
- 支持手机浏览器：充电记录在小屏幕上显示为编辑卡片，输入字号避免 iOS 自动缩放；统计表支持横向滑动，图表自适应屏幕，操作按钮适合触屏。
- 录入时保留输入框，Tab / Shift+Tab 可连续切换字段。未修改或改回已保存值时“保存修改”按钮灰化；有修改时在按钮下方显示红色提示。
- 每个账户一份车辆资料和充电记录；电池容量、标称续航、备注及分期设置独立保存。
- 两套总览口径、月度/季度/年度分期与四张趋势图；空值不画成 0。
- 分期统计通过带刻度的双滑块选择跨年的开始、结束月份，也可精确选择月份；提供最近 12 个月、今年、全部记录。默认显示全部记录的月份范围，无记录时显示当月。
- 四张图共用月份范围，横轴随范围调整，纵轴按各自选中数据自动缩放；手机图表适应屏幕，无独立滑块和横向滚动条。点选数据点查看完整期间和数值。
- 充电记录可按序号正序或倒序显示，默认倒序；仅改变浏览顺序。新增记录自动切换所在页、滚动定位并聚焦日期框。
- 浏览器 JSON 导入导出，兼容 Excel `ev-consumption-inputs` 格式版本 1；网页导出版本 2，允许超过 500 条。旧 Windows 导入工具仍限制 500 条，不能接收超容量网页备份。
- 未完成、异常、零值、数字文本和原空行位置可迁移。导入不自动修正业务输入，异常仍按原规则显示并阻止统计。
- 普通页面不展示管理员入口，也不自动跳转管理页。管理员直接访问 `/admin`；页面只有两个业务功能：输入 N 生成邀请码；展示邀请码、关联用户名、用户累计 KV 写入次数并删除用户。
- 删除账户立即阻止已有登录凭证访问，再分批清理 KV 数据；失败可继续删除。删除后的邀请码不会重新有效。

## 统计规则

1. 充满是达到 100%，达到日常 80% 上限应填“否”。
2. 充满区间合计两次充满间所有充电，不计起点，计入终点；未结束区间不计入。
3. 全部累计以首次充电结束为基准，从第 2 条计电、计费；首尾剩余电量差导致误差。
4. 分期电量、支出按充电日期归属，含首条基准充电；区间电耗、达成率按完整区间结束日期归属。
5. 汇总电耗是总电量 / 总里程 × 100，不能平均区间电耗。跨月区间不是精确自然月电耗。
6. 购电口径包括充电损耗和停车耗电；等效满电续航与达成率均为估算。
7. 连续录入、日期与累计里程不倒退。同一天允许多条，按记录序号计算；累计里程可以相同但不能减少。日期先后仅比较年月日，忽略 Excel 导入日期的隐藏时间。免费金额 0 有效，充电量必须大于 0；无数据和真实零值区分。
8. 分期范围包含选定的开始和结束月份。不完整的季度、年度只汇总所选月份，并标注月份范围；完整充满区间仍按结束日期归属，起点在筛选范围外也不会漏算。范围选择只在当前页面使用，不写入 KV；原备份的 `view.year` 字段继续兼容，原统计口径和数据保持不变。

## 架构与免费额度

```text
浏览器（输入、统计计算、图表、JSON）
  → Pages Functions /api/*
  → SQLite 型 Durable Object（注册、权限、版本、计数、保存协调）
  → Workers KV（管理员密码配置、邀请码配置、用户账户、记录分块、数据清单）
```

Pages 不能定义 Durable Object 类，因此先部署一个后台 Worker，再由 Pages 的 Durable Object 绑定访问。后台关闭 `workers.dev` 且不设置公网路由。

使用免费计划可用的 **SQLite 型 Durable Objects**（`new_sqlite_classes`），不是付费专属的旧 KV 存储后端，也不需要 D1、R2 或付费 Workers。密码使用 PBKDF2-SHA256（600,000 次），发生在 Durable Object 内；原生 Web Crypto 拒绝高迭代次数时，使用 `@noble/hashes` 计算完全相同的哈希，已有管理员和用户密码配置无需迁移。Pages Functions 只转发，避免把密码处理放在普通免费 Function 的 10ms CPU 预算里。仍须在正式部署后用真实环境验证耗时和额度。

### 管理员登录提示后台不可用

线上运行时可能限制原生 PBKDF2 迭代次数，本地 Miniflare 不一定复现。修复版本已提供同算法兼容实现。已有部署更新时运行 `npm ci`、`npm run deploy:backend` 即可，无需清空 KV、重建 Durable Object 或重新生成管理员密码配置。

`SESSION_SECRET` 必须是至少 32 字符的随机密钥；过短时会返回明确配置提示。用 `npx wrangler secret put SESSION_SECRET --config worker/wrangler.jsonc` 更新。更换密钥会使旧登录会话失效，需要重新登录。不要把密钥或密码贴到聊天、README 或 Git 中；已公开的凭证应更换。

核对日期：2026-10-01。额度按账户共享，可能调整，部署前核对官方文档：

| 资源 | 免费额度 |
| --- | --- |
| Pages 静态请求 | 免费；只有 `/api/*` 触发 Functions |
| Pages Functions 与普通 Workers 请求 | 合计 100,000 次/天 |
| Workers KV | 读取 100,000、写入 1,000、删除 1,000、list 1,000 次/天；存储 1GB |
| SQLite 型 Durable Objects | 请求 100,000 次/天，执行时长 13,000 GB-s/天 |
| Durable Objects SQLite | 读取 500 万行、写入 10 万行/天；总存储 5GB |

官方来源：[Pages Functions](https://developers.cloudflare.com/pages/functions/pricing/)、[KV](https://developers.cloudflare.com/kv/platform/pricing/)、[Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)。免费额度耗尽会导致失败，不自动升级；每日额度在 UTC 00:00（北京时间 08:00）重置。

### 存储、并发与计数

- 每块通常最多 256 条，按 UTF-8 大小进一步分块。256 是分块大小，不是账户记录上限；单条记录需小于 120KB。
- 未变化的块复用；新块使用不可变键。最后一次保存清单写入成功后，Durable Object 原子切换版本。上传失败不会把旧版本替换成半份数据。
- 页面先读取清单，再逐块读取。KV 暂不可见时提示同步错误，不把缺失块当成空数据。
- 修改必须带加载时的版本号；其他窗口更新后返回 409，用户可先导出本地修改，再重新加载。
- 用户业务数据写入 KV；Durable Object 也保存密码验证副本、清单副本、版本、用户名唯一索引、邀请码使用状态和写入计数，保证权限与并发不依赖 KV 的最终一致性。**备份与恢复必须同时保留 KV 和 Durable Objects，单独恢复 KV 不能重建完整账户状态。**
- 写入次数是应用累计成功确认的用户 KV `put`：注册账户、记录块、保存清单。读取、计算、DO 状态、生成邀请码和删除不计入用户写入。保存清单通常增加 1 次，变化块每块增加 1 次；导入前备份复用旧块。
- 跨 KV 与 DO 没有分布式事务。如果进程在 KV 已写入、确认计数未提交时崩溃，计数可能少记；这是应用统计，不是 Cloudflare 账单计量。写入前登记键，以便删除时清理已登记的半途上传。
- 暂保留最近一份导入前备份；每次成功保存后最多清理 10 个过时键，保留当前版本和备份所需的块。清理失败不撤销已完成保存，下次保存继续；删除会清理包括未提交块在内的所有已登记键。
- 邀请码成功注册后由 DO 永久标记已使用，KV 的配置即使未及时传播也不能再次注册。注册上传失败时保留同账号的注册预留，同用户名和密码可重试完成。
- 登录凭证为一天有效的 HttpOnly、SameSite=Strict Cookie，HTTPS 下启用 Secure。所有写接口验证 Origin；账户停用与删除每次请求检查。
- 每个 IP 在 15 分钟内最多 10 次注册/登录尝试；不要在共享出口下反复测试正式账户。没有邮件验证、自助密码重置或多车辆功能。

## 本地运行与测试

需要 Node.js 24 和 npm；不需要 Excel 或 Cloudflare 登录即可运行网站与集成测试。

```powershell
npm ci
npm run dev
```

打开 `http://127.0.0.1:8788`；管理员入口 `/admin.html`。首次本地管理员密码为 `local-admin-password`，仅写入 `.wrangler/local` 的本地 KV，正式部署不会创建默认密码。本地测试状态持久化在 `.wrangler/local`，与云端无关。

```powershell
npm test
npm run build
```

测试从 `test` 目录执行，包括统计边界、超过 500 条、旧 JSON，以及 Miniflare 中真实本地 KV / SQLite Durable Objects 的注册并发、跨用户隔离、版本冲突、备份恢复、持久化重启、删除和故障注入。故障注入只存在于测试 Worker，不会进入部署代码。测试不能证明线上免费额度无限可用。

Windows 已安装 Microsoft Excel 且保留原 `outputs/ev-consumption/纯电汽车电耗统计_B20261001.xlsx` 时，可另运行 `npm run test:excel`：在副本中执行 30 组原生 Excel 对照，不修改原工作簿。GitHub CI 不运行此可选检查。

## 部署到 Cloudflare 免费计划

### 1. 准备 GitHub

本项目是独立 Git 仓库，默认分支 `dev`。推送目标 URL 确定后：

```powershell
git remote add origin https://github.com/flnlx/ev-consumption.git
git push -u origin dev
```

GitHub Actions 只执行检查，不自动部署。不要提交 API Token、`.dev.vars`、管理员配置文件或真实用户备份；这些文件已加入 `.gitignore`。`outputs/` 和 `.artifact/` 是原 Excel 产物及本地验证资料，不发布到 Pages，不提交到新仓库。

### 2. 创建 KV，部署后台 Worker

```powershell
npx wrangler login
npx wrangler kv namespace create DATA --config worker/wrangler.jsonc
```

将返回的 namespace ID 填入 `worker/wrangler.jsonc` 的 `kv_namespaces[0].id`，替换 `REPLACE_WITH_KV_NAMESPACE_ID`。ID 不是秘密，可以提交；其他实际密码和 Token 不要提交。

```powershell
npm run deploy:backend
npx wrangler secret put SESSION_SECRET --config worker/wrangler.jsonc
```

按提示填入至少 32 字符的随机秘密，例如用密码管理器生成 64 字符。该秘密只存后台 Worker Secret，不是管理员登录密码。生产后台名称须保持 `ev-consumption-backend`；改名时同步修改根目录 `wrangler.jsonc` 的 `script_name`。

### 3. 在 KV 配置管理员密码

```powershell
npm run admin:config
```

在终端隐蔽输入 12–128 字符的管理员密码，脚本生成 `admin-config.json`，内容为盐和哈希，不包含明文密码。

在 Cloudflare 控制台 → Storage & databases → KV → 刚创建的命名空间中设置：

- Key：`config:admin`
- Value：`admin-config.json` 的完整 JSON 内容

也可上传文件：

```powershell
npx wrangler kv key put config:admin --binding DATA --path admin-config.json --remote --config worker/wrangler.jsonc
```

修改密码时重新生成并替换该键；旧管理员会话在新配置传播后失效。KV 最终一致，配置更新后可能需等待 60 秒或更久。页面不提供密码修改功能。

### 4. 部署 Pages

可选择 GitHub 集成或命令行。后台 Worker 必须先部署完成。

**GitHub 集成：** Cloudflare 控制台创建 Pages 项目，连接本仓库，配置：

- 生产分支：`dev`
- 框架：None
- 构建命令：`npm run build`
- 输出目录：`dist`
- 根目录：仓库根目录
- 环境变量：`NODE_VERSION=24`

根目录 `wrangler.jsonc` 声明 `STATE` 绑定到后台 Worker 的 `Coordinator` 类，保持项目名 `ev-consumption`。预览环境显式取消正式数据绑定；若运行环境提供分支信息，非 `dev` 分支也会被接口拒绝，以免预览代码修改正式数据。

**命令行：**

```powershell
npx wrangler pages project create ev-consumption --production-branch dev
npm run deploy:pages
```

随后访问 Pages 地址，打开 `/admin.html`，登录管理员，输入 N 生成邀请码。每个邀请码只供一名用户成功注册一次；N 较大时自动每批 20 个生成，生成中额度耗尽可用原 N 重试，已完成批次保留。

### 5. 线上验收

用两个浏览器窗口测试：管理员生成邀请码 → 注册 → 同码再次注册显示失效 → 录入保存 → 刷新读取 → 管理页观察写入数 → 导入/恢复 → 删除用户 → 旧登录会话不可再读数据。再测试手机访问及多窗口保存冲突。

本地验证不等于线上已部署。生产需要你的 Cloudflare 账户、KV ID 和上述绑定配置；本仓库没有任何生产凭据。

## 维护

- 定期下载 JSON 备份。只在管理员操作需要时生成邀请码，避免浪费每天 1,000 次 KV 写入。
- 普通保存不会按键自动写入。大数据首次上传会按分块消耗多次写入，不保证任意规模能在一天内完成。
- 用户删除会分批清理所有已登记用户 KV 键；每日删除额度不足时账户仍停用，次日继续删除。
- 邀请使用记录、用户名索引等在 Durable Object 内；不要清空 DO 状态或改变固定对象名称 `ev-consumption-v1`，否则破坏邀请码和账户一致性。
- 正式数据与本地数据隔离。若需要预览环境写数据，应另建完整 KV、后台 Worker 和 Pages 项目，不能共用正式绑定。

## 目录

```text
public/          网页、计算与 JSON 数据模块
functions/       Pages API 转发入口
worker/          免费 SQLite Durable Object 后台
scripts/         构建、本地运行、管理员密码配置工具
test/            算法与实际 Cloudflare 本地运行环境测试
.github/         GitHub 自动检查
```
