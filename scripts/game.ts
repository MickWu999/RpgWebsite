import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { providerFromEnv } from "@/ai/pipeline";
import { projectDigest, reviewProject } from "@/ai/review";
import { manifestEntry, walkableFromTerrain } from "@/game/assets";
import { runPlaytest } from "@/game/playtest";
import { assessQuality } from "@/game/quality";
import { SCHEMA_VERSION, gameProjectSchema, type GameProject } from "@/game/schema";
import { validateProject } from "@/game/validate";
import { applyOps } from "@/studio/ops";
import { loadLocalEnv } from "./env";

/**
 * 給 AI agent（例如 VS Code 裡的 Claude Code）使用的遊戲製作 CLI。規範見 docs/ai-development-spec.md。
 * 遊戲原始檔放在 content/<id>/：story.md（故事）、treatment.md（劇本大綱）、project.json（遊戲資料）、review.json（審查結果）。
 *
 *   npm run game -- new <id> --title <名稱> [--genre fantasy]   建立空白專案（含一張起始地圖、主角、一個佔位結局）
 *   npm run game -- inspect <id>                                 以劇本形式輸出目前內容（給 agent 閱讀）
 *   npm run game -- apply <id> <ops.json>                        套用 Studio 操作（成功且驗證通過才寫檔）
 *   npm run game -- check <id>                                   驗證＋自動試玩＋品質指標（JSON）
 *   npm run game -- review <id>                                  獨立 AI 審查（另開一次 Claude Code，看不到製作過程）
 *   npm run game -- publish <id>                                 check 與 review 都通過才發布到 public/games/<id>/
 *
 * 遠端模式（操作線上的 Studio 後台；需在 .env.local 設定 STUDIO_URL 與 STUDIO_TOKEN，token 在 Studio「AI 協作」產生）：
 *   npm run game -- remote list
 *   npm run game -- remote create <名稱> [--template blank|demo]
 *   npm run game -- remote pull <id>               下載到 content/<id>/project.json（含版本號）
 *   npm run game -- remote apply <id> <ops.json>   送出操作（自動帶目前版本號，避免覆蓋人的修改）
 *   npm run game -- remote check <id>
 *   npm run game -- remote versions <id>
 *   npm run game -- remote publish <id>            Studio 端會再做一次檢查；API Token 不能略過品質指標
 * 所有子指令都輸出 JSON；結束碼 0＝成功／通過，2＝失敗，1＝用法錯誤。
 */

loadLocalEnv();
const CONTENT = "content";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { title: { type: "string" }, genre: { type: "string" }, demo: { type: "boolean" }, template: { type: "string" } },
});
const [command, id, arg] = positionals;

/** 遠端模式：以 API Token 呼叫 Studio 後台 */
async function remote(sub: string | undefined, target: string | undefined, file: string | undefined) {
  const base = process.env.STUDIO_URL?.replace(/\/$/, "");
  const token = process.env.STUDIO_TOKEN;
  if (!base || !token) fail("遠端模式需要在 .env.local 設定 STUDIO_URL 與 STUDIO_TOKEN（token 在 Studio「AI 協作」產生）", 1);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return { status: res.status, ok: res.ok, data };
  };
  const done = (r: { ok: boolean; data: unknown }) => out(r.data, r.ok ? 0 : 2);
  switch (sub) {
    case "list":
      return done(await api("GET", "/api/projects"));
    case "create":
      if (!target) fail("用法：npm run game -- remote create <名稱> [--template blank|demo]", 1);
      return done(await api("POST", "/api/projects", { title: target, template: values.template === "demo" ? "demo" : "blank" }));
    case "pull": {
      if (!target) fail("用法：npm run game -- remote pull <id>", 1);
      const r = await api("GET", `/api/projects/${target}`);
      if (!r.ok) return done(r);
      mkdirSync(dir(target!), { recursive: true });
      writeFileSync(projectFile(target!), JSON.stringify(r.data.project, null, 2) + "\n");
      writeFileSync(path.join(dir(target!), ".studio-version"), String(r.data.version));
      return out({ ok: true, pulled: projectFile(target!), version: r.data.version }, 0);
    }
    case "apply": {
      if (!target || !file) fail("用法：npm run game -- remote apply <id> <ops.json>", 1);
      const ops = JSON.parse(readFileSync(file!, "utf8"));
      const cur = await api("GET", `/api/projects/${target}`);
      if (!cur.ok) return done(cur);
      const r = await api("POST", `/api/projects/${target}/ops`, { ops: Array.isArray(ops) ? ops : [ops], baseVersion: cur.data.version });
      return done(r);
    }
    case "check":
      return done(await api("GET", `/api/projects/${target}/check`));
    case "versions":
      return done(await api("GET", `/api/projects/${target}/versions`));
    case "publish":
      return done(await api("POST", `/api/projects/${target}/publish`, {}));
    default:
      fail("用法：npm run game -- remote <list|create|pull|apply|check|versions|publish> …", 1);
  }
}

