import { z } from 'zod'

export const AppGetInfoInputSchema = z.union([z.record(z.unknown()), z.undefined(), z.null()]).optional()

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  isPackaged: z.boolean(),
  platform: z.string()
})

export type ValidatedAppInfo = z.infer<typeof AppInfoSchema>
