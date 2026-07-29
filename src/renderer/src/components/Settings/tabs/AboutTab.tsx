import { styles } from "../styles";

interface AboutTabProps {
  onOpenExternal: (url?: string) => void;
}

export default function AboutTab({ onOpenExternal }: AboutTabProps) {
  return (
    <div>
      <div style={styles.aboutCard}>
        <div style={styles.aboutTitleRow}>
          <div>
            <div style={styles.aboutAppName}>口播智剪</div>
            <div style={styles.aboutSub}>KBCut · 千川投流口播重组工具</div>
          </div>
          <span style={styles.aboutVersion}>v{__APP_VERSION__}</span>
        </div>
        <div style={styles.aboutMeta}>
          <div>平台：Windows 10/11 x64</div>
          <div>协议：MIT</div>
          <div>作者：CGLY</div>
        </div>
      </div>

      <div style={styles.aboutLinks}>
        <button
          style={styles.miniPrimaryBtn}
          onClick={() => onOpenExternal("https://github.com/cglyvip/kbcut")}
        >
          GitHub 仓库
        </button>
        <button
          style={styles.miniPrimaryBtn}
          onClick={() =>
            onOpenExternal(
              "https://github.com/cglyvip/kbcut/blob/main/docs/GETTING-STARTED.md",
            )
          }
        >
          从零开始指南
        </button>
        <button
          style={styles.miniBtn}
          onClick={() =>
            onOpenExternal(
              "https://github.com/cglyvip/kbcut/blob/main/docs/ASR-GUIDE.md",
            )
          }
        >
          语音识别教程
        </button>
        <button
          style={styles.miniBtn}
          onClick={() =>
            onOpenExternal("https://github.com/cglyvip/kbcut/releases")
          }
        >
          Release 下载
        </button>
      </div>

      <div style={styles.aboutThanks}>
        <div style={styles.switchTitle}>致谢</div>
        <div style={styles.aboutThanksText}>
          感谢{" "}
          <a
            style={styles.aboutLink}
            onClick={() => onOpenExternal("https://xiaoxiaobai.me/")}
          >
            GGgrok
          </a>
          （L站大佬）提供的免费大模型 API，本软件由 AI 辅助编程完成。
        </div>
      </div>
    </div>
  );
}
