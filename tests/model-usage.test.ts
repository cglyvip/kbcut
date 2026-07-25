import { beforeEach, describe, expect, it, vi } from 'vitest'

const callChatWithFailover = vi.hoisted(() => vi.fn())

vi.mock('../src/main/services/llm-client', () => ({
  callChatWithFailover
}))

import { generateVariants, type SimpleSegment } from '../src/main/services/variant-generator'

const segments: SimpleSegment[] = [
  { start: 0, end: 2, duration: 2, text: '为什么你的桌面总是收拾不干净？' },
  { start: 2, end: 4, duration: 2, text: '东西找不到真的很浪费时间。' },
  { start: 4, end: 6, duration: 2, text: '这个分区收纳盒拿取方便。' },
  { start: 6, end: 8, duration: 2, text: '很多用户使用后都在回购。' },
  { start: 8, end: 10, duration: 2, text: '现在点击链接领券下单。' }
]

const primary = {
  id: 'primary', name: '主 API', baseUrl: 'https://primary.example.com', apiKey: 'key', model: 'configured-primary', enabled: true
}
const backup = {
  id: 'backup', name: '候补 API', baseUrl: 'https://backup.example.com', apiKey: 'key', model: 'configured-backup', enabled: true
}

beforeEach(() => {
  callChatWithFailover.mockReset()
})

describe('variant model usage', () => {
  it('counts generation, JSON repair, and refinement by actual model', async () => {
    callChatWithFailover
      .mockResolvedValueOnce({
        content: 'not-json',
        provider: primary,
        providerIndex: 0,
        failures: [],
        model: 'actual-primary-v2',
        usage: { inputTokens: 1000, outputTokens: 120, estimated: false }
      })
      .mockResolvedValueOnce({
        content: '[{"name":"修复方案","strategy":"格式修复","segmentIndexes":[0,1,2,4]}]',
        provider: backup,
        providerIndex: 1,
        failures: [],
        model: 'actual-backup-v3',
        usage: { inputTokens: 200, outputTokens: 30, estimated: true }
      })
      .mockResolvedValueOnce({
        content: '[{"name":"润顺方案","strategy":"通顺优化","segmentIndexes":[0,1,2,3,4]}]',
        provider: primary,
        providerIndex: 0,
        failures: [],
        model: 'actual-primary-v2',
        usage: { inputTokens: 600, outputTokens: 80, estimated: false }
      })

    const result = await generateVariants({
      segments,
      minDuration: 6,
      maxDuration: 10,
      variantCount: 1,
      providers: [primary, backup],
      allowFallback: false
    })

    expect(callChatWithFailover).toHaveBeenCalledTimes(3)
    expect(result.usedModel).toBe('actual-primary-v2')
    expect(result.usage?.inputTokens).toBe(1800)
    expect(result.usage?.outputTokens).toBe(230)
    expect(result.usage?.byModel).toEqual([
      {
        providerId: 'primary', providerName: '主 API', model: 'actual-primary-v2', requestCount: 2,
        inputTokens: 1600, outputTokens: 200, estimated: false
      },
      {
        providerId: 'backup', providerName: '候补 API', model: 'actual-backup-v3', requestCount: 1,
        inputTokens: 200, outputTokens: 30, estimated: true
      }
    ])
  })
})
