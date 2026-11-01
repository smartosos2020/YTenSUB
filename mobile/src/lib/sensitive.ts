// Re-export the single source of truth used by the desktop client.
export {
  SENSITIVE_TAGS,
  SENSITIVE_CHANNELS,
  SENSITIVE_TITLE_KEYWORDS,
  isSensitiveVideo,
  filterSensitiveVideos
} from '../../../src/shared/sensitive'
export type { SensitiveCheckTarget } from '../../../src/shared/sensitive'
