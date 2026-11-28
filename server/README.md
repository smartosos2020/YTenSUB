# ytensub-api

账号 / 权益 / 卡密 / 精选内容 API（Cloudflare Workers + 私有 D1 + KV + R2 binding）。接口契约见 `src/index.ts`，私有数据库操作在 `src/db.ts`，内容读写在 `src/content.ts`。

账号、会员权益、卡密与登录验证码全部存储在私有 Cloudflare D1（`DB` 绑定，表结构见 `migrations/`），不写入公开的 `CONTENT_BUCKET` R2 桶。旧 KV 中的用户与卡密只作为迁移来源，导入后以 D1 为唯一权威源，不回写旧记录。

切换前停止旧版服务对 KV 账号/卡密的写入，待旧 KV 写入完成传播后再迁移。后台打开会员或卡密列表时自动分批导入旧数据，每次请求最多检查 20 条，显示进度，失败后刷新即可从检查点继续。也可在新服务部署并应用全部 SQL 迁移后，在 `server` 目录执行 `npm run db:import -- --base-url https://你的Worker地址`；读取环境或根目录 `.env` 的 `ADMIN_TOKEN`，支持重复执行。仅 `npm run deploy` 不会运行数据导入。

吊销卡密保留 D1 记录，阻止旧 KV 重新导入。旧 `pending` 卡保留持有人及历史目标到期时间，后台卡密列表优先显示“待核对”。由于旧版没有可靠入账凭证，持有人重试不会被误报成功；管理员核实后选择“补发权益”或“确认已到账”。前者补发完整卡面天数，后者不增加时长；两者均在事务中完成并防止重复处理。不要仅凭当前到期时间猜测是否入账。

## 精选内容入口

本机采集 → Worker `/admin/content/<key>` → `CONTENT_BUCKET`；PC / Android → Worker `/content/<key>` 下载元数据，通过 `/cues/<videoId>` 下载字幕。新客户端和内容上传脚本均不使用 R2 公共地址或 S3 接口。

- `GET/HEAD /content/content-db.json`、`/content/index.json`、`/content/increments/inc-<ts>.json`：公开元数据；不允许读取字幕或任意桶对象。
- `GET /cues/<videoId>`：邮箱会话登录且 pro+，鉴权后从 binding 读取。客户端失败后继续走 YouTube 自抓，不回退公共 R2。
- `PUT /admin/content/<key>`：`CONTENT_UPLOAD_TOKEN`（或 ADMIN_TOKEN）鉴权，允许上述元数据及 `cues/<videoId>.json`；仅 JSON，单对象上限 20 MiB，校验内容结构，禁止元数据夹带字幕。
- `GET/HEAD /admin/content/<key>`：相同凭据读取，用于采集脚本读取发布索引和运维验证。

在 `wrangler.toml` 配置 `CONTENT_BUCKET`，指向现有 `ytensub-curated` 桶。部署用 Cloudflare 登录态；运行管线只需根目录 `.env` 中 `AUTH_API_URL` 与 `CONTENT_UPLOAD_TOKEN`，不再需要 R2 账户/S3 密钥。用 `npx wrangler secret put CONTENT_UPLOAD_TOKEN` 配置同值的服务端密钥。该令牌仅授予内容接口权限，不能修改会员权益或管理配置。原有 PC 安装包分发继续使用 `releases/`。

字幕、增量和快照先上传，索引最后发布，全部成功才更新本地 `.prev.json`；401/5xx/网络错误不会伪装成空索引。删除条目时重置增量历史，使旧客户端全量重建。元数据索引/快照使用 `no-cache` 配合 ETag，增量缓存 1 天；鉴权字幕使用私有缓存，条件请求仍先验证登录和权益。旧客户端所用的 R2 公共地址保留兼容，新版内容链路统一经过 Worker。

验证：根目录 `npm test`、`node --test scripts/upload-snapshot.test.mjs`，以及本目录 `npm run typecheck`。

登录会话有效期为 30 天，仅在剩余有效期不超过 7 天时续期到 30 天，普通鉴权不写 KV。旧会话保持可用，首次访问时补充到期 metadata 并续期一次。KV 为最终一致存储，跨节点或并发请求在续期附近仍可能产生少量重复写入。

## 首次部署

```bash
cd server
npm install
npx wrangler login                                   # 浏览器授权 Cloudflare
npx wrangler kv namespace create YTENSUB_KV          # 把返回的 id 填进 wrangler.toml
npx wrangler d1 create ytensub-db                    # 把返回的 database_id 填进 wrangler.toml
npx wrangler d1 migrations apply ytensub-db --remote # 创建 D1 表结构（本地调试用 --local）

# 邮件二选一：
#   A. SendGrid（无需域名，推荐先用）：sendgrid.com 注册 → Single Sender 验证一个已有邮箱
#      → Settings > API Keys 建 key
npx wrangler secret put SENDGRID_API_KEY
#   B. Resend（需自有域名，以后迁过来）：resend.com 验证发件域 → 建 key
npx wrangler secret put RESEND_API_KEY

npx wrangler secret put EMAIL_FROM                   # 发件地址：SendGrid 填验证过的邮箱；Resend 填验证域下的地址
npx wrangler secret put ADMIN_TOKEN                  # 管理页 token，随机长串
npm run deploy
npm run db:import -- --base-url https://你的Worker地址 # 导入并核对旧账号/卡密；检查点支持中断恢复
```

