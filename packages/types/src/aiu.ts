export const AIU_SCORING_QUEUE = 'aiu-score'
export const AIU_SCORING_JOB = 'score'

export const AIU_METRIC_KEYS = {
  PROMPT_QUALITY: 'prompt_quality',
  ITERATION_EFFICIENCY: 'iteration_efficiency',
  INDEPENDENT_EDITING: 'independent_editing',
  CONTEXTUAL_RELEVANCE: 'contextual_relevance',
} as const

export type AiuMetricKey = (typeof AIU_METRIC_KEYS)[keyof typeof AIU_METRIC_KEYS]
