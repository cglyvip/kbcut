import { Worker } from "worker_threads";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdir } from "fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));

const WORKER_PATH = join(__dirname, "workers/asr-worker.cjs");

export async function localAsr(
  audioPath: string,
  modelCacheDir: string,
): Promise<any> {
  await mkdir(modelCacheDir, { recursive: true });
  const worker = new Worker(WORKER_PATH, { workerData: { modelCacheDir } });

  return new Promise((resolvePromise, reject) => {
    let settled = false;

    const timer = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("本地语音识别超时（>60分钟），已结束识别线程"));
      },
      60 * 60 * 1000,
    );

    const onMessage = (msg: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (msg && msg.success) {
        resolvePromise(msg.result);
      } else {
        reject(new Error(msg?.error || "识别失败：未返回有效结果"));
      }
    };
    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const onExit = (code: number) => {
      // 无论 exit code 是什么，只要还没收到消息就视为异常退出
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          code === 0
            ? "识别线程已退出但未返回结果（可能是模型加载失败或内存不足）"
            : `识别线程异常退出（code=${code}）`,
        ),
      );
    };

    function cleanup() {
      clearTimeout(timer);
      worker.removeListener("message", onMessage);
      worker.removeListener("error", onError);
      worker.removeListener("exit", onExit);
      worker.terminate().catch(() => {});
    }

    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);

    worker.postMessage({ audioPath });
  });
}
