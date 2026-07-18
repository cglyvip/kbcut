import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const req = createRequire(__filename)

process.on('unhandledRejection', (r) => { console.error('UNHANDLED REJECTION:', r); process.exit(1) })
process.on('uncaughtException', (e) => { console.error('UNCAUGHT EXCEPTION:', e); process.exit(1) })

async function main() {
  console.log('1. Loading onnxruntime-web (CJS)...')
  const ortWeb = req('onnxruntime-web')
  console.log('   loaded, registerBackend type:', typeof ortWeb.registerBackend)

  const mjsPath = req.resolve('onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs')
  const wasmPath = req.resolve('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm')
  ortWeb.env.wasm.wasmPaths = {
    mjs: pathToFileURL(mjsPath).href,
    wasm: pathToFileURL(wasmPath).href
  }
  ortWeb.env.wasm.numThreads = 1
  console.log('2. env.wasm configured')

  console.log('3. Checking backends...')
  // Check if backend was registered
  const ortCommon = req('onnxruntime-common')
  console.log('   same env:', ortCommon.env === ortWeb.env)
  console.log('   same registerBackend:', ortCommon.registerBackend === ortWeb.registerBackend)

  console.log('4. Trying InferenceSession.create with a fake buffer...')
  try {
    const session = await ortWeb.InferenceSession.create(new Uint8Array(100), {
      executionProviders: ['cpu']
    })
    console.log('   Session created (unexpected)')
  } catch (e) {
    console.log('   Expected error (fake buffer):', e.message.slice(0, 150))
  }

  console.log('5. Loading transformers (may take time to download model)...')
  const { pipeline, env: tfEnv } = await import('@huggingface/transformers')
  tfEnv.remoteHost = 'https://hf-mirror.com'
  tfEnv.allowLocalModels = true
  tfEnv.useWasmCache = false
  console.log('   transformers loaded')

  console.log('6. Creating pipeline...')
  const pipe = await pipeline(
    'automatic-speech-recognition',
    'onnx-community/whisper-small',
    { dtype: 'q4' }
  )
  console.log('7. Pipeline created!')

  console.log('8. Running inference on dummy audio...')
  const dummyAudio = new Float32Array(16000) // 1 second of silence
  const result = await pipe(dummyAudio)
  console.log('9. Result:', result)
}

main().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})
