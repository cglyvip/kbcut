// Quick test: does the WASM backend init work?
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const req = createRequire(__filename)

// Load onnxruntime-web (CJS) to register WASM backend in top-level Map
const ortWeb = req('onnxruntime-web')

// Configure WASM paths
const ortWasmMjsPath = req.resolve('onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs')
const ortWasmPath = req.resolve('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm')
ortWeb.env.wasm.wasmPaths = {
  mjs: pathToFileURL(ortWasmMjsPath).href,
  wasm: pathToFileURL(ortWasmPath).href
}
ortWeb.env.wasm.numThreads = 1

console.log('env.wasm configured:', JSON.stringify(ortWeb.env.wasm, null, 2))

// Now try to create an InferenceSession with a real model check
// We just need to see if the WASM backend is found
console.log('\nChecking if backend can be found...')
const { resolveBackendAndExecutionProviders } = req('onnxruntime-common')

// Actually, resolveBackendAndExecutionProviders might not be exported
// Let me check the exports
console.log('Available exports:', Object.keys(ortWeb).filter(k => k.includes('Inference') || k.includes('Backend')).join(', '))

// Try to use InferenceSession with a small model buffer
// Create a minimal valid ONNX model
const fs = await import('node:fs')
const tinyModelPath = req.resolve('@huggingface/transformers/package.json')
console.log('\nTransformers found at:', tinyModelPath)

// Let's try loading the actual pipeline with timeout
console.log('\nWill now try to load transformers pipeline...')
