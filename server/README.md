# ytensub-api

账号 / 权益 / 卡密 API（Cloudflare Workers + KV）。接口契约见 `src/index.ts` 头注释，纯逻辑在 `src/logic.ts`（根仓库 `tests/server-logic.test.ts` 覆盖）。

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
