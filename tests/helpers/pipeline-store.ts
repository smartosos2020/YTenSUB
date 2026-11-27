import type { Env } from '../../server/src/index'

export function pipelineStore(): Env['CONTENT_BUCKET'] {
  let stored: { text: string; etag: string } | undefined
  let revision = 0
  return {
    async get() {
      const current = stored
      return current ? { etag: current.etag, json: async () => JSON.parse(current.text) } : null
    },
    async put(_key: string, text: string, options: { onlyIf: { etagMatches?: string; etagDoesNotMatch?: string } }) {
      if (options.onlyIf.etagMatches && options.onlyIf.etagMatches !== stored?.etag || options.onlyIf.etagDoesNotMatch === '*' && stored) return null
      stored = { text, etag: String(++revision) }
      return { etag: stored.etag }
    }
  } as unknown as Env['CONTENT_BUCKET']
}
