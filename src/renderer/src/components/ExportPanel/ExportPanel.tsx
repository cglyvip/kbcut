import { useState, useCallback, useEffect } from 'react'
import { useAsrStore, resolveIncludedSegments, buildEditableWords } from '../../stores/useAsrStore'
import { useVideoStore } from '../../stores/useVideoStore'
import { useLlmStore } from '../../stores/useLlmStore'
import { useBatchStore } from '../../stores/useBatchStore'
import { buildFeedbackInsights, mergeModelTokenUsages, useBriefStore, type ModelTokenUsage } from '../../stores/useBriefStore'

interface WordState {
  start: number
  end: number
  text: string
  excluded: boolean
}

interface SentenceState {
  start: number
  end: number
  originalText: string
  words: WordState[]
}

interface VariantState {
  id: number
  name: string
  strategy: string
  sentences: SentenceState[]
  targetAudience?: string
  abLabel?: string
  pacingHints?: string[]
  quality?: {
    total: number
    hook: number
    clarity: number
    pain: number
    sellingPoint: number
    evidence: number
    cta: number
    transition: number
    compliance: number
    warnings: string[]
  }
  editing: boolean
  addingMode: boolean
}

function buildSentenceFromSeg(seg: any): SentenceState {
  const start = Number(seg.start) || 0
  const end = Number(seg.end) || start
  const text = seg.text || ''
  return {
    start,
    end,
    originalText: text,
    words: buildEditableWords(start, end, text, seg.words)
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function compactSegmentsFromSentence(sentence: SentenceState): {
  start: number
  end: number
  text: string
  duration: number
  words: { start: number; end: number; text: string }[]
}[] {
  const segs: {
    start: number
    end: number
    text: string
    duration: number
    words: { start: number; end: number; text: string }[]
  }[] = []

  let cur: {
    start: number
    end: number
    text: string
    duration: number
    words: { start: number; end: number; text: string }[]
  } | null = null

  for (const w of sentence.words) {
    if (w.excluded) {
      if (cur) {
        segs.push(cur)
        cur = null
      }
      continue
    }

    if (cur && Math.abs(w.start - cur.end) < 0.08) {
      cur.end = w.end
      cur.text += w.text
      cur.duration = cur.end - cur.start
      cur.words.push({ start: w.start, end: w.end, text: w.text })
    } else {
      if (cur) segs.push(cur)
      cur = {
        start: w.start,
        end: w.end,
        text: w.text,
        duration: w.end - w.start,
        words: [{ start: w.start, end: w.end, text: w.text }]
      }
    }
  }
  if (cur) segs.push(cur)
  return segs
}

export default function ExportPanel() {
  const asrSegments = useAsrStore((s) => s.segments)
  const videoInfo = useVideoStore((s) => s.videoInfo)

  const {
    providers,
    promoteProvider,
    minDuration,
    maxDuration,
    variantCount,
    topFluencyOnly,
    enableSubtitle,
    exportResolution,
    setMinDuration,
    setMaxDuration,
    setVariantCount,
    setTopFluencyOnly,
    setEnableSubtitle
  } = useLlmStore()

  const [llmNotice, setLlmNotice] = useState<string | null>(null)
  const [modelUsages, setModelUsages] = useState<ModelTokenUsage[]>([])
  const outputDir = useBatchStore((s) => s.outputDir)
  const setOutputDir = useBatchStore((s) => s.setOutputDir)
  const [variants, setVariants] = useState<VariantState[]>([])
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 })
  const [exportResult, setExportResult] = useState<{ files: string[]; errors: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<{
    score: number
    present: string[]
    missing: string[]
    suggestions: string[]
  } | null>(null)

  useEffect(() => {
    const cleanup = window.api.onExportProgress((data) => setExportProgress(data))
    return cleanup
  }, [])

  const includedSegments = resolveIncludedSegments(asrSegments)
  const includedDuration = includedSegments.reduce((sum, s) => sum + s.duration, 0)

  const enabledProviders = providers.filter((p) => p.enabled && p.apiKey.trim() && p.baseUrl.trim() && p.model.trim())

  const handleGenerate = useCallback(async () => {
    if (enabledProviders.length === 0) {
      setError('请先在设置中添加并启用至少一个大模型 API（地址 / Key / 模型）')
      return
    }
    if (minDuration > maxDuration) {
      setError('最小时长不能大于最大时长')
      return
    }
    if (includedSegments.length === 0) {
      setError('没有可用句子，请先完成语音识别或减少排除内容')
      return
    }

    setGenerating(true)
    setError(null)
    setLlmNotice(null)
    setModelUsages([])
    setExportResult(null)
    setDiagnostics(null)
    try {
      const briefState = useBriefStore.getState()
      const brief = {
        ...briefState.brief,
        performanceInsights: buildFeedbackInsights(briefState.feedback)
      }
      const result = await window.api.generateVariants({
        segments: includedSegments,
        minDuration,
        maxDuration,
        variantCount,
        topFluencyOnly,
        topFluencyCount: 3,
        brief,
        providers: enabledProviders
      })

      const currentModelUsages = mergeModelTokenUsages(result.usage?.byModel)
      setModelUsages(currentModelUsages)
      useBriefStore.getState().recordUsage({
        taskId: `single:${videoInfo?.filePath || 'unknown'}`,
        fileName: videoInfo?.fileName || '单条精修',
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
        asrMinutes: useAsrStore.getState().settings.mode === 'online'
          ? Math.max(0, videoInfo?.duration || 0) / 60
          : 0,
        modelUsages: currentModelUsages
      })

      const list = result?.variants || []
      if (!list.length) {
        setError(result?.notice || '未生成可用变体，请调整时长范围后重试')
        setVariants([])
        return
      }
      setDiagnostics(result.diagnostics || null)

      // promote successful provider to first
      if (result.usedProvider?.id) {
        promoteProvider(result.usedProvider.id)
      }

      if (result.usedFallback) {
        setError(result.notice || '全部大模型 API 失败，已使用本地兜底。请更换 API。')
      } else if (result.notice) {
        setLlmNotice(result.notice)
      }

      if (result.failedProviders && result.failedProviders.length > 0 && !result.usedFallback) {
        setLlmNotice(
          `${result.notice || ''}\n已自动跳过失败 API：` +
          result.failedProviders.map((f) => f.name).join('、')
        )
      }

      const mapped = list.map((v: any) => ({
        id: v.id,
        name: v.name,
        strategy: v.strategy,
        sentences: (v.segments || []).map((seg: any) => buildSentenceFromSeg(seg)),
        targetAudience: v.targetAudience,
        abLabel: v.abLabel,
        pacingHints: v.pacingHints,
        quality: v.quality,
        editing: false,
        addingMode: false
      }))
      // UI hard clamp: Top3 mode never keeps more than 3 cards
      setVariants(topFluencyOnly ? mapped.slice(0, 3) : mapped)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setGenerating(false)
    }
  }, [includedSegments, enabledProviders, promoteProvider, minDuration, maxDuration, variantCount, topFluencyOnly, videoInfo])

  const toggleEditing = (vi: number) => {
    setVariants((vs) => vs.map((v, i) => (i === vi ? { ...v, editing: !v.editing, addingMode: false } : v)))
  }

  const toggleAddingMode = (vi: number) => {
    setVariants((vs) => vs.map((v, i) => (i === vi ? { ...v, addingMode: !v.addingMode } : v)))
  }

  const toggleWord = (vi: number, si: number, wi: number) => {
    setVariants((vs) => vs.map((v, vIdx) => {
      if (vIdx !== vi) return v
      const sentence = v.sentences[si]
      const includedCount = sentence.words.filter((w) => !w.excluded).length
      const word = sentence.words[wi]
      if (!word.excluded && includedCount <= 1) return v
      return {
        ...v,
        sentences: v.sentences.map((s, sIdx) => (sIdx !== si ? s : {
          ...s,
          words: s.words.map((w, wIdx) => (wIdx === wi ? { ...w, excluded: !w.excluded } : w))
        }))
      }
    }))
  }

  const addSentence = (vi: number, seg: any) => {
    setVariants((vs) => vs.map((v, i) => {
      if (i !== vi) return v
      const exists = v.sentences.some((s) => s.start === seg.start && s.end === seg.end && s.originalText === seg.text)
      if (exists) return v
      return { ...v, sentences: [...v.sentences, buildSentenceFromSeg(seg)] }
    }))
  }

  const removeSentence = (vi: number, si: number) => {
    setVariants((vs) => vs.map((v, i) => {
      if (i !== vi || v.sentences.length <= 1) return v
      return { ...v, sentences: v.sentences.filter((_, idx) => idx !== si) }
    }))
  }

  const moveSentence = (vi: number, si: number, direction: 'up' | 'down') => {
    setVariants((vs) => vs.map((v, i) => {
      if (i !== vi) return v
      const target = direction === 'up' ? si - 1 : si + 1
      if (target < 0 || target >= v.sentences.length) return v
      const newSentences = [...v.sentences]
      ;[newSentences[si], newSentences[target]] = [newSentences[target], newSentences[si]]
      return { ...v, sentences: newSentences }
    }))
  }

  const deleteVariant = (idx: number) => setVariants((vs) => vs.filter((_, i) => i !== idx))

  const getVariantDuration = (v: VariantState) =>
    v.sentences.reduce(
      (sum, s) => sum + s.words.filter((w) => !w.excluded).reduce((ws, w) => ws + (w.end - w.start), 0),
      0
    )

  const handleSelectDir = useCallback(async () => {
    const dir = await window.api.selectOutputDir()
    if (dir) setOutputDir(dir)
  }, [])

  const handleExport = useCallback(async () => {
    if (!videoInfo || !outputDir || variants.length === 0) return
    setExporting(true)
    setExportProgress({ current: 0, total: variants.length })
    setExportResult(null)
    setError(null)
    try {
      const exportVariants = variants.map((v) => {
        const segs: any[] = []
        for (const sentence of v.sentences) {
          segs.push(...compactSegmentsFromSentence(sentence))
        }
        return {
          id: v.id,
          name: v.name,
          strategy: v.strategy,
          segments: segs,
          totalDuration: segs.reduce((sum: number, seg: any) => sum + seg.duration, 0),
          targetAudience: v.targetAudience,
          abLabel: v.abLabel,
          pacingHints: v.pacingHints,
          quality: v.quality
        }
      }).filter((v) => v.segments.length > 0)

      if (exportVariants.length === 0) {
        setError('没有可导出的有效片段')
        return
      }

      const brief = useBriefStore.getState().brief
      if (brief.enableCompliance) {
        try {
          const texts = exportVariants.map((variant) => variant.segments.map((segment: any) => segment.text).join(''))
          const violations = await window.api.checkCompliance(texts)
          const forbiddenWords = brief.forbiddenWords
            .split(/[，,、；;\n]/)
            .map((word) => word.trim())
            .filter(Boolean)
          const customWarnings = texts.flatMap((text, index) => forbiddenWords
            .filter((word) => text.includes(word))
            .map((word) => `变体${index + 1} 命中自定义禁用词：${word}`))
          const messages = [...violations.map((item) => item.message), ...customWarnings]
          if (messages.length > 0) {
            setLlmNotice(`导出前合规提醒（不阻断导出，请人工复核）：\n${messages.slice(0, 8).join('\n')}`)
          }
        } catch (checkError: any) {
          setLlmNotice(`合规检查未完成，但不会阻断导出：${checkError?.message || String(checkError)}`)
        }
      }

      const result = await window.api.exportVariants({
        videoPath: videoInfo.filePath,
        variants: exportVariants,
        outputDir,
        enableSubtitle,
        exportResolution
      })
      setExportResult(result)
      if (result.files.length === 0) {
        setError(result.errors.join('\n') || '导出失败，未生成文件')
      } else if (result.errors.length > 0) {
        setError(`部分导出失败：成功 ${result.files.length}/${exportVariants.length} 个`)
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setExporting(false)
    }
  }, [videoInfo, outputDir, variants, enableSubtitle, exportResolution])

  const allSentencePool = asrSegments.map((seg) => ({
    start: seg.start,
    end: seg.end,
    text: seg.text,
    words: seg.words.map((w) => ({ start: w.start, end: w.end, text: w.text }))
  }))

  return (
    <div style={styles.container}>
      <div style={styles.settingsCard}>
        <h3 style={styles.cardTitle}>AI 重组爆款 & 导出</h3>
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>大模型 API</h4>
          <div style={styles.apiSummary}>
            <div style={styles.apiLine}>主 API：{providers[0]?.name || '未配置'} / {providers[0]?.model || '-'}</div>
            <div style={styles.apiLine}>已启用 {enabledProviders.length} 个，候补 {Math.max(0, providers.length - 1)} 个</div>
            <div style={styles.apiLine}>请在顶部“设置”中管理 API、测试连通与候补切换</div>
          </div>
          {llmNotice && <p style={styles.noticeMsg}>{llmNotice}</p>}
          {modelUsages.length > 0 && (
            <div style={styles.modelUsageBox}>
              {modelUsages.map((usage) => (
                <div key={`${usage.providerId}:${usage.model}`} style={styles.modelUsageLine}>
                  实际模型：{usage.providerName} / {usage.model}；请求 {usage.requestCount} 次；输入 {usage.inputTokens.toLocaleString()} Token；输出 {usage.outputTokens.toLocaleString()} Token{usage.estimated ? '（服务商未返回完整用量，含估算）' : ''}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>目标时长 & 数量</h4>
          <div style={styles.row}>
            <div style={styles.field}>
              <label style={styles.label}>最小秒</label>
              <input style={styles.input} type="number" min={1} value={minDuration}
                onChange={(e) => setMinDuration(Number(e.target.value) || 1)} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>最大秒</label>
              <input style={styles.input} type="number" min={1} value={maxDuration}
                onChange={(e) => setMaxDuration(Number(e.target.value) || 1)} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>变体数</label>
              <input style={styles.input} type="number" min={1} max={20} value={variantCount}
                onChange={(e) => setVariantCount(Number(e.target.value) || 1)} />
            </div>
          </div>
          <p style={styles.meta}>当前可用素材：{includedSegments.length} 段 / {includedDuration.toFixed(1)}s</p>
          <p style={styles.meta}>生成策略：通顺优先，拒绝流水账乱拼；结构=钩子→痛点→卖点→逼单</p>
          {diagnostics && (
            <div style={styles.diagnosticBox}>
              <strong>素材完整度 {diagnostics.score}</strong>
              {diagnostics.missing.length > 0
                ? <span>缺少：{diagnostics.missing.join('、')}</span>
                : <span>核心投流素材要素已基本齐全</span>}
              {diagnostics.suggestions.length > 0 && <span>建议：{diagnostics.suggestions.slice(0, 2).join('；')}</span>}
            </div>
          )}

          <div style={styles.optionBox}>
            <div style={styles.switchRow} onClick={() => setTopFluencyOnly(!topFluencyOnly)}>
              <div style={{ ...styles.switchTrack, ...(topFluencyOnly ? styles.switchTrackOn : {}) }}>
                <div style={{ ...styles.switchThumb, ...(topFluencyOnly ? styles.switchThumbOn : {}) }} />
              </div>
              <div style={styles.switchTextWrap}>
                <span style={styles.switchTitle}>仅保留通顺度最高 3 条</span>
                <span style={styles.switchDesc}>
                  {topFluencyOnly
                    ? '会多生成候选，最终只留下最通顺、最像爆款的 3 条'
                    : `按设定数量生成 ${variantCount} 条，不做强筛选`}
                </span>
              </div>
            </div>
          </div>
        </div>

        <button
          style={{ ...styles.generateBtn, ...(generating || includedSegments.length === 0 ? styles.btnDisabled : {}) }}
          onClick={handleGenerate}
          disabled={generating || includedSegments.length === 0}
        >{generating
          ? (topFluencyOnly ? '正在优选通顺 Top3...' : '正在重组通顺爆款脚本...')
          : (topFluencyOnly ? 'AI 生成通顺 Top3 爆款' : 'AI 生成通顺爆款变体')}</button>

        {variants.length > 0 && (
          <>
            <div style={styles.divider} />
            <div style={styles.field}>
              <label style={styles.label}>输出文件夹</label>
              <div style={styles.dirRow}>
                <span style={styles.dirText}>{outputDir || '未选择（将记住）'}</span>
                <button style={styles.dirBtn} onClick={handleSelectDir}>{outputDir ? '更换' : '选择'}</button>
              </div>
            </div>

            <div style={styles.exportOptions}>
              <div style={styles.switchRow} onClick={() => setEnableSubtitle(!enableSubtitle)}>
                <div style={{ ...styles.switchTrack, ...(enableSubtitle ? styles.switchTrackOn : {}) }}>
                  <div style={{ ...styles.switchThumb, ...(enableSubtitle ? styles.switchThumbOn : {}) }} />
                </div>
                <div style={styles.switchTextWrap}>
                  <span style={styles.switchTitle}>烧录字幕</span>
                  <span style={styles.switchDesc}>{enableSubtitle ? '导出视频将嵌入字幕' : '导出视频不带字幕'}</span>
                </div>
              </div>
            </div>

            <p style={styles.meta}>当前待导出：{variants.length} 个变体{topFluencyOnly ? '（Top3 模式）' : ''}</p>
            <button
              style={{ ...styles.exportBtn, ...(exporting || !outputDir ? styles.btnDisabled : {}) }}
              onClick={handleExport}
              disabled={exporting || !outputDir}
            >{exporting ? `导出中 ${exportProgress.current}/${exportProgress.total}...` : (enableSubtitle ? `开始导出 ${variants.length} 个（含字幕）` : `开始导出 ${variants.length} 个（无字幕）`)}</button>
          </>
        )}

        {error && <p style={styles.error}>{error}</p>}
        {exportResult && (
          <div style={exportResult.files.length > 0 ? styles.resultBox : styles.resultErrorBox}>
            <p style={exportResult.files.length > 0 ? styles.successText : styles.failureText}>
              {exportResult.files.length > 0 ? `导出完成！成功 ${exportResult.files.length} 个` : '导出失败，未生成文件'}
            </p>
            {exportResult.files.length > 0 && (
              <button style={styles.openBtn} onClick={() => outputDir && window.api.openFolder(outputDir)}>打开文件夹</button>
            )}
            {exportResult.errors.map((err, i) => <p key={i} style={styles.errorItem}>{err}</p>)}
          </div>
        )}
      </div>

      {variants.length > 0 && (
        <div style={styles.variantCard}>
          <h3 style={styles.cardTitle}>
            变体方案
            <span style={styles.tipText}> 可删词/调序；评分基于生成初稿，编辑后导出前会再次检查合规</span>
          </h3>
          <div style={styles.variantList}>
            {variants.map((v, vi) => {
              const duration = getVariantDuration(v)
              const inRange = duration >= minDuration && duration <= maxDuration
              return (
                <div key={vi} style={styles.variantItem}>
                  <div style={styles.variantHeader}>
                    <span style={styles.variantName}>{v.name}</span>
                    <span style={{
                      ...styles.variantDuration,
                      color: inRange ? '#52c41a' : '#fa8c16'
                    }}>{duration.toFixed(1)}s {inRange ? '✓' : '⚠'}</span>
                    {v.quality && <span style={styles.qualityBadge}>爆款评分 {v.quality.total}</span>}
                    <button style={styles.editBtn} onClick={() => toggleEditing(vi)}>{v.editing ? '完成' : '编辑'}</button>
                    <button style={styles.deleteBtn} onClick={() => deleteVariant(vi)}>删除变体</button>
                  </div>
                  <p style={styles.variantStrategy}>{v.strategy}</p>
                  {(v.abLabel || v.targetAudience) && (
                    <div style={styles.variantTags}>
                      {v.abLabel && <span style={styles.abTag}>{v.abLabel}</span>}
                      {v.targetAudience && <span style={styles.audienceTag}>人群：{v.targetAudience}</span>}
                    </div>
                  )}
                  {v.quality && (
                    <div style={styles.scoreGrid}>
                      <span>钩子 {v.quality.hook}</span><span>清晰 {v.quality.clarity}</span>
                      <span>痛点 {v.quality.pain}</span><span>卖点 {v.quality.sellingPoint}</span>
                      <span>证据 {v.quality.evidence}</span><span>转化 {v.quality.cta}</span>
                      <span>连贯 {v.quality.transition}</span><span>合规 {v.quality.compliance}</span>
                    </div>
                  )}
                  {v.pacingHints && v.pacingHints.length > 0 && (
                    <div style={styles.pacingText}>字幕/画面节奏：{v.pacingHints.join('；')}</div>
                  )}
                  {v.quality?.warnings && v.quality.warnings.length > 0 && (
                    <div style={styles.qualityWarning}>质量/合规提醒：{v.quality.warnings.join('；')}</div>
                  )}

                  {v.editing ? (
                    <div>
                      {v.sentences.map((sent, si) => (
                        <div key={si} style={styles.sentenceBlock}>
                          <div style={styles.sentenceHeader}>
                            <span style={styles.sentenceTime}>{formatTime(sent.start)}</span>
                            <button
                              style={{ ...styles.moveBtn, ...(si === 0 ? styles.moveBtnDisabled : {}) }}
                              onClick={() => si > 0 && moveSentence(vi, si, 'up')}
                              disabled={si === 0}
                            >上移</button>
                            <button
                              style={{ ...styles.moveBtn, ...(si === v.sentences.length - 1 ? styles.moveBtnDisabled : {}) }}
                              onClick={() => si < v.sentences.length - 1 && moveSentence(vi, si, 'down')}
                              disabled={si === v.sentences.length - 1}
                            >下移</button>
                            {v.sentences.length > 1 && (
                              <button style={styles.removeSentBtn} onClick={() => removeSentence(vi, si)}>移除</button>
                            )}
                          </div>
                          <div style={styles.wordFlow}>
                            {sent.words.map((w, wi) => {
                              const includedCount = sent.words.filter((x) => !x.excluded).length
                              const canExclude = includedCount > 1
                              return (
                                <span
                                  key={wi}
                                  style={{
                                    ...styles.word,
                                    ...(w.excluded ? styles.wordExcluded : {}),
                                    cursor: w.excluded || canExclude ? 'pointer' : 'default'
                                  }}
                                  onClick={() => (w.excluded || canExclude) && toggleWord(vi, si, wi)}
                                  title={w.excluded ? '点击恢复' : canExclude ? '点击删除' : '至少保留一个词'}
                                >{w.text}</span>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                      <button style={styles.addSentBtn} onClick={() => toggleAddingMode(vi)}>
                        {v.addingMode ? '关闭句子池' : '+ 添加句子'}
                      </button>
                      {v.addingMode && (
                        <div style={styles.sentencePool}>
                          <p style={styles.poolTitle}>点击添加到此变体：</p>
                          {allSentencePool.map((seg, idx) => {
                            const exists = v.sentences.some((s) => s.start === seg.start && s.end === seg.end && s.originalText === seg.text)
                            return (
                              <div
                                key={idx}
                                style={{ ...styles.poolItem, ...(exists ? styles.poolItemDisabled : {}) }}
                                onClick={() => !exists && addSentence(vi, seg)}
                              >
                                <span style={styles.poolTime}>{formatTime(seg.start)}</span>
                                <span style={styles.poolText}>{seg.text}</span>
                                {exists && <span style={styles.poolTag}>已添加</span>}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={styles.previewText}>
                      {v.sentences.map((s) => s.words.filter((w) => !w.excluded).map((w) => w.text).join('')).join(' ')}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '0 40px 24px', display: 'flex', gap: 24, alignItems: 'flex-start' },
  settingsCard: {
    width: 320, background: '#fff', borderRadius: 12, padding: 24,
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)', flexShrink: 0
  },
  variantCard: {
    flex: 1, background: '#fff', borderRadius: 12, padding: 24,
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)', maxHeight: 720,
    overflow: 'hidden', display: 'flex', flexDirection: 'column'
  },
  cardTitle: { fontSize: 16, fontWeight: 600, color: '#262626', marginBottom: 16, marginTop: 0, display: 'flex', alignItems: 'center', gap: 12 },
  tipText: { fontSize: 12, color: '#8c8c8c', fontWeight: 400 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: 600, color: '#8c8c8c', marginBottom: 8, marginTop: 0 },
  formGroup: { display: 'flex', flexDirection: 'column', gap: 10 },
  row: { display: 'flex', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1 },
  label: { fontSize: 12, color: '#8c8c8c' },
  input: { padding: '7px 10px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  meta: { fontSize: 12, color: '#8c8c8c', margin: '8px 0 0' },
  diagnosticBox: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10, padding: 10, background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8, fontSize: 12, color: '#7c5b00', lineHeight: 1.5 },
  optionBox: { marginTop: 12, padding: 12, background: '#f7fbff', border: '1px solid #d6e4ff', borderRadius: 8 },
  exportOptions: { marginTop: 12, padding: 12, background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8 },
  switchRow: { display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', userSelect: 'none' as const },
  switchTrack: { width: 42, height: 24, borderRadius: 12, background: '#d9d9d9', position: 'relative' as const, transition: 'all 0.2s', flexShrink: 0 },
  switchTrackOn: { background: '#1677ff' },
  switchThumb: { width: 18, height: 18, borderRadius: 9, background: '#fff', position: 'absolute' as const, top: 3, left: 3, transition: 'all 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' },
  switchThumbOn: { left: 21 },
  switchTextWrap: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  switchTitle: { fontSize: 14, color: '#262626', fontWeight: 500 },
  switchDesc: { fontSize: 12, color: '#8c8c8c' },
  providerList: { display: 'flex', flexDirection: 'column' as const, gap: 10, marginTop: 8 },
  providerCard: { border: '1px solid #f0f0f0', borderRadius: 8, padding: 10, background: '#fcfcfc' },
  providerHeader: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 },
  providerBadge: { fontSize: 11, color: '#fff', background: '#1677ff', borderRadius: 4, padding: '2px 6px', flexShrink: 0 },
  enableLabel: { fontSize: 12, color: '#595959', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' as const },
  providerActions: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' as const },
  miniBtn: { fontSize: 12, color: '#1677ff', background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' },
  miniDangerBtn: { fontSize: 12, color: '#ff4d4f', background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' },
  testMsg: { fontSize: 12, color: '#595959', marginTop: 8, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const },
  apiSummary: { marginTop: 8, padding: 10, background: '#f7fbff', border: '1px solid #d6e4ff', borderRadius: 8 },
  apiLine: { fontSize: 12, color: '#595959', lineHeight: 1.7 },
  noticeMsg: { fontSize: 12, color: '#1677ff', marginTop: 8, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const },
  modelUsageBox: { marginTop: 8, padding: 10, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8 },
  modelUsageLine: { fontSize: 12, color: '#35631d', lineHeight: 1.6, wordBreak: 'break-all' as const },
  generateBtn: { width: '100%', padding: '10px 0', background: '#52c41a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 15, fontWeight: 500 },
  exportBtn: { width: '100%', padding: '10px 0', background: '#1677ff', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 15, fontWeight: 500, marginTop: 12 },
  btnDisabled: { background: '#d9d9d9', cursor: 'not-allowed' },
  divider: { height: 1, background: '#f0f0f0', margin: '16px 0' },
  dirRow: { display: 'flex', gap: 8, alignItems: 'center' },
  dirText: { flex: 1, fontSize: 13, color: '#595959', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  dirBtn: { padding: '4px 12px', background: '#fff', border: '1px solid #d9d9d9', borderRadius: 4, cursor: 'pointer', fontSize: 13, flexShrink: 0 },
  error: { fontSize: 13, color: '#ff4d4f', marginTop: 8, wordBreak: 'break-all' as const },
  resultBox: { marginTop: 16, padding: 16, background: '#f6ffed', borderRadius: 8, border: '1px solid #b7eb8f' },
  resultErrorBox: { marginTop: 16, padding: 16, background: '#fff1f0', borderRadius: 8, border: '1px solid #ffa39e' },
  successText: { fontSize: 14, color: '#52c41a', fontWeight: 500, margin: 0 },
  failureText: { fontSize: 14, color: '#cf1322', fontWeight: 600, margin: 0 },
  openBtn: { marginTop: 8, padding: '6px 16px', background: '#52c41a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 },
  errorItem: { fontSize: 12, color: '#ff4d4f', margin: '4px 0' },
  variantList: { flex: 1, overflowY: 'auto' as const },
  variantItem: { padding: '16px 0', borderBottom: '1px solid #f0f0f0' },
  variantHeader: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 },
  variantName: { fontSize: 15, fontWeight: 600, color: '#262626' },
  variantDuration: { fontSize: 13, fontFamily: 'monospace', marginRight: 'auto' },
  qualityBadge: { fontSize: 11, color: '#fff', background: '#1677ff', borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' as const },
  editBtn: { fontSize: 12, color: '#1677ff', background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' },
  deleteBtn: { fontSize: 12, color: '#ff4d4f', background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' },
  variantStrategy: { fontSize: 13, color: '#595959', margin: '4px 0 8px', lineHeight: 1.5 },
  variantTags: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 8 },
  abTag: { fontSize: 11, color: '#531dab', background: '#f9f0ff', border: '1px solid #d3adf7', borderRadius: 999, padding: '2px 8px' },
  audienceTag: { fontSize: 11, color: '#006d75', background: '#e6fffb', border: '1px solid #87e8de', borderRadius: 999, padding: '2px 8px' },
  scoreGrid: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: 8, fontSize: 11, color: '#595959' },
  pacingText: { marginBottom: 8, padding: '7px 9px', fontSize: 11, lineHeight: 1.55, color: '#096dd9', background: '#e6f4ff', borderRadius: 6 },
  qualityWarning: { marginBottom: 8, padding: '7px 9px', fontSize: 11, lineHeight: 1.55, color: '#cf1322', background: '#fff1f0', borderRadius: 6 },
  previewText: { fontSize: 14, color: '#262626', margin: 0, lineHeight: 1.8 },
  sentenceBlock: { marginBottom: 12, padding: '8px 12px', background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' },
  sentenceHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  sentenceTime: { fontSize: 11, color: '#8c8c8c', fontFamily: 'monospace', background: '#f0f0f0', padding: '1px 6px', borderRadius: 3 },
  removeSentBtn: { fontSize: 11, color: '#ff4d4f', background: 'none', border: '1px solid #ffa39e', borderRadius: 3, padding: '1px 8px', cursor: 'pointer' },
  moveBtn: { fontSize: 11, color: '#595959', background: '#fff', border: '1px solid #d9d9d9', borderRadius: 3, padding: '1px 8px', cursor: 'pointer' },
  moveBtnDisabled: { color: '#d9d9d9', cursor: 'default', borderColor: '#f0f0f0' },
  wordFlow: { display: 'flex', flexWrap: 'wrap' as const, gap: 1, userSelect: 'none' as const, lineHeight: 2.2 },
  word: { padding: '2px 3px', borderRadius: 3, fontSize: 15, color: '#262626', transition: 'all 0.15s' },
  wordExcluded: { textDecoration: 'line-through', color: '#bfbfbf', background: '#fff1f0' },
  addSentBtn: { marginTop: 8, fontSize: 13, color: '#1677ff', background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', width: '100%' },
  sentencePool: { marginTop: 8, padding: 12, background: '#f6ffed', borderRadius: 8, border: '1px solid #b7eb8f', maxHeight: 200, overflowY: 'auto' as const },
  poolTitle: { fontSize: 12, color: '#52c41a', margin: '0 0 8px', fontWeight: 500 },
  poolItem: { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 4, cursor: 'pointer', marginBottom: 4, background: '#fff', border: '1px solid #f0f0f0' },
  poolItemDisabled: { opacity: 0.5, cursor: 'default', background: '#fafafa' },
  poolTime: { fontSize: 11, color: '#8c8c8c', fontFamily: 'monospace', flexShrink: 0 },
  poolText: { flex: 1, fontSize: 13, color: '#262626' },
  poolTag: { fontSize: 11, color: '#52c41a', background: '#f6ffed', padding: '1px 6px', borderRadius: 3 }
}



