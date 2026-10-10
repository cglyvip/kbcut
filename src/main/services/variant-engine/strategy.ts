// Variant construction, repair and diversity helpers.
import {
  HOOK_HINTS,
  CTA_HINTS,
  FILLER_HINTS,
  HOOK_STRATEGY_LABELS,
} from "./types";
import type { SimpleSegment, VariantPlan, ProductBrief } from "./types";
import {
  includesAny,
  contentTokens,
  jaccard,
  scoreFluency,
  scoreVariantQuality,
  buildPacingHints,
  classifyHookStrategy,
  splitTerms,
} from "./scoring";

export function enrichVariants(
  variants: VariantPlan[],
  brief?: ProductBrief,
): VariantPlan[] {
  const audiences = splitTerms(brief?.targetAudience);
  const hookStrategies = brief?.hookStrategies?.length
    ? brief.hookStrategies
    : ["mixed"];
  return variants
    .map((variant, index) => {
      const audience =
        brief?.audienceVariants !== false && audiences.length > 0
          ? audiences[index % audiences.length]
          : undefined;
      const plannedHookStrategy = hookStrategies[index % hookStrategies.length];
      const hookStrategy = classifyHookStrategy(
        variant.segments[0]?.text || "",
        brief,
        plannedHookStrategy,
      );
      const quality = scoreVariantQuality(variant, brief);
      const hookLabel = HOOK_STRATEGY_LABELS[hookStrategy] || hookStrategy;
      return {
        ...variant,
        targetAudience: audience,
        abLabel:
          brief?.enableAbMatrix === false
            ? undefined
            : `${hookLabel}-${index + 1}${audience ? `-${audience}` : ""}`,
        pacingHints: buildPacingHints(variant, brief),
        quality,
      };
    })
    .sort(
      (left, right) => (right.quality?.total || 0) - (left.quality?.total || 0),
    );
}

export function buildVariantFromIndexes(
  indexes: number[],
  segments: SimpleSegment[],
  name: string,
  strategy: string,
  id: number,
): VariantPlan | null {
  const selected = indexes.map((idx) => segments[idx]!).filter(Boolean);
  if (selected.length === 0) return null;

  const totalDuration = selected.reduce((sum, s) => sum + s.duration, 0);
  return {
    id,
    name,
    strategy,
    segments: selected,
    totalDuration,
  };
}

export function keepVariantsInDurationRange(
  variants: VariantPlan[],
  minDuration: number,
  maxDuration: number,
): VariantPlan[] {
  return variants.filter(
    (variant) =>
      variant.totalDuration >= minDuration - 0.35 &&
      variant.totalDuration <= maxDuration + 0.35,
  );
}

