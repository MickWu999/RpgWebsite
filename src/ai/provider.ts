/**
 * AI provider 介面：只負責「給 prompt，回傳結構化 JSON」。可替換為其他實作。
 * 驗證、正規化與修復次數由 pipeline 控制，provider 不得自行宣稱驗證通過。
 */
export type ProviderRequest = { systemPrompt: string; prompt: string; jsonSchema: Record<string, unknown> };

export interface StoryProvider {
  readonly name: string;
  /** ok=false 表示此 provider 目前不可用（例如找不到 CLI） */
  available(): Promise<{ ok: boolean; detail: string }>;
  generateJson(req: ProviderRequest): Promise<unknown>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "timeout" | "bad_output" | "failed",
  ) {
    super(message);
  }
}
