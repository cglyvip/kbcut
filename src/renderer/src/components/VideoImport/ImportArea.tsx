import { useState, useCallback } from "react";
import { useVideoStore } from "../../stores/useVideoStore";
import { useAsrStore } from "../../stores/useAsrStore";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}分${s}秒`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

export default function ImportArea() {
  const { videoInfo, loading, setVideoInfo, setLoading, clear } =
    useVideoStore();
  const clearAsr = useAsrStore((state) => state.clear);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectVideo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await window.api.selectVideo();
      if (info) {
        clearAsr();
        setVideoInfo(info);
      }
    } catch (e: unknown) {
      setError("选择视频失败: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [clearAsr, setVideoInfo, setLoading]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["mp4", "mov", "avi", "mkv", "flv", "wmv"].includes(ext || "")) {
        setError("不支持的文件格式");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const filePath = window.api.getPathForFile(file);
        const info = await window.api.getVideoInfo(filePath);
        clearAsr();
        setVideoInfo(info);
      } catch (e: unknown) {
        setError(
          "读取视频失败: " + (e instanceof Error ? e.message : String(e)),
        );
      } finally {
        setLoading(false);
      }
    },
    [clearAsr, setVideoInfo, setLoading],
  );

  const handleClear = useCallback(() => {
    clearAsr();
    clear();
  }, [clear, clearAsr]);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.importBox}>
          <div style={styles.spinner} />
          <p style={styles.text}>正在读取视频信息...</p>
        </div>
      </div>
    );
  }

  if (videoInfo) {
    return (
      <div style={styles.containerCompact}>
        <div style={styles.infoBar}>
          <div style={styles.fileIcon}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#1677ff"
              strokeWidth="2"
            >
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
          <div style={styles.infoMain}>
            <span style={styles.fileName}>{videoInfo.fileName}</span>
            <span style={styles.infoMeta}>
              {formatDuration(videoInfo.duration)} | {videoInfo.width}x
              {videoInfo.height} | {videoInfo.fps}FPS |{" "}
              {formatFileSize(videoInfo.fileSize)} | {videoInfo.codec}
            </span>
          </div>
          <div style={styles.infoActions}>
            <button style={styles.btnSmall} onClick={handleSelectVideo}>
              更换
            </button>
            <button style={styles.btnSmallDanger} onClick={handleClear}>
              清除
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div
        style={{
          ...styles.importBox,
          ...(dragOver ? styles.importBoxDragOver : {}),
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={handleSelectVideo}
      >
        <div style={styles.iconWrap}>
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#bfbfbf"
            strokeWidth="1.5"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <p style={styles.text}>点击选择视频 或 拖拽视频到这里</p>
        <p style={styles.hint}>支持 MP4、MOV、AVI、MKV 等格式</p>
        {error && <p style={styles.error}>{error}</p>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "32px 40px",
  },
  containerCompact: {
    padding: "0 40px 16px",
  },
  importBox: {
    width: "100%",
    maxWidth: 600,
    height: 240,
    border: "2px dashed #d9d9d9",
    borderRadius: 16,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    cursor: "pointer",
    transition: "all 0.3s",
    background: "#fff",
  },
  importBoxDragOver: {
    borderColor: "#1677ff",
    background: "#e6f4ff",
    transform: "scale(1.01)",
  },
  iconWrap: {
    marginBottom: 16,
  },
  text: {
    fontSize: 16,
    color: "#595959",
    margin: 0,
  },
  hint: {
    fontSize: 13,
    color: "#bfbfbf",
    marginTop: 6,
  },
  error: {
    fontSize: 13,
    color: "#ff4d4f",
    marginTop: 12,
    textAlign: "center" as const,
  },
  spinner: {
    width: 36,
    height: 36,
    border: "3px solid #f0f0f0",
    borderTopColor: "#1677ff",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    marginBottom: 16,
  },
  infoBar: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    background: "#fff",
    borderRadius: 10,
    padding: "12px 20px",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
    border: "1px solid #e8e8e8",
  },
  fileIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    background: "#e6f4ff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  infoMain: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    overflow: "hidden",
  },
  fileName: {
    fontSize: 14,
    fontWeight: 600,
    color: "#262626",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  infoMeta: {
    fontSize: 12,
    color: "#8c8c8c",
  },
  infoActions: {
    display: "flex",
    gap: 8,
    flexShrink: 0,
  },
  btnSmall: {
    padding: "5px 14px",
    background: "#fff",
    color: "#1677ff",
    border: "1px solid #91caff",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
  btnSmallDanger: {
    padding: "5px 14px",
    background: "#fff",
    color: "#ff4d4f",
    border: "1px solid #ffa39e",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
};
