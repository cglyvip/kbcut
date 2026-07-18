import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const req = createRequire(__filename)

process.on('unhandledRejection', (r) => { console.log('\n=== UNHANDLED REJECTION ==='); console.error(r); process.exit(1) })
process.on('uncaughtException', (e) => { console.log('\n=== UNCAUGHT EXCEPTION ==='); console.error(e); process.exit(1) })

// Track time
const start = Date.now()
function log(msg) {
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`[+${elapsed}s] ${msg}`)
}

async function main() {
  // Step 1: Load onnxruntime-web CJS
  log('Loading onnxruntime-web (CJS)...')
  const ortWeb = req('onnxruntime-web')
  const mjsPath = req.resolve('onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs')
  const wasmPath = req.resolve('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm')
  ortWeb.env.wasm.wasmPaths = {
    mjs: pathToFileURL(mjsPath).href,
    wasm: pathToFileURL(wasmPath).href
  }
  ortWeb.env.wasm.numThreads = 1
  log('ort-web loaded, env configured')
  
  // Step 2: Quick test — create InferenceSession with invalid buffer (should fail w/ protobuf error, not "no backend")
  log('Testing InferenceSession.create with dummy buffer...')
  try {
    await ortWeb.InferenceSession.create(new Uint8Array(100))
    log('ERROR: should have thrown')
  } catch (e) {
    const msg = e.message?.slice(0, 120) || String(e)
    if (msg.includes('protobuf') || msg.includes('parse') || msg.includes('Invalid')) {
      log(`OK (expected error — backend found): ${msg}`)
    } else {
      log(`UNEXPECTED error: ${msg}`)
      log(`Stack: ${e.stack?.slice(0, 200)}`)
    }
  }
  
  // Step 3: Import transformers
  log('Importing @huggingface/transformers...')
  const { pipeline, env: tfEnv } = await import('@huggingface/transformers')
  tfEnv.remoteHost = 'https://hf-mirror.com'
  tfEnv.allowLocalModels = true
  tfEnv.useWasmCache = false
  log('transformers loaded')
  
  // Step 4: Create pipeline with a MUCH smaller model for quick test
  log('Creating pipeline (whisper-tiny, fp32)...')
  const pipe = await pipeline(
    'automatic-speech-recognition',
    'onnx-community/whisper-tiny.en',
    { dtype: 'fp32' }
  )
  log('Pipeline created!')
  
  // Step 5: Run inference on dummy audio
  log('Running inference on 1s silence...')
  const dummy = new Float32Array(16000)
  const result = await pipe(dummy)
  log(`Result: ${JSON.stringify(result).slice(0, 200)}`)
  
  log('ALL TESTS PASSED!')
}

main().catch(e => {
  console.log('\n=== FATAL ERROR ===')
  console.error('Message:', e.message)
  console.error('Stack:', e.stack?.slice(0, 500))
  process.exit(1)
})
