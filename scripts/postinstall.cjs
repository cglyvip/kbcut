const fs = require('fs')
const path = require('path')

const nestedOnnx = path.join(
  __dirname,
  '..',
  'node_modules',
  'onnxruntime-web',
  'node_modules',
  'onnxruntime-common'
)

if (fs.existsSync(nestedOnnx)) {
  fs.rmSync(nestedOnnx, { recursive: true, force: true })
  console.log('Removed nested onnxruntime-common from onnxruntime-web')
}

// Patch onnxruntime-node to re-export onnxruntime-web and avoid native DLL dependency.
// The app uses onnxruntime-web (WASM) for inference, but @huggingface/transformers
// unconditionally imports onnxruntime-node at module load time. Without this patch,
// the native DLL load crashes the process if VC++ runtime is not installed.
const ortNodeIndex = path.join(
  __dirname,
  '..',
  'node_modules',
  'onnxruntime-node',
  'dist',
  'index.js'
)
if (fs.existsSync(ortNodeIndex)) {
  const content = fs.readFileSync(ortNodeIndex, 'utf8')
  if (!content.includes('re-export onnxruntime-web')) {
    fs.writeFileSync(
      ortNodeIndex,
      [
        '"use strict";',
        '// Patched: re-export onnxruntime-web to avoid native DLL dependency.',
        '// The app uses WASM backend for inference. This patch prevents crashes',
        '// when Visual C++ Redistributable is not installed.',
        'module.exports = require("onnxruntime-web");',
        '',
      ].join('\n'),
      'utf8'
    )
    console.log('Patched onnxruntime-node/dist/index.js to re-export onnxruntime-web')
  }
}

// Ensure electron path.txt has no CRLF, otherwise require('electron') hangs
// trying to re-download a missing binary name like "electron.exe\r".
const electronDir = path.join(__dirname, '..', 'node_modules', 'electron')
const pathTxt = path.join(electronDir, 'path.txt')
const electronExe = path.join(electronDir, 'dist', 'electron.exe')
if (fs.existsSync(electronExe)) {
  fs.writeFileSync(pathTxt, 'electron.exe', 'utf8')
} else if (fs.existsSync(pathTxt)) {
  const cleaned = String(fs.readFileSync(pathTxt, 'utf8') || '').replace(/\r?\n/g, '').trim()
  if (cleaned) fs.writeFileSync(pathTxt, cleaned, 'utf8')
}
