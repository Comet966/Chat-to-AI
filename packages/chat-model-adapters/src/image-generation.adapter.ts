import { z } from 'zod'
import { GeneratedImageSchema, ImageGenerationOutputSchema, GenerateImageCommandSchema, type GeneratedImage, type ImageGenerationInput, type ImageGenerationOutput } from 'chat-contracts'
import type { ImageGenerationModelPort } from 'chat-core'
import type { ProviderConfig } from './provider-config.js'
import { redactSecret, validateProviderConfig } from './provider-config.schema.js'
import { unsupportedCapability } from './multimodal-mapping.js'

export type OpenAIImageEndpoint = 'images' | 'chat-completions'

function invalidResponse(): Error {
  return Object.assign(new Error('Provider returned invalid or empty image data'), { code: 'INVALID_RESPONSE' })
}

function validateInput(input: ImageGenerationInput): ImageGenerationInput {
  const parsed = GenerateImageCommandSchema.safeParse({ ...input, requestId: 'adapter-validation' })
  if (!parsed.success) throw Object.assign(new Error(parsed.error.issues[0].message), { code: 'INVALID_REQUEST' })
  const { requestId: _, ...validInput } = parsed.data
  return validInput
}

function parseOutput(images: GeneratedImage[], text?: string): ImageGenerationOutput {
  const result = ImageGenerationOutputSchema.safeParse({ images, ...(text ? { text } : {}) })
  if (!result.success) throw invalidResponse()
  return result.data
}

function imageFromUrl(url: string): GeneratedImage {
  const inline = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(url)
  const image = inline
    ? { type: 'base64', mediaType: inline[1], data: inline[2] }
    : { type: 'url', url }
  const parsed = GeneratedImageSchema.safeParse(image)
  if (!parsed.success) throw invalidResponse()
  return parsed.data
}

async function postJson(url: string, apiKey: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted()
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal
  })
  if (!response.ok) {
    // Do not surface provider bodies, which may echo credentials or prompts.
    await response.body?.cancel()
    throw Object.assign(new Error(redactSecret(`Provider HTTP ${response.status}`, apiKey)), { status: response.status })
  }
  if (!response.body) throw invalidResponse()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let length = 0
  let text = ''
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 128 * 1024 * 1024) throw invalidResponse()
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  signal.throwIfAborted()
  try { return JSON.parse(text) } catch { throw invalidResponse() }
}

const ImagesResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().optional(), url: z.string().optional() })).min(1),
  output_format: z.enum(['png', 'jpeg', 'webp']).optional()
})
const ImageUrlPartSchema = z.object({ type: z.literal('image_url'), image_url: z.object({ url: z.string() }) })
const ChatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({
    content: z.union([z.string(), z.array(z.union([
      z.object({ type: z.literal('text'), text: z.string() }), ImageUrlPartSchema
    ]))]).nullable().optional(),
    images: z.array(ImageUrlPartSchema).optional()
  }) })).min(1)
})

export class OpenAICompatibleImageGenerationAdapter implements ImageGenerationModelPort {
  public readonly modelId: string
  private readonly baseUrl: string

  constructor(private readonly options: {
    baseUrl: string; apiKey: string; modelId: string; endpoint?: OpenAIImageEndpoint
  }) {
    const raw = options.baseUrl.replace(/\/+$/, '')
    this.baseUrl = raw.endsWith('/v1') ? raw : `${raw}/v1`
    this.modelId = options.modelId
  }

