const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");

const MODEL_ID = "onnx-community/whisper-small";
const REQUIRED_FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_q4.onnx",
  "onnx/decoder_model_merged_q4.onnx",
];
const HOSTS = (process.env.WHISPER_MODEL_HOSTS || "https://hf-mirror.com,https://huggingface.co")
  .split(",")
  .map((host) => host.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const outputRoot = path.resolve(__dirname, "..", "..", "models", "whisper-small");

function temporaryPath(destination) {
  const id = `${process.pid}.${Math.random().toString(36).slice(2)}`;
  return `${destination}.tmp.${id}`;
}

async function downloadFile(relativeFile) {
  const destination = path.join(outputRoot, MODEL_ID, relativeFile);
  if (fs.existsSync(destination) && fs.statSync(destination).size > 0) {
    console.log(`Model file exists: ${relativeFile}`);
    return;
  }

  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const tempFile = temporaryPath(destination);
  let lastError;

  for (const host of HOSTS) {
    const url = `${host}/${MODEL_ID}/resolve/main/${relativeFile.split(path.sep).join("/")}`;
    try {
      console.log(`Downloading ${relativeFile} from ${host}`);
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tempFile));
      await fs.promises.rename(tempFile, destination);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`Download failed: ${error && error.message ? error.message : error}`);
      await fs.promises.rm(tempFile, { force: true }).catch(() => {});
    }
  }

  throw new Error(`Unable to download ${relativeFile}: ${lastError}`);
}

async function main() {
  console.log(`Ensuring Whisper model files in ${outputRoot}`);
  for (const file of REQUIRED_FILES) {
    await downloadFile(file);
  }
  console.log("Whisper q4 model is ready.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
