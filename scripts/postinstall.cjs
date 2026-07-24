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