  public async generateImage(input: ImageGenerationInput, signal: AbortSignal): Promise<ImageGenerationOutput> {
    input = validateInput(input)
    const { prompt, n, size, quality, outputFormat } = input
    const headers = { Authorization: `Bearer ${this.options.apiKey}` }
    if (this.options.endpoint === 'chat-completions') {
      if ((n !== undefined && n !== 1) || size || quality || outputFormat) {
        throw unsupportedCapability('Chat-based image generation supports one image request without Images API options')
      }
      const raw = await postJson(`${this.baseUrl}/chat/completions`, this.options.apiKey, headers, {
        model: this.modelId, messages: [{ role: 'user', content: prompt }], modalities: ['text', 'image'], stream: false
      }, signal)
      const parsed = ChatResponseSchema.safeParse(raw)
      if (!parsed.success) throw invalidResponse()
      const message = parsed.data.choices[0].message
      const images = (message.images ?? []).map((part) => imageFromUrl(part.image_url.url))
      let text = typeof message.content === 'string' ? message.content : ''
      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'text') text += part.text
          else images.push(imageFromUrl(part.image_url.url))
        }
      }
      return parseOutput(images, text)
    }
    const raw = await postJson(`${this.baseUrl}/images/generations`, this.options.apiKey, headers, {
      model: this.modelId, prompt, ...(n ? { n } : {}), ...(size ? { size } : {}),
      ...(quality ? { quality } : {}), ...(outputFormat ? { output_format: outputFormat } : {})
    }, signal)
    const parsed = ImagesResponseSchema.safeParse(raw)
    if (!parsed.success) throw invalidResponse()
    return parseOutput(parsed.data.data.map((image) => {
      if (image.b64_json) {
        const format = parsed.data.output_format ?? outputFormat ?? (
          image.b64_json.startsWith('/9j/') ? 'jpeg' : image.b64_json.startsWith('UklGR') ? 'webp' : 'png'
        )
        return { type: 'base64', mediaType: `image/${format}`, data: image.b64_json }
      }
      if (image.url) return imageFromUrl(image.url)
      throw invalidResponse()
    }))
  }
}

const GeminiImageResponseSchema = z.object({
  candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({
    text: z.string().optional(),
    inlineData: z.object({ mimeType: z.string(), data: z.string() }).optional(),
    thought: z.boolean().optional()
  })) }) })).min(1)
})

export class GeminiImageGenerationAdapter implements ImageGenerationModelPort {
  public readonly modelId: string
  private readonly baseUrl: string

  constructor(private readonly options: { baseUrl: string; apiKey: string; modelId: string }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '').replace(/\/v1beta$/, '')
    this.modelId = options.modelId
  }

  public async generateImage(input: ImageGenerationInput, signal: AbortSignal): Promise<ImageGenerationOutput> {
    input = validateInput(input)
    if ((input.n !== undefined && input.n !== 1) || input.size || input.quality || input.outputFormat) {
      throw unsupportedCapability('Native Gemini image generation does not accept Images API options')
    }
    const modelPath = this.modelId.startsWith('models/') ? this.modelId : `models/${this.modelId}`
    const raw = await postJson(`${this.baseUrl}/v1beta/${modelPath}:generateContent`, this.options.apiKey,
      { 'x-goog-api-key': this.options.apiKey }, {
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      }, signal)
    const parsed = GeminiImageResponseSchema.safeParse(raw)
    if (!parsed.success) throw invalidResponse()
    const images: GeneratedImage[] = []
    let text = ''
    for (const part of parsed.data.candidates[0].content.parts) {
      if (part.thought) continue
      if (part.text) text += part.text
      if (part.inlineData) images.push(imageFromUrl(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`))
    }
    return parseOutput(images, text)
  }
}

export function createImageGenerationAdapter(config: ProviderConfig, options: { endpoint?: OpenAIImageEndpoint } = {}): ImageGenerationModelPort {
  const validated = validateProviderConfig(config)
  if (!validated.success) throw new Error(validated.error)
  switch (validated.config.provider) {
    case 'openai-compatible':
      if (options.endpoint !== undefined && !['images', 'chat-completions'].includes(options.endpoint)) {
        throw Object.assign(new Error('Invalid image generation endpoint'), { code: 'INVALID_REQUEST' })
      }
      return new OpenAICompatibleImageGenerationAdapter({ ...validated.config, endpoint: options.endpoint })
    case 'gemini':
      if (options.endpoint !== undefined) throw unsupportedCapability('OpenAI endpoint selection is not valid for native Gemini')
      return new GeminiImageGenerationAdapter(validated.config)
    case 'anthropic':
      throw unsupportedCapability('Anthropic Messages does not provide a text-to-image API')
  }
}