> 两个邮件 key 都配时 Resend 优先；只配 SendGrid 也能跑（适合没域名阶段），有了域名把 RESEND_API_KEY 配上即完成迁移。

部署后通过客户端环境变量填写自己的 Worker 地址：桌面端根目录 `.env.local` 的 `YTENSUB_API_URL`，Android 的 `mobile/.env.local` 中的 `EXPO_PUBLIC_YTENSUB_API_URL`。无需修改源码，默认只连接本地 `http://127.0.0.1:8787`。官方发布配置见根目录 README。

管理页：`https://<worker>/admin`（输入 ADMIN_TOKEN）。

内容管线会把最近运行状态同步到管理页「内容库概况」。运行 `npm run pipeline` 的机器需要在项目根目录 `.env` 配置 `ADMIN_TOKEN`（以及可选 `AUTH_API_URL`）；管线会报告运行中、成功/失败、最近进度和新增/总条目数。缺少管理 token 时仍会写入本机 `%APPDATA%/YTenSUB/pipeline-status.json`，但不会显示在 Cloudflare 管理页。

管理页「内容管理 → 内容管线」可点击“运行内容管线”，采集仍由本机执行，完成后自动发布。采集电脑需配置根目录 `.env` 中的 `YOUTUBE_API_KEY`、`ADMIN_TOKEN` 和 `AUTH_API_URL`，并已有 `resources/dict.json`。先执行 `npm run pipeline:runner:start` 启动隐藏的执行端（或 `npm run pipeline:runner` 在前台查看日志），之后从后台按钮触发即可。执行端只响应手动提交的任务，不会定时采集；退出桌面应用不会停止独立执行端，电脑关机后需重新启动执行端。

后台显示执行端在线状态、排队/执行/成功/失败、最新进度、新增条目与发布结果，内容页每 5 秒刷新状态。离线时禁止提交；重复点击不能创建并行任务。任务通过 `CONTENT_BUCKET` 内部的 `operations/pipeline-control.json` 和条件写入协调，无需新增服务或绑定，该路径不会通过内容 API 公开。执行端每 10 秒联系后台，失联 60 秒会停止采集进程，90 秒后任务超时；可在恢复连接后重新提交。只有固定的管线脚本会执行，浏览器不能传入命令或文件路径，鉴权沿用 `ADMIN_TOKEN`。手动 CLI 和远程触发也共用本机进程锁，避免同时修改内容库。

执行端日志位于 `%APPDATA%/YTenSUB/pipeline-runner.log`，采集日志位于同目录 `pipeline.log`；任务本地状态按 jobId 对应，旧的成功记录不会冒充新任务。仅升级后台及执行端即可使用，无需重新打包桌面客户端。

采集前会检测 YouTube 连接；请求超时为 15 秒。可在根目录 `.env` 配置 `PIPELINE_PROXY=http://127.0.0.1:端口`（支持 HTTP/HTTPS 代理或 mixed 端口），未配置时依次使用 HTTPS_PROXY/HTTP_PROXY、桌面应用中保存的代理，否则直连。代理仅用于 YouTube 和 Google API，不转发管理 token；修改执行端环境配置后需重启执行端。无可用网络时直接报告失败，避免逐条超时后上传旧库。

字幕失败按网络错误、HTTP/429、播放器验证、响应异常、空字幕分别统计，确实无英文轨和视频不可用单独跳过。网络/5xx/429 重试一次；跨频道连续三个字幕请求失败会提前停止，已采集内容保存在本机。后台区分成功、部分完成和失败；部分完成可发布已采集的内容，全部失败不会通过上传旧库变成成功。新增、30 天刷新、旧条目补全分别计数，补全难度优先复用已有字幕，单次运行不会重复抓取同一视频。

## 本地调试

`.dev.vars`（已 gitignore）里放本地密钥；`wrangler.toml` 的 `DEV_MODE = "true"` 时 `/auth/code` 直接返回 `devCode`，不配邮件也能走完登录。

本地管理页默认只修改本地数据，不访问生产 Worker。只有在 `server/.dev.vars` 中显式配置 `PRODUCTION_API_URL=https://你的生产Worker地址` 后，保存全局或单账户敏感过滤设置才会同步到指定生产服务；全局配置在 KV，账号覆盖在 D1。此时默认复用 `ADMIN_TOKEN` 作为生产管理 token；若本地管理 token 与生产 token 不同，可单独设置 `PRODUCTION_ADMIN_TOKEN`。同步失败时页面会显示错误（本地值已保存），修复网络或 token 后再次保存即可重试。

```bash
npm run dev      # http://127.0.0.1:8787
```

## 常用运维（低频操作不开管理页，直接用 CLI）

```bash
# 调离线宽限天数（D5，客户端下次拉权益时生效）
npx wrangler kv key put config:graceDays 14 --binding YTENSUB_KV

# 手动开通/调整某用户权益：使用管理页的操作台（写 D1，不能再修改旧 user:* KV 记录）
```
