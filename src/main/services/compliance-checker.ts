export interface ComplianceViolation {
  type: "banned_word" | "missing_element" | "medical_claim";
  severity: "error" | "warning";
  message: string;
  snippet?: string;
  suggestion?: string;
}

const BANNED_WORDS = [
  "第一品牌",
  "最好",
  "绝对",
  "永不",
  "根治",
  "百分百",
  "100%有效",
  "零风险",
  "完全康复",
  "无效退款保证",
  "保证治愈",
  "彻底治好",
  "永久解决",
  "绝无副作用",
  "绝对安全",
  "永不复发",
  "治疗",
  "疗效",
  "药效",
  "处方药",
  "临床验证",
  "医学证明",
  "药监",
  "裸价",
  "白菜价",
  "白送",
  "免费送",
  "不用花一分钱",
  "能赚钱",
  "保证收入",
  "日入",
  "日赚",
  "月入过万",
  "升值",
  "独有",
  "垄断",
  "唯一",
  "最好最适合",
  "全球第一",
  "世界最好",
  "不打针",
  "不吃药",
  "不动刀",
  "非手术",
  "药品灌注",
];

export function checkCompliance(variantTexts: string[]): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];

  for (let v = 0; v < variantTexts.length; v++) {
    const text = variantTexts[v];
    if (!text || typeof text !== "string") continue;

    // banned words - 报告所有匹配（限制最多 5 个，避免输出过长）
    let bannedCount = 0;
    const hitBannedWords = new Set<string>();
    for (const word of BANNED_WORDS) {
      if (bannedCount >= 5) break;
      if (text.includes(word)) {
        hitBannedWords.add(word);
        violations.push({
          type: "banned_word",
          severity: "error",
          message: `变体${v + 1} 包含违禁词：${word}`,
          suggestion:
            "考虑删去或替换为合规表达。若这是您产品真实特性请手动审核。",
        });
        bannedCount++;
      }
    }

    // medical claims - 仅当文本含医疗用语且未被 BANNED_WORDS 完全覆盖时报告，避免双重报告
    // BANNED_WORDS 已覆盖：根治/处方药/药品灌注/临床验证 等，这里检测更宽泛的医疗用语
    const medicalRegex = /治愈(?!率)|完全消除|不良反应|药融|病理|临床(?!验证)/i;
    if (medicalRegex.test(text) && !/仅供参考|提示|遵医嘱/.test(text)) {
      // 若命中的医疗词全部已在 BANNED_WORDS 中报告过，则跳过避免重复
      const medicalHit = text.match(medicalRegex);
      const hitWord = medicalHit ? medicalHit[0] : "";
      if (!hitBannedWords.has(hitWord)) {
        violations.push({
          type: "medical_claim",
          severity: "error",
          message: `变体${v + 1} 含医疗暗示：检测到治疗/临床等用语`,
          suggestion: "考虑改为：改善、帮助、体验等非药物表述",
        });
      }
    }

    // essential elements
    const opening = text.slice(0, 45);
    const hasHook =
      /[？?!！]/.test(opening) ||
      /(别再|别急|别错过|别犹豫|你是不是|为什么|是否|千万|注意|真相|居然|竟然|谁说|还在|后悔|没想到|你知道吗|如果你|家人们|只要|立省|限时|到手价)/.test(
        opening,
      ) ||
      /\d+(?:\.\d+)?\s*(元|块|折|倍|分钟|秒|天)/.test(opening);
    const hasCta =
      /(下单|点击|拍下|拍一单|直接拍|上车|链接|立即|马上|现在(?:就|去)?(?:买|下单|抢)|领券|领取|加购|购买|带走)/i.test(
        text,
      );
    if (!hasHook) {
      violations.push({
        type: "missing_element",
        severity: "warning",
        message: `变体${v + 1} 前 3 秒可能没有钩子（强情绪/疑问/利益点），播放率可能偏低`,
      });
    }
    if (!hasCta) {
      violations.push({
        type: "missing_element",
        severity: "warning",
        message: `变体${v + 1} 缺少喊单/行动句，转化效率可能下降`,
      });
    }
  }

  return violations;
}
