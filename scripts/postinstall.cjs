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