export function dropLeastHarmful(
  indexes: number[],
  segments: SimpleSegment[],
): number[] {
  if (indexes.length <= 1) return indexes;

  let bestIdx = -1;
  let bestScore = -Infinity;

  for (let i = 0; i < indexes.length; i++) {
    // Prefer not dropping first hook and last CTA unless necessary
    let score = segments[indexes[i]!]!.duration;
    if (i === 0) score -= 100;
    if (i === indexes.length - 1) score -= 40;
    if (includesAny(segments[indexes[i]!]!.text, FILLER_HINTS)) score += 30;
    if (
      includesAny(segments[indexes[i]!]!.text, CTA_HINTS) &&
      i === indexes.length - 1
    )
      score -= 50;
    if (includesAny(segments[indexes[i]!]!.text, HOOK_HINTS) && i === 0)
      score -= 50;

    // Dropping a middle sentence that breaks a tight original pair is costly
    if (i > 0 && i < indexes.length - 1) {
      const prev = indexes[i - 1]!;
      const next = indexes[i + 1]!;
      if (Math.abs(next - prev) === 1) score -= 20;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return indexes.slice(0, -1);
  return indexes.filter((_, i) => i !== bestIdx);
}

export function bestInsertCandidate(
  current: number[],
  segments: SimpleSegment[],
  maxDuration: number,
  currentDuration: number,
): number | null {
  const used = new Set(current);
  let best: { idx: number; score: number } | null = null;

  for (let idx = 0; idx < segments.length; idx++) {
    if (used.has(idx)) continue;
    const nextDur = currentDuration + segments[idx]!.duration;
    if (nextDur > maxDuration + 0.35) continue;

    // Prefer original-neighborhood continuity
    let local = 0;
    for (const c of current) {
      const gap = Math.abs(c - idx);
      if (gap === 1) local += 12;
      else if (gap === 2) local += 7;
      else if (gap <= 4) local += 3;
    }

    // Semantic closeness with last sentence
    const last = current[current.length - 1]!;
    const sim = jaccard(
      contentTokens(segments[last]!.text),
      contentTokens(segments[idx]!.text),
    );
    local += sim * 20;

    // Avoid pure filler
    if (
      includesAny(segments[idx]!.text, FILLER_HINTS) &&
      segments[idx]!.text.length < 10
    )
      local -= 8;
    // Prefer actionable closers near the end
    if (includesAny(segments[idx]!.text, CTA_HINTS)) local += 3;

    // Prefer not re-adding near-duplicates
    for (const c of current) {
      const dup = jaccard(
        contentTokens(segments[c]!.text),
        contentTokens(segments[idx]!.text),
      );
      if (dup > 0.75) local -= 15;
    }

    if (!best || local > best.score) best = { idx, score: local };
  }

  return best?.idx ?? null;
}

export function repairVariantDuration(
  indexes: number[],
  segments: SimpleSegment[],
  minDuration: number,
  maxDuration: number,
): number[] {
  let current = [...indexes];
  let duration = current.reduce((sum, idx) => sum + segments[idx]!.duration, 0);

  // Too long: drop least harmful sentences while protecting hook/cta and flow
  let guard = 0;
  while (duration > maxDuration && current.length > 1 && guard < 40) {
    const next = dropLeastHarmful(current, segments);
    if (next.length === current.length) break;
    current = next;
    duration = current.reduce((sum, idx) => sum + segments[idx]!.duration, 0);
    guard++;
  }

  // Too short: insert only continuity-friendly candidates
  guard = 0;
  while (duration < minDuration && guard < 40) {
    const addIdx = bestInsertCandidate(
      current,
      segments,
      maxDuration,
      duration,
    );
    if (addIdx === null) break;

    // Insert near original neighbors when possible to keep speech natural
    let insertAt = current.length;
    let bestPosScore = -Infinity;
    for (let pos = 0; pos <= current.length; pos++) {
      let posScore = 0;
      const left = pos > 0 ? current[pos - 1]! : null;
      const right = pos < current.length ? current[pos]! : null;
      if (left !== null) {
        const gap = Math.abs(left - addIdx);
        posScore += gap === 1 ? 10 : gap === 2 ? 6 : gap <= 4 ? 2 : -2;
        posScore +=
          jaccard(
            contentTokens(segments[left]!.text),
            contentTokens(segments[addIdx]!.text),
          ) * 8;
      }
      if (right !== null) {
        const gap = Math.abs(right - addIdx);
        posScore += gap === 1 ? 10 : gap === 2 ? 6 : gap <= 4 ? 2 : -2;
        posScore +=
          jaccard(
            contentTokens(segments[addIdx]!.text),
            contentTokens(segments[right]!.text),
          ) * 8;
      }
      // Prefer ending with CTA
      if (
        pos === current.length &&
        includesAny(segments[addIdx]!.text, CTA_HINTS)
      )
        posScore += 5;
      // Prefer not inserting before strong hook opening
      if (
        pos === 0 &&
        includesAny(segments[current[0]!]?.text || "", HOOK_HINTS)
      )
        posScore -= 6;

      if (posScore > bestPosScore) {
        bestPosScore = posScore;
        insertAt = pos;
      }
    }

    current = [
      ...current.slice(0, insertAt),
      addIdx,
      ...current.slice(insertAt),
    ];
    duration += segments[addIdx]!.duration;
    guard++;
  }

  // Final hard clamp if still too long
  guard = 0;
  while (duration > maxDuration && current.length > 1 && guard < 20) {
    current = dropLeastHarmful(current, segments);
    duration = current.reduce((sum, idx) => sum + segments[idx]!.duration, 0);
    guard++;
  }

  return current;
}

export function polishOrderForFluency(
  indexes: number[],
  segments: SimpleSegment[],
): number[] {
  if (indexes.length <= 2) return indexes;

  // Keep chosen set, but gently re-order to improve local continuity.
  // Strategy: start from best hook, then repeatedly append the most coherent remaining sentence.
  const remaining = new Set(indexes);
  let start = indexes[0]!;
  let bestStartScore = -Infinity;
  for (const idx of indexes) {
    let s = includesAny(segments[idx]!.text, HOOK_HINTS) ? 10 : 0;
    s += Math.min(12, segments[idx]!.text.length / 2);
    // Prefer earlier original lines a bit for natural exposition
    s += Math.max(0, 4 - idx * 0.15);
    if (s > bestStartScore) {
      bestStartScore = s;
      start = idx;
    }
  }

  const ordered: number[] = [start];
  remaining.delete(start);

  while (remaining.size > 0) {
    const prev = ordered[ordered.length - 1]!;
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (const idx of remaining) {
      let s = 0;
      const gap = Math.abs(idx - prev);
      if (gap === 1) s += 14;
      else if (gap === 2) s += 9;
      else if (gap <= 4) s += 4;
      else s -= Math.min(8, gap);

      s +=
        jaccard(
          contentTokens(segments[prev]!.text),
          contentTokens(segments[idx]!.text),
        ) * 24;
      if (remaining.size === 1 && includesAny(segments[idx]!.text, CTA_HINTS))
        s += 8;
      if (
        includesAny(segments[idx]!.text, FILLER_HINTS) &&
        segments[idx]!.text.length < 10
      )
        s -= 5;
      // Soft forward bias
      if (idx > prev) s += 2;

      if (s > bestScore) {
        bestScore = s;
        bestIdx = idx;
      }
    }

    if (bestIdx < 0) break;
    ordered.push(bestIdx);
    remaining.delete(bestIdx);
  }

  // If polish hurts fluency, keep original
  return scoreFluency(ordered, segments) >= scoreFluency(indexes, segments)
    ? ordered
    : indexes;
}

export function diversifyFallback(
  segments: SimpleSegment[],
  minDuration: number,
  maxDuration: number,
  count: number,
): VariantPlan[] {
  if (segments.length === 0) return [];

  const hookCandidates = segments
    .map((seg, idx) => ({
      idx,
      score:
        (includesAny(seg.text, HOOK_HINTS) ? 12 : 0) +
        Math.min(20, seg.text.length) * 0.3 +
        (idx < Math.ceil(segments.length * 0.4) ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const variants: VariantPlan[] = [];
  for (let i = 0; i < count; i++) {
    const startIdx = hookCandidates[i % hookCandidates.length]?.idx ?? 0;

    // Grow a continuity-first path from the hook
    const picked: number[] = [startIdx];
    let duration = segments[startIdx]!.duration;
    const used = new Set(picked);

    while (duration < minDuration) {
      const addIdx = bestInsertCandidate(
        picked,
        segments,
        maxDuration,
        duration,
      );
      if (addIdx === null) break;
      // append mostly, but allow continuity insert
      const last = picked[picked.length - 1]!;
      if (Math.abs(addIdx - last) <= 2) picked.push(addIdx);
      else {
        // find neighbor-ish position
        let pos = picked.length;
        for (let p = 1; p < picked.length; p++) {
          if (Math.abs(picked[p]! - addIdx) === 1) {
            pos = p + (picked[p]! < addIdx ? 1 : 0);
            break;
          }
        }
        picked.splice(pos, 0, addIdx);
      }
      used.add(addIdx);
      duration += segments[addIdx]!.duration;
      if (picked.length > segments.length) break;
    }

    // Ensure CTA-ish ending if available
    const cta = segments
      .map((seg, idx) => ({ idx, seg }))
      .filter((x) => !used.has(x.idx) && includesAny(x.seg.text, CTA_HINTS))
      .sort((a, b) => b.seg.text.length - a.seg.text.length)[0];
    if (cta && duration + cta.seg.duration <= maxDuration) {
      picked.push(cta.idx);
    }

    const polished = polishOrderForFluency(picked, segments);
    const repaired = repairVariantDuration(
      polished,
      segments,
      minDuration,
      maxDuration,
    );
    const finalOrder = polishOrderForFluency(repaired, segments);
    const variant = buildVariantFromIndexes(
      finalOrder,
      segments,
      `连贯变体${i + 1}`,
      "本地兜底：优先语义衔接与爆款结构，避免乱序流水账",
      i + 1,
    );
    if (variant) variants.push(variant);
  }

  return variants;
}
