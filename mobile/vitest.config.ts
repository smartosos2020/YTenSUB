import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // AsyncStorage 依赖 react-native NativeModules，node 环境跑不了；
      // 测试统一走内存实现（tests/mocks/async-storage.ts）
      '@react-native-async-storage/async-storage': resolve(
        __dirname,
        'tests/mocks/async-storage.ts'
      )
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
