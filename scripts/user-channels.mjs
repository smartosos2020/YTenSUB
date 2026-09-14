/**
 * 用户自定义频道合并（C1 管线侧）：
 * 付费用户在 App 提交的频道经服务端审核（approved）后存 KV，
 * 管线每次运行时拉取并转成种子条目格式，与 scripts/seed-channels.json 的种子一起采集。
 *
 * 被 content-pipeline.mjs 引用；独立成模块便于小脚本干跑验证。
 */

/** 拉取已通过审核的用户频道 → [{handle, submittedBy, submittedAt, status}] */
export async function fetchApprovedUserChannels(apiUrl, adminToken, fetchFn = fetch) {
  const base = apiUrl.replace(/\/+$/, '')
  const r = await fetchFn(`${base}/admin/channels?status=approved`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  })
  if (!r.ok) throw new Error(`admin/channels HTTP ${r.status}`)
  const data = await r.json()
  return Array.isArray(data.channels) ? data.channels : []
}

/**
 * 用户频道 → 种子条目（{name, handle, topic, channelId?}），并去重（撞种子/撞本批的跳过）。
 * handle 是 UC 开头即为 channelId，直接带上跳过解析；@handle 交给管线正常解析。
 */
export function userChannelsToSeeds(channels, existingSeeds) {
  const knownHandles = new Set(existingSeeds.map((s) => String(s.handle ?? '').toLowerCase()))
  const knownIds = new Set(existingSeeds.map((s) => s.channelId).filter(Boolean))
  const out = []
  const seen = new Set()
  for (const c of channels) {
    const handle = String(c?.handle ?? '').trim()
    if (!handle) continue
    const key = handle.toLowerCase()
    if (seen.has(key) || knownHandles.has(key) || knownIds.has(handle)) continue
    seen.add(key)
    const seed = { name: handle, handle, topic: '用户订阅' }
    if (handle.startsWith('UC')) seed.channelId = handle
    out.push(seed)
  }
  return out
}
