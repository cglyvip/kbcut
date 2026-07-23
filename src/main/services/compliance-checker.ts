export interface ComplianceViolation {
  type: 'banned_word' | 'missing_element' | 'medical_claim'
  severity: 'error' | 'warning'
  message: string
  snippet?: string
  suggestion?: string
}

const BANNED_WORDS = [
  '第一品牌', '最好', '第一', '绝对', '永不', '根治', '百分百', '100%有效', '零风险', '完全康复',
  '无效退款保证', '保证治愈', '彻底治好', '永久解决', '绝无副作用', '绝对安全', '永不复发',
  '治疗', '疗效', '药效', '处方药', '临床验证', '医学证明', '药监',
  '裸价', '白菜价', '白送', '免费送', '不用花一分钱',
  '能赚钱', '保证收入', '日入', '日赚', '月入过万', '升值',
  '独有', '垄断', '唯一', '最好最适合', '全球第一', '世界最好',
  '不打针', '不吃药', '不动刀', '非手术', '药品灌注'
]

export function checkCompliance(variantTexts: string[]): ComplianceViolation[] {
  const violations: ComplianceViolation[] = []

  for (let v = 0; v < variantTexts.length; v++) {
    const text = variantTexts[v]
    if (!text) continue

    // banned words
    for (const word of BANNED_WORDS) {
      if (text.includes(word)) {
        violations.push({
          type: 'banned_word',
          severity: 'error',
          message: `变体${v + 1} 包含违禁词：${word}`,
          suggestion: `考虑删去或替换为合规表达。若这是您产品真实特性请手动审核。`
        })
        break
      }
    }

    // medical claims
    if (/治愈|根治|完全消除|不良反应|药融|病理|临床|处方|药品灌注/i.test(text) && !/仅供参考|提示|遵医嘱/.test(text)) {
      violations.push({
        type: 'medical_claim',
        severity: 'error',
        message: `变体${v + 1} 含医疗暗示：检测到治疗/临床等用语`,
        suggestion: '考虑改为：改善、帮助、体验等非药物表述'
      })
    }

    // essential elements
    const hasHook = /^.{0,30}?[别!是否为什么千万注意真相居然谁说]/.test(text) || /^.{0,30}?\?\s*/.test(text)
    const hasCta = /(下单|点击|拍|上车|链接|立即|马上|现在|领|加购)/i.test(text)
    if (!hasHook) {
      violations.push({
        type: 'missing_element',
        severity: 'warning',
        message: `变体${v + 1} 前 3 秒可能没有钩子（强情绪/疑问/利益点），播放率可能偏低`,
      })
    }
    if (!hasCta) {
      violations.push({
        type: 'missing_element',
        severity: 'warning',
        message: `变体${v + 1} 缺少喊单/行动句，转化效率可能下降`,
      })
    }
  }

  return violations
}
