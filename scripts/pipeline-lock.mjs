import { createServer } from 'node:net'
import path from 'node:path'
import os from 'node:os'

/** OS releases the listener on exit, including a crash; no stale PID files. */
export async function acquirePipelineLock(name, namespace = '') {
  if (!['runner', 'collection'].includes(name)) throw new Error('Invalid pipeline lock')
  if (namespace && !/^[a-f0-9-]{36}$/.test(namespace)) throw new Error('Invalid lock namespace')
  const suffix = namespace ? '-' + namespace : ''
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\ytensub-pipeline-${name}${suffix}`
    : path.join(os.tmpdir(), `ytensub-pipeline-${name}${suffix}.sock`)
  const server = createServer(socket => socket.destroy())
  await new Promise((resolve, reject) => {
    server.once('error', error => reject(new Error(name === 'runner' ? '管线执行端已在运行' : '内容管线已在运行，请等待完成', { cause: error })))
    server.listen(address, resolve)
  })
  server.unref()
  return () => new Promise(resolve => server.close(resolve))
}
