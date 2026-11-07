import { Worker } from 'bullmq'
import { createEnv, workerAiuEnvSchema } from '@platform/config'
import { createLogger } from '@platform/logger'
import { AIU_SCORING_JOB, AIU_SCORING_QUEUE } from '@platform/types'
import { prisma } from '@platform/db'
import { processScoreJob, type ScoreJobData } from './processor'

const SCORING_TIMEOUT_MS = 30_000

const env = createEnv(workerAiuEnvSchema)
const logger = createLogger('worker-aiu')

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} exceeded ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

const redisUrl = new URL(env.REDIS_URL)

const worker = new Worker<ScoreJobData>(
  AIU_SCORING_QUEUE,
  async (job) => {
    if (job.name !== AIU_SCORING_JOB) {
      throw new Error(`Unsupported job name: ${job.name}`)
    }

    const startedAt = Date.now()
    const result = await withTimeout(
      processScoreJob(job.data, { gatewayUrl: env.LLM_GATEWAY_URL, jwtSecret: env.JWT_SECRET }),
      SCORING_TIMEOUT_MS,
      `AIU scoring job for session ${job.data.session_id}`,
    )
    const durationMs = Date.now() - startedAt

    logger.info(
      {
        session_id: result.sessionId,
        totalScore: result.totalScore,
        duration_ms: durationMs,
        aiu_total_score: result.aiuTotalScore,
        job_id: job.id,
      },
      'AIU scoring completed',
    )

    return result
  },
  {
    connection: {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      username: redisUrl.username || undefined,
      password: redisUrl.password || undefined,
      db: redisUrl.pathname ? Number(redisUrl.pathname.slice(1) || 0) : 0,
      maxRetriesPerRequest: null,
    },
    concurrency: 4,
  },
)

worker.on('failed', (job, err) => {
  logger.error(
    {
      err,
      job_id: job?.id,
      job_name: job?.name,
      session_id: job?.data?.session_id,
      attempts_made: job?.attemptsMade,
    },
    'AIU scoring job failed',
  )
})

worker.on('error', (err) => {
  logger.error({ err }, 'AIU worker error')
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    logger.info({ signal }, 'Shutting down AIU worker')
    await worker.close()
    await prisma.$disconnect()
    process.exit(0)
  })
}
