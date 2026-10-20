import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProviderError, type ProviderRequest, type StoryProvider } from "./provider";

/**
 * 以本機 Claude Code CLI（headless：`claude -p`）作為 AI provider，使用本機已登入的 Claude Code 帳號，不需要 API key。
 * - 停用所有工具（--tools ""）：模型只能回傳資料，不能讀寫檔案或執行指令。
 * - 以 --json-schema 要求結構化輸出，結果仍由 pipeline 驗證。
 * - 在空的暫存目錄執行，且不載入任何專案設定或 MCP，避免把本機檔案帶進 prompt。
 * 注意：只能在本機執行，無法在 Cloudflare 等雲端環境使用。
 */
export class ClaudeCodeProvider implements StoryProvider {
  readonly name = "claude-code";

  constructor(
    private readonly bin = process.env.CLAUDE_CLI_PATH || "claude",
    private readonly model = process.env.CLAUDE_MODEL || "",
    private readonly timeoutMs = Number(process.env.CLAUDE_TIMEOUT_MS) || 240_000,
  ) {}

  async available() {
    try {
      const out = await this.run(["--version"], "", 15_000);
      return { ok: true, detail: out.trim() };
    } catch (e) {
      return { ok: false, detail: `找不到 Claude Code CLI（${this.bin}）：${(e as Error).message}` };
    }
  }

  async generateJson(req: ProviderRequest): Promise<unknown> {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(req.jsonSchema),
      "--system-prompt",
      req.systemPrompt,
      "--tools",
      "",
      "--no-session-persistence",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--disable-slash-commands",
    ];
    if (this.model) args.push("--model", this.model);
    const stdout = await this.run(args, req.prompt, this.timeoutMs);

    let envelope: { is_error?: boolean; result?: string; structured_output?: unknown; subtype?: string };
    try {
      envelope = JSON.parse(stdout);
    } catch {
      throw new ProviderError("Claude Code 回傳的不是 JSON", "bad_output");
    }
    if (envelope.is_error) throw new ProviderError(`Claude Code 執行失敗：${envelope.result ?? envelope.subtype ?? "未知錯誤"}`, "failed");
    if (envelope.structured_output !== undefined) return envelope.structured_output;
    try {
      return JSON.parse(envelope.result ?? "");
    } catch {
      throw new ProviderError("Claude Code 沒有回傳結構化資料", "bad_output");
    }
  }

  private run(args: string[], stdin: string, timeoutMs: number): Promise<string> {
    const cwd = mkdtempSync(path.join(tmpdir(), "rpg-ai-"));
    return new Promise<string>((resolve, reject) => {
      const child = spawn(this.bin, args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new ProviderError(`AI 生成逾時（${Math.round(timeoutMs / 1000)} 秒）`, "timeout"));
      }, timeoutMs);
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new ProviderError(e.message, "unavailable"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        rmSync(cwd, { recursive: true, force: true });
        if (code === 0) resolve(stdout);
        else reject(new ProviderError(`Claude Code 結束碼 ${code}：${(stderr || stdout).slice(0, 500)}`, "failed"));
      });
      child.stdin.end(stdin);
    });
  }
}