const out = (data: unknown, code: number) => {
  console.log(JSON.stringify(data, null, 2));
  process.exit(code);
};
const fail = (message: string, code = 2) => out({ ok: false, error: message }, code);
const dir = (gameId: string) => path.join(CONTENT, gameId);
const projectFile = (gameId: string) => path.join(dir(gameId), "project.json");

/** 製作中的專案允許暫時不完整（例如結局還沒接上），所以只檢查 schema 格式；完整驗證由 check／publish 把關 */
function load(gameId: string): GameProject {
  if (!existsSync(projectFile(gameId))) fail(`找不到 ${projectFile(gameId)}，請先執行 npm run game -- new ${gameId}`);
  const parsed = gameProjectSchema.safeParse(JSON.parse(readFileSync(projectFile(gameId), "utf8")));
  if (!parsed.success) out({ ok: false, error: "project.json 格式錯誤", issues: parsed.error.issues.slice(0, 20) }, 2);
  return parsed.data!;
}

function check(project: GameProject) {
  const validation = validateProject(project);
  if (!validation.project) return { ok: false, validation: { errors: validation.errors, warnings: validation.warnings }, playtest: null, quality: null };
  const playtest = runPlaytest(project);
  const quality = assessQuality(project, playtest, { checkDuration: !values.demo });
  return {
    ok: playtest.ok && quality.blocking.length === 0,
    validation: { errors: [], warnings: validation.warnings },
    playtest: { ok: playtest.ok, truncated: playtest.truncated, statesExplored: playtest.statesExplored, issues: playtest.issues, endings: playtest.endings.map((e) => ({ title: e.title, reachable: e.reachable, steps: e.steps?.length })) },
    quality,
  };
}

