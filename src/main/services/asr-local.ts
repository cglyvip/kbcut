import { Worker } from 'worker_threads'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const WORKER_PATH = join(__dirname, 'workers/asr-worker.cjs')

export async function localAsr(audioPath: string): Promise<any> {
  const worker = new Worker(WORKER_PATH)

  return new Promise((resolvePromise, reject) => {
    const onMessage = (msg: any) => {
      cleanup()
      if (msg.success) {
        resolvePromise(msg.result)
      } else {
        reject(new Error(msg.error || 'Unknown error'))
      }
    }
    const onError = (err: Error) => { cleanup(); reject(err) }
    const onExit = (code: number) => {
      if (code !== 0) { cleanup(); reject(new Error(`Worker exited with code ${code}`)) }
    }

    function cleanup() {
      worker.removeListener('message', onMessage)
      worker.removeListener('error', onError)
      worker.removeListener('exit', onExit)
      worker.terminate().catch(() => {})
    }

    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.on('exit', onExit)

    worker.postMessage({ audioPath })
  })
}
