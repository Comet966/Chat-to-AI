import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { z } from 'zod'

// Load environment variables from .env
dotenv.config({ path: resolve(process.cwd(), '.env') })

export const AppConfigSchema = z.object({
  aiApiBaseUrl: z.string().url('AI_API_BASE_URL must be a valid URL'),
  aiApiKey: z.string().min(1, 'AI_API_KEY must not be empty'),
  aiModelId: z.string().min(1, 'AI_MODEL_ID must not be empty')
})

export type AppConfig = z.infer<typeof AppConfigSchema>

export function loadAppConfig(): AppConfig {
  const rawConfig = {
    aiApiBaseUrl: process.env.AI_API_BASE_URL,
    aiApiKey: process.env.AI_API_KEY,
    aiModelId: process.env.AI_MODEL_ID
  }

  const parseResult = AppConfigSchema.safeParse(rawConfig)
  if (!parseResult.success) {
    const errorDetails = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
    throw new Error(`Configuration error: missing or invalid AI settings (${errorDetails})`)
  }

  return parseResult.data
}
