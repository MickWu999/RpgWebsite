import { z } from "zod";

/** 轉成 Claude Code CLI 的 --json-schema 可接受的格式（draft-7，不帶 $schema 宣告） */
export function toCliJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}
