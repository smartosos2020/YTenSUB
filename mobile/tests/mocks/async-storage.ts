/**
 * AsyncStorage 内存 mock：仅供 vitest node 环境使用（见 vitest.config.ts 的 resolve.alias）。
 * 只实现本项目用到的 getItem / setItem / removeItem。
 */
const store = new Map<string, string>()

/** 每个用例前清空，避免跨用例串数据 */
export function __resetAsyncStorage(): void {
  store.clear()
}

export default {
  getItem: async (key: string): Promise<string | null> => store.get(key) ?? null,
  setItem: async (key: string, value: string): Promise<void> => {
    store.set(key, value)
  },
  removeItem: async (key: string): Promise<void> => {
    store.delete(key)
  }
}
