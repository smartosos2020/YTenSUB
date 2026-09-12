/**
 * 精选内容快照的公开地址（Cloudflare R2 公共访问域名）。
 * 这是公开只读地址（内容本身是 YouTube 公开视频的元数据），不是密钥，可以直接入库。
 */
export const CURATED_SNAPSHOT_URL =
  'https://pub-c1dea26a05844ec7959997061df9f305.r2.dev/content-db.json'

/** 每视频字幕地址前缀：CURATED_CUES_URL_BASE + videoId + '.json' */
export const CURATED_CUES_URL_BASE =
  'https://pub-c1dea26a05844ec7959997061df9f305.r2.dev/cues/'
