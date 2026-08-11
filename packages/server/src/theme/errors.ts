export type ThemeErrorCode =
  | "INVALID_COLOR"
  | "INVALID_PATH"
  | "UNKNOWN_PRESET"
  | "CONTRAST_FAIL"
  | "IMAGE_LOAD_FAILED"
  | "LLM_UNAVAILABLE";

export interface ThemeErrorPayload {
  code: ThemeErrorCode;
  message: string;
  hint?: string;
}

export class ThemeError extends Error {
  readonly payload: ThemeErrorPayload;
  constructor(payload: ThemeErrorPayload) {
    super(payload.message);
    this.name = "ThemeError";
    this.payload = payload;
  }
}
