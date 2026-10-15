import type { DesktopImageGenerationApi } from '../../../shared/image-generation.contract.js'

/** UI contract only; no provider clients, credentials, Electron, or filesystem access. */
export interface ImageGenerationUiPort extends DesktopImageGenerationApi {}