async function main() {
  if (command === "remote") return remote(id, arg, positionals[3]);
  if (!command || (command !== "list" && !id)) fail("用法：npm run game -- <new|inspect|apply|check|review|publish> <id> …", 1);
  if (id && !/^[a-z0-9-]{3,48}$/.test(id)) fail("遊戲 ID 只能用小寫英數字與連字號（3～48 字）", 1);

  switch (command) {
    case "new": {
      if (existsSync(projectFile(id))) fail(`${projectFile(id)} 已存在`);
      const terrain = Array.from({ length: 16 }, (_, y) => Array.from({ length: 24 }, (_, x) => (x === 0 || y === 0 || x === 23 || y === 15 ? "T" : ".")).join(""));
      const project: GameProject = {
        schemaVersion: SCHEMA_VERSION,
        id,
        title: values.title ?? id,
        description: "（待補）",
        genre: (values.genre as GameProject["genre"]) ?? "fantasy",
        startSceneId: "start",
        player: { name: "主角", spriteAssetId: "char_hero", startPosition: { sceneId: "start", x: 2, y: 2 }, baseStats: { hp: 100, level: 1, xp: 0 }, inventoryItemIds: [] },
        scenes: [{ id: "start", name: "起點", width: 24, height: 16, tileSize: 40, tilesetId: "tileset_tiny_town", terrain, walkable: walkableFromTerrain(terrain), exits: [], npcIds: [], locations: [], pickups: [], interactables: [], music: "peaceful" }],
        npcs: [],
        dialogues: [],
        quests: [],
        items: [],
        endings: [{ id: "end_placeholder", title: "（佔位結局）", text: "請以 ending.upsert 取代這個佔位結局。", condition: { type: "flag_equals", flag: "placeholder_end", value: true } }],
        assetManifest: { assets: ["tileset_tiny_town", "char_hero"].map(manifestEntry) },
      };
      mkdirSync(dir(id), { recursive: true });
      writeFileSync(projectFile(id), JSON.stringify(project, null, 2) + "\n");
      if (!existsSync(path.join(dir(id), "story.md"))) writeFileSync(path.join(dir(id), "story.md"), `# ${project.title}\n\n（把原始故事寫在這裡）\n`);
      return out({ ok: true, created: projectFile(id), next: "寫 story.md 與 treatment.md，然後逐章用 apply 實作" }, 0);
    }
    case "inspect": {
      const project = load(id);
      const valid = validateProject(project);
      console.log(projectDigest(project, valid.project ? runPlaytest(project) : { ok: false, statesExplored: 0, truncated: false, endings: [], softlocks: [], issues: [] }));
      if (!valid.isValid) console.log(`\n## 目前的驗證錯誤\n${valid.errors.map((e) => `- ${e.path}：${e.message}`).join("\n")}`);
      return;
    }
    case "apply": {
      if (!arg) fail("用法：npm run game -- apply <id> <ops.json>", 1);
      const project = load(id);
      const ops = JSON.parse(readFileSync(arg, "utf8"));
      const result = applyOps(project, Array.isArray(ops) ? ops : [ops]);
      const allOk = result.results.every((r) => r.ok);
      // 中途允許暫時不合法（例如結局還沒寫好），但每筆操作都必須成功；驗證錯誤會回報給 agent 處理
      if (allOk) writeFileSync(projectFile(id), JSON.stringify(result.project, null, 2) + "\n");
      return out({ ok: allOk, written: allOk, results: result.results.filter((r) => !r.ok || result.results.length <= 20), report: result.report }, allOk ? 0 : 2);
    }
    case "check": {
      const result = check(load(id));
      return out(result, result.ok ? 0 : 2);
    }
    case "review": {
      const project = load(id);
      if (!validateProject(project).isValid) fail("專案尚未通過驗證，請先讓 check 通過再審查");
      const storyFile = path.join(dir(id), "story.md");
      const story = existsSync(storyFile) ? readFileSync(storyFile, "utf8") : project.description;
      const playtest = runPlaytest(project);
      const quality = assessQuality(project, playtest, { checkDuration: !values.demo });
      const provider = providerFromEnv();
      const status = provider ? await provider.available() : { ok: false, detail: "AI_PROVIDER=none" };
      if (!provider || !status.ok) fail(`AI 審查不可用：${status.detail}`);
      const review = await reviewProject(provider!, story, project, playtest, quality);
      writeFileSync(path.join(dir(id), "review.json"), JSON.stringify(review, null, 2) + "\n");
      return out({ ok: review.passed, ...review }, review.passed ? 0 : 2);
    }
    case "publish": {
      const project = load(id);
      const result = check(project);
      if (!result.ok) return out({ stage: "check", ...result, ok: false }, 2);
      const reviewFile = path.join(dir(id), "review.json");
      const review = existsSync(reviewFile) ? JSON.parse(readFileSync(reviewFile, "utf8")) : null;
      if (!values.demo && !review?.passed) fail("尚未通過 AI 審查（先執行 npm run game -- review，且 review.json 的 passed 必須為 true）");
      const target = path.join("public", "games", id);
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "project.json"), JSON.stringify(project, null, 2) + "\n");
      writeFileSync(
        path.join(target, "meta.json"),
        JSON.stringify({ status: values.demo ? "demo" : "approved", source: "ai-agent", review: review?.review?.overall ?? null, publishedAt: new Date().toISOString() }, null, 2) + "\n",
      );
      execFileSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("scripts", "build-catalog.ts")], { stdio: "ignore" });
      return out({ ok: true, published: target, next: "執行 npm run deploy 部署玩家版" }, 0);
    }
    default:
      fail(`未知的子指令「${command}」`, 1);
  }
}

main().catch((e) => fail((e as Error).message));
