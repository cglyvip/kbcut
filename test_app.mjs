import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { readFile } from 'fs/promises'

const __filename = fileURLToPath(import.meta.url)
const req = createRequire(__filename)

process.on('unhandledRejection', (r) => { console.log('\n=== UNHANDLED REJECTION ==='); console.error(r); process.exit(1) })
process.on('uncaughtException', (e) => { console.log('\n=== UNCAUGHT EXCEPTION ==='); console.error(e); process.exit(1) })

const start = Date.now()
function log(msg) { console.log(`[+${((Date.now()-start)/1000).toFixed(1)}s] ${msg}`) }

async function main() {
  // Exact same flow as the app
  log('1. Loading onnxruntime-web (CJS)...')
  const ortWeb = req('onnxruntime-web')
  const mjsPath = req.resolve('onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs')
  const wasmPath = req.resolve('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm')
  ortWeb.env.wasm.wasmPaths = {
    mjs: pathToFileURL(mjsPath).href,
    wasm: pathToFileURL(wasmPath).href
  }
  ortWeb.env.wasm.numThreads = 1

  log('2. Importing @huggingface/transformers...')
  const { pipeline, env: tfEnv } = await import('@huggingface/transformers')
  tfEnv.remoteHost = 'https://hf-mirror.com'
  tfEnv.allowLocalModels = true
  tfEnv.useWasmCache = false
  log('3. Creating pipeline (whisper-small, q4)...')
  const pipe = await pipeline(
    'automatic-speech-recognition',
    'onnx-community/whisper-small',
    { dtype: 'q4' }
  )
  log('4. Pipeline created!')

  log('5. Running inference with EXACT app options...')
  const dummy = new Float32Array(16000)
  const result = await pipe(dummy, {
    language: 'chinese',
    task: 'transcribe',
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5
  })
  log(`Result: ${JSON.stringify(result).slice(0, 300)}`)
  log('ALL TESTS PASSED!')
}

main().catch(e => {
  console.log('\n=== FATAL ERROR ===')
  console.error('Message:', e.message)
  console.error('Stack:', e.stack?.slice(0, 1000))
  process.exit(1)
})
