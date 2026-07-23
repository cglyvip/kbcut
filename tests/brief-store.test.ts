import { beforeEach, describe, expect, it } from 'vitest'
import { useBriefStore, type ProductBrief } from '../src/renderer/src/stores/useBriefStore'

const baseBrief: ProductBrief = {
  productName: '',
  price: '',
  targetAudience: '',
  painPoints: '',
  coreSellingPoints: '',
  evidence: '',
  offer: '',
  cta: '',
  forbiddenWords: '',
  extraPrompt: '',
  templateId: 'general',
  hookStrategies: ['pain', 'benefit', 'curiosity'],
  audienceVariants: true,
  enableCompliance: true,
  enableSemanticCheck: true,
  enableAbMatrix: true,
  enablePacing: false,
  subtitleKeywords: '',
  llmInputPricePerMillion: 0,
  llmOutputPricePerMillion: 0,
  asrPricePerMinute: 0
}

beforeEach(() => {
  useBriefStore.setState({
    brief: { ...baseBrief },
    feedback: [],
    usage: [],
    hydrated: true
  })
})

describe('growth workbench store', () => {
  it('clears template-specific instructions when switching back to general', () => {
    useBriefStore.getState().applyTemplate('beauty')
    expect(useBriefStore.getState().brief.extraPrompt).toContain('成分')

    useBriefStore.getState().applyTemplate('general')
    expect(useBriefStore.getState().brief.extraPrompt).toBe('')
  })

  it('keeps configured prices when resetting product strategy', () => {
    useBriefStore.getState().setBrief({
      productName: '测试商品',
      llmInputPricePerMillion: 2.5,
      llmOutputPricePerMillion: 8,
      asrPricePerMinute: 0.04
    })

    useBriefStore.getState().resetBrief()
    const brief = useBriefStore.getState().brief
    expect(brief.productName).toBe('')
    expect(brief.llmInputPricePerMillion).toBe(2.5)
    expect(brief.llmOutputPricePerMillion).toBe(8)
    expect(brief.asrPricePerMinute).toBe(0.04)
  })

  it('accumulates repeated model usage without double-counting ASR minutes', () => {
    const store = useBriefStore.getState()
    store.recordUsage({ taskId: 'task-1', fileName: 'a.mp4', inputTokens: 1000, outputTokens: 200, asrMinutes: 2 })
    store.recordUsage({ taskId: 'task-1', fileName: 'a.mp4', inputTokens: 500, outputTokens: 100, asrMinutes: 2 })

    const usage = useBriefStore.getState().usage
    expect(usage).toHaveLength(1)
    expect(usage[0].inputTokens).toBe(1500)
    expect(usage[0].outputTokens).toBe(300)
    expect(usage[0].asrMinutes).toBe(2)
  })
})
