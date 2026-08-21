import { useEffect, useState } from "react";
import { styles } from "../styles";
import { formatBytes } from "../utils";
import type { AsrModelInfoView } from "../types";

interface AsrGuideTabProps {
  asrModelInfo: AsrModelInfoView | null;
  asrModelLoading: boolean;
  onRefreshModelInfo: () => void;
  onOpenExternal: (url?: string) => void;
}

interface DownloadProgress {
  status: string;
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export default function AsrGuideTab({
  asrModelInfo,
  asrModelLoading,
  onRefreshModelInfo,
  onOpenExternal,
}: AsrGuideTabProps) {
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);

  useEffect(() => {
    if (typeof window.api.onAsrDownloadProgress !== "function") return;
    const cleanup = window.api.onAsrDownloadProgress((data) => {
      setDownloadProgress(data);
      if (data.status === "ready") {
        setTimeout(() => setDownloadProgress(null), 2000);
      }
    });
    return cleanup;
  }, []);

  return (
    <div>
      <div style={styles.guideHero}>
        <div style={styles.switchTitle}>语音识别怎么选</div>
        <div style={styles.switchDesc}>
          批量生产优先在线识别；重视隐私、没有 ASR API
          或网络不稳定时使用本地识别。
        </div>
        <div style={styles.guideCompareGrid}>
          <div style={styles.guideCompareItem}>
            <strong>在线</strong>
            <span>通常更快、词级时间戳更准，需要 API 和网络</span>
          </div>
          <div style={styles.guideCompareItem}>
            <strong>本地</strong>
            <span>无需 API，首次下载较慢，更依赖 CPU、内存和磁盘</span>
          </div>
        </div>
      </div>

      <div style={styles.guideSection}>
        <div style={styles.guideTitle}>本地 Whisper 下载与使用</div>
        <ol style={styles.guideList}>
          <li style={styles.guideItem}>进入「语音识别」，选择「本地识别」。</li>
          <li style={styles.guideItem}>
            准备稳定网络，并预留至少 2GB 磁盘空间；模型为{" "}
            <code style={styles.inlineCode}>onnx-community/whisper-small</code>{" "}
            的量化版本。
          </li>
          <li style={styles.guideItem}>
            导入一个较短视频并开始识别。第一次会自动从选定的下载源下载，失败后自动尝试备用源。
          </li>
          <li style={styles.guideItem}>
            首次下载期间不要关闭软件。下载完成后模型永久缓存在本机，后续识别不再重复下载。
          </li>
          <li style={styles.guideItem}>
            如果下载中断，检查代理、防火墙和剩余空间，然后直接重新识别，程序会继续使用已有缓存。
          </li>
        </ol>

        <div
          style={{
            ...styles.modelStatus,
            ...(asrModelInfo?.downloaded ? styles.modelStatusOk : {}),
          }}
        >
          <div>
            <div style={styles.switchTitle}>
              {asrModelInfo?.downloaded
                ? "✓ 模型文件完整，可正常使用"
                : asrModelInfo?.missingFiles?.length
                  ? `缺少 ${asrModelInfo.missingFiles.length} 个必需文件`
                  : "尚未检测到完整模型缓存"}
            </div>
            <div style={styles.switchDesc}>
              {asrModelLoading
                ? "正在检查..."
                : asrModelInfo
                  ? `${asrModelInfo.fileCount} 个文件 · ${formatBytes(asrModelInfo.sizeBytes)}`
                  : "点击刷新状态检查"}
            </div>
          </div>
          <button
            style={styles.miniBtn}
            onClick={onRefreshModelInfo}
            disabled={asrModelLoading}
          >
            {asrModelLoading ? "检查中..." : "刷新状态"}
          </button>
        </div>

        {asrModelInfo &&
          !asrModelInfo.downloaded &&
          asrModelInfo.missingFiles.length > 0 && (
            <div
              style={{
                ...styles.progressBox,
                borderColor: "#ffa39e",
                background: "#fff2f0",
              }}
            >
              <div
                style={{ fontSize: 13, color: "#cf1322", marginBottom: 4 }}
              >
                缺少以下文件（需放入 onnx-community/whisper-small/ 子目录）：
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 12,
                  color: "#595959",
                  lineHeight: 1.8,
                }}
              >
                {asrModelInfo.missingFiles.map((f) => (
                  <li key={f}>
                    <code style={styles.inlineCode}>{f}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

        {asrModelInfo?.hasTemporaryFiles && (
          <div
            style={{
              ...styles.progressBox,
              borderColor: "#ffe58f",
              background: "#fffbe6",
            }}
          >
            <div style={{ fontSize: 13, color: "#d48806" }}>
              检测到未完成的下载临时文件（.tmp），上次下载可能中断。重新执行识别会继续下载。
            </div>
          </div>
        )}

        {downloadProgress && downloadProgress.status === "initiate" && (
          <div style={styles.progressBox}>
            <div style={styles.switchDesc}>正在准备下载模型...</div>
          </div>
        )}
        {downloadProgress && downloadProgress.status === "progress" && (
          <div style={styles.progressBox}>
            <div style={styles.switchDesc}>
              正在下载: {downloadProgress.file || downloadProgress.name || "model"}
            </div>
            <div style={styles.progressBar}>
              <div
                style={{
                  ...styles.progressFill,
                  width: `${Math.round(downloadProgress.progress || 0)}%`,
                }}
              />
            </div>
            <div style={styles.switchDesc}>
              {formatBytes(downloadProgress.loaded || 0)} /{" "}
              {formatBytes(downloadProgress.total || 0)}
              {" · "}
              {Math.round(downloadProgress.progress || 0)}%
            </div>
          </div>
        )}
        {downloadProgress && downloadProgress.status === "ready" && (
          <div style={styles.progressBox}>
            <div style={styles.switchDesc}>✓ 模型加载完成</div>
          </div>
        )}

        {asrModelInfo && (
          <div style={styles.pathBox}>{asrModelInfo.cacheDir}</div>
        )}
        <div style={styles.actions}>
          {asrModelInfo && (
            <button
              style={styles.miniBtn}
              onClick={() => void window.api.openFolder(asrModelInfo.cacheDir)}
            >
              打开模型目录
            </button>
          )}
          {asrModelInfo && (
            <button
              style={styles.miniBtn}
              onClick={() => onOpenExternal(asrModelInfo.mirrorUrl)}
            >
              打开国内镜像
            </button>
          )}
          {asrModelInfo && (
            <button
              style={styles.miniBtn}
              onClick={() => onOpenExternal(asrModelInfo.officialUrl)}
            >
              打开官方模型页
            </button>
          )}
        </div>
      </div>

      <div style={styles.guideSection}>
        <div style={styles.guideTitle}>手动下载方案</div>
        <p style={styles.switchDesc}>
          如果自动下载反复失败（网络受限、代理不兼容等），可以手动下载模型文件后放入缓存目录。
        </p>
        <ol style={styles.guideList}>
          <li style={styles.guideItem}>
            从以下任一地址下载模型仓库的全部文件：
            <br />
            <span style={{ display: "inline-flex", gap: 8, marginTop: 4 }}>
              <button
                style={styles.miniBtn}
                onClick={() =>
                  onOpenExternal(
                    "https://hf-mirror.com/onnx-community/whisper-small/tree/main",
                  )
                }
              >
                国内镜像（推荐）
              </button>
              <button
                style={styles.miniBtn}
                onClick={() =>
                  onOpenExternal(
                    "https://huggingface.co/onnx-community/whisper-small/tree/main",
                  )
                }
              >
                官方仓库
              </button>
            </span>
          </li>
          <li style={styles.guideItem}>
            需要下载的文件（仅量化版本）：
            <br />
            <code style={styles.inlineCode}>config.json</code>、
            <code style={styles.inlineCode}>tokenizer.json</code>、
            <code style={styles.inlineCode}>tokenizer_config.json</code>、
            <code style={styles.inlineCode}>preprocessor_config.json</code>、
            <code style={styles.inlineCode}>generation_config.json</code>
            <br />
            以及{" "}
            <code style={styles.inlineCode}>onnx/</code> 目录下所有带{" "}
            <code style={styles.inlineCode}>quantized</code> 或{" "}
            <code style={styles.inlineCode}>q4</code> 字样的{" "}
            <code style={styles.inlineCode}>.onnx</code> /{" "}
            <code style={styles.inlineCode}>.onnx_data</code> 文件。
          </li>
          <li style={styles.guideItem}>
            将下载的文件按原始目录结构放入以下路径：
            {asrModelInfo && (
              <div style={{ ...styles.pathBox, marginTop: 4 }}>
                {asrModelInfo.cacheDir}
                \onnx-community\whisper-small\
              </div>
            )}
            例如{" "}
            <code style={styles.inlineCode}>config.json</code> 放在：
            {asrModelInfo && (
              <div style={{ ...styles.pathBox, marginTop: 4, fontSize: 11 }}>
                {asrModelInfo.cacheDir}
                \onnx-community\whisper-small\config.json
              </div>
            )}
            <code style={styles.inlineCode}>onnx/</code> 下的文件放在：
            {asrModelInfo && (
              <div style={{ ...styles.pathBox, marginTop: 4, fontSize: 11 }}>
                {asrModelInfo.cacheDir}
                \onnx-community\whisper-small\onnx\*.onnx
              </div>
            )}
          </li>
          <li style={styles.guideItem}>
            放好后点击上方「刷新状态」确认识别到模型（文件总大小应 &gt; 100MB），
            然后正常开始识别即可。
          </li>
        </ol>
        {asrModelInfo && (
          <button
            style={styles.miniBtn}
            onClick={() => void window.api.openFolder(asrModelInfo.cacheDir)}
          >
            打开模型缓存目录
          </button>
        )}
      </div>

      <div style={styles.guideSection}>
        <div style={styles.guideTitle}>在线 Whisper 配置与使用</div>
        <ol style={styles.guideList}>
          <li style={styles.guideItem}>
            向支持 OpenAI 兼容音频转写接口的服务商申请 API Key。
          </li>
          <li style={styles.guideItem}>
            确认服务支持{" "}
            <code style={styles.inlineCode}>POST /v1/audio/transcriptions</code>
            ，最好支持 <code style={styles.inlineCode}>verbose_json</code>{" "}
            和词级时间戳。
          </li>
          <li style={styles.guideItem}>
            API 地址可填写服务根地址、带版本路径的地址，或完整{" "}
            <code style={styles.inlineCode}>/audio/transcriptions</code> 接口。
          </li>
          <li style={styles.guideItem}>
            模型默认填写 <code style={styles.inlineCode}>whisper-1</code>
            ；第三方服务必须填写其控制台显示的真实模型名称。
          </li>
          <li style={styles.guideItem}>
            先用 30-60
            秒短视频测试，确认中文、标点和时间戳正常，再启动批量队列。
          </li>
        </ol>
        <div style={styles.guideWarning}>
          在线识别会把提取后的音频上传到你配置的服务商。涉及隐私或未公开素材时，应先确认服务商的数据政策。
        </div>
        <div style={styles.errorGrid}>
          <div>
            <strong>401/403</strong>
            <span>API Key 无效、权限不足或余额不可用</span>
          </div>
          <div>
            <strong>404</strong>
            <span>API 地址或模型名称错误</span>
          </div>
          <div>
            <strong>413</strong>
            <span>音频超过服务商单文件限制</span>
          </div>
          <div>
            <strong>429</strong>
            <span>请求频率或额度受限，稍后重试</span>
          </div>
          <div>
            <strong>5xx/超时</strong>
            <span>服务商异常或网络不稳定</span>
          </div>
        </div>
      </div>
    </div>
  );
}
