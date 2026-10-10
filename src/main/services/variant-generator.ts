// Re-export all functionality from the new variant-engine module
// This maintains backward compatibility for existing imports

// Hook strategy classification for A/B testing
export { classifyHookStrategy } from "./variant-engine/scoring";

export { generateVariants } from "./variant-engine/index";

// Export types
export type {
  SimpleSegment,
  VariantPlan,
  VariantQuality,
  MaterialDiagnostics,
  ProductBrief,
  GenerateOptions,
  GenerateVariantsResult,
  ModelTokenUsage,
} from "./variant-engine/types";

// Export constants
export {
  HOOK_HINTS,
  CTA_HINTS,
  FILLER_HINTS,
  EVIDENCE_HINTS,
  PAIN_HINTS,
  BENEFIT_HINTS,
  HOOK_STRATEGY_LABELS,
  TEMPLATE_LABELS,
} from "./variant-engine/types";

// Export utility functions if needed by tests
export {
  includesAny,
  contentTokens,
  jaccard,
  scoreFluency,
  scoreDuration,
  scoreVariantQuality,
  diagnoseMaterial,
} from "./variant-engine/scoring";
