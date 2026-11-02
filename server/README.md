# ytensub-api

账号 / 权益 / 卡密 / 精选内容 API（Cloudflare Workers + KV + R2 binding）。接口契约见 `src/index.ts`，内容读写在 `src/content.ts`。

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

# 邮件二选一：
#   A. SendGrid（无需域名，推荐先用）：sendgrid.com 注册 → Single Sender 验证一个已有邮箱
#      → Settings > API Keys 建 key
npx wrangler secret put SENDGRID_API_KEY
#   B. Resend（需自有域名，以后迁过来）：resend.com 验证发件域 → 建 key
npx wrangler secret put RESEND_API_KEY

npx wrangler secret put EMAIL_FROM                   # 发件地址：SendGrid 填验证过的邮箱；Resend 填验证域下的地址
npx wrangler secret put ADMIN_TOKEN                  # 管理页 token，随机长串
npm run deploy
```

> 两个邮件 key 都配时 Resend 优先；只配 SendGrid 也能跑（适合没域名阶段），有了域名把 RESEND_API_KEY 配上即完成迁移。

部署后把 Worker 地址填到桌面端 `src/shared/auth-config.ts` 与手机端 `mobile/src/lib/auth.ts`。

管理页：`https://<worker>/admin`（输入 ADMIN_TOKEN）。

内容管线会把最近运行状态同步到管理页「内容库概况」。运行 `npm run pipeline` 的机器需要在项目根目录 `.env` 配置 `ADMIN_TOKEN`（以及可选 `AUTH_API_URL`）；管线会报告运行中、成功/失败、最近进度和新增/总条目数。缺少管理 token 时仍会写入本机 `%APPDATA%/YTenSUB/pipeline-status.json`，但不会显示在 Cloudflare 管理页。

## 本地调试

`.dev.vars`（已 gitignore）里放本地密钥；`wrangler.toml` 的 `DEV_MODE = "true"` 时 `/auth/code` 直接返回 `devCode`，不配邮件也能走完登录。

本地管理页保存全局或单账户敏感过滤设置时，会先写本地 KV，再同步到生产 Worker 的 KV。默认复用 `ADMIN_TOKEN` 作为生产管理 token；若本地管理 token 与生产 token 不同，可在 `.dev.vars` 单独设置 `PRODUCTION_ADMIN_TOKEN`。同步失败时页面会显示错误（本地值已保存），修复网络或 token 后再次保存即可重试。

```bash
npm run dev      # http://127.0.0.1:8787
```

## 常用运维（低频操作不开管理页，直接用 CLI）

```bash
# 调离线宽限天数（D5，客户端下次拉权益时生效）
npx wrangler kv key put config:graceDays 14 --binding YTENSUB_KV

# 手动开通/调整某用户权益
npx wrangler kv key put user:someone@x.com '{"email":"someone@x.com","plan":"pro","expiresAt":1790000000000,"createdAt":1790000000000,"updatedAt":1790000000000}' --binding YTENSUB_KV
```
