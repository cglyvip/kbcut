import { parentPort, workerData } from 'worker_threads'
import { readFile } from 'fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const moduleRequire = createRequire(__filename)

interface AsrSegment {
  start: number
  end: number
  text: string
  words: { start: number; end: number; text: string }[]
}

interface AsrResult {
  segments: AsrSegment[]
  fullText: string
  language: string
}

async function runAsr(audioPath: string): Promise<AsrResult> {
  const ortWeb = moduleRequire('onnxruntime-web')
  const ortWasmMjsPath = moduleRequire.resolve('onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs')
  const ortWasmPath = moduleRequire.resolve('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm')
  ortWeb.env.wasm.wasmPaths = {
    mjs: pathToFileURL(ortWasmMjsPath).href,
    wasm: pathToFileURL(ortWasmPath).href
  }
  ortWeb.env.wasm.numThreads = 1

  const { pipeline, env } = await import('@huggingface/transformers')
  env.remoteHost = 'https://hf-mirror.com'
  env.allowLocalModels = true
  env.useWasmCache = false

  const pipe = await pipeline(
    'automatic-speech-recognition',
    'onnx-community/whisper-small',
    { dtype: 'q4' }
  )

  const audioBuffer = await readFile(audioPath)
  const samples = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2)
  const float32Array = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    float32Array[i] = samples[i] / 32768.0
  }

  const result = await pipe(float32Array, {
    language: 'chinese',
    task: 'transcribe',
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5
  })

  const segments: AsrSegment[] = (result.chunks || []).map((chunk: any) => {
    const start = chunk.timestamp?.[0] || 0
    const end = chunk.timestamp?.[1] || 0
    const text = (chunk.text || '').trim()
    const chars = [...text].filter(c => c.trim().length > 0)
    let words: { start: number; end: number; text: string }[]
    if (chars.length === 0) {
      words = [{ start, end, text }]
    } else {
      const duration = end - start
      const charDuration = duration / chars.length
      words = chars.map((char, i) => ({
        start: start + i * charDuration,
        end: start + (i + 1) * charDuration,
        text: char
      }))
    }
    return { start, end, text, words }
  }).filter((s: AsrSegment) => s.text.length > 0)

  return {
    segments,
    fullText: result.text || segments.map(s => s.text).join(''),
    language: 'zh'
  }
}

parentPort?.on('message', async (msg: { audioPath: string }) => {
  try {
    const result = await runAsr(msg.audioPath)
    parentPort?.postMessage({ success: true, result })
  } catch (err: any) {
    parentPort?.postMessage({ success: false, error: err.message || String(err) })
  }
})
