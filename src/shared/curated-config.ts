import { AUTH_API_URL } from './api-config'

/** Both clients use the Worker for all curated metadata; subtitles use authenticated /cues/:id. */
export const CURATED_INC_URL_BASE = `${AUTH_API_URL}/content/`
export const CURATED_SNAPSHOT_URL = `${CURATED_INC_URL_BASE}content-db.json`
export const CURATED_INDEX_URL = `${CURATED_INC_URL_BASE}index.json`
