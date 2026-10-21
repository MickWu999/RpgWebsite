import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { providerFromEnv } from "@/ai/claudeCodeProvider";
import { CLICHES } from "@/ai/designGuide";
import { drawSeeds } from "@/ai/seeds";
import { ASSET_CATALOG, MUSIC, TERRAIN } from "@/game/assets";
import { projectDigest, reviewProject, reviewTreatment, type ReviewResult } from "@/ai/review";
import { chapterPlaytest, checkChapters } from "@/game/chapters";
import { projectRevision } from "@/game/engine";
import { applyAction, settle } from "@/game/playtest";
import { runPlaytest } from "@/game/playtest";
import { lintDesign } from "@/game/lint";
import { assessQuality } from "@/game/quality";
import { gameProjectSchema, type GameProject } from "@/game/schema";
import { validateProject } from "@/game/validate";
import { publishSummary, runCheck } from "@/studio/check";
import { applyOps, blankProject, opSchema } from "@/studio/ops";
import { loadLocalEnv } from "./env";

/**
 * 給 AI agent（例如 VS Code 裡的 Claude Code）使用的遊戲製作 CLI。規範見 docs/ai-development-spec.md。
 * 遊戲原始檔放在 content/<id>/：story.md（故事）、treatment.md（劇本大綱）、project.json（遊戲資料）、review.json（審查結果）。
 *
 *   npm run game -- schema                                       輸出操作 API 的 JSON Schema
 *   npm run game -- assets                                       列出可用素材（地形字元、角色圖、圖示、音樂）
 *   npm run game -- seeds [n]                                    抽 n 組故事種子（世界規則×主角處境×情緒問題×語氣），發想提案用
 *   npm run game -- new <id> --title <名稱> [--genre fantasy]   建立空白專案（一張起始地圖、主角、一個佔位結局）
 *   npm run game -- inspect <id>                                 以 RPG Maker 事件清單的形式輸出目前內容
 *   npm run game -- apply <id> <ops.json>                        套用操作（每筆都成功才寫檔）
 *   npm run game -- check <id>                                   驗證＋自動試玩＋品質指標
 *   npm run game -- review-treatment <id>                        劇本大綱審查（動工前，通過後才能 apply）
 *   npm run game -- review <id> --chapter <章節ID>               章節審查（通過後才能新增下一章）
 *   npm run game -- review <id>                                  整體審查（發布前）
 *   npm run game -- status <id>                                  目前卡在哪一關
 *   npm run game -- publish <id>                                 所有關卡都通過才發布到 public/games/<id>/
 * 審查都是另開一次 Claude Code 的獨立審查員，看不到製作過程；結果存在 content/<id>/reviews/。
 *
 * 遠端模式（操作線上的 Studio 後台；需在 .env.local 設定 STUDIO_URL 與 STUDIO_TOKEN，token 在 Studio「AI 協作」產生）：
 *   npm run game -- remote list
 *   npm run game -- remote create <名稱>
 *   npm run game -- remote pull <id>               下載到 content/<id>/project.json
 *   npm run game -- remote inspect <id>            下載並以事件清單形式輸出
 *   npm run game -- remote apply <id> <ops.json>   送出操作（自動帶目前版本號，避免覆蓋人的修改）
 *   npm run game -- remote check <id>
 *   npm run game -- remote lessons                 AI 案例庫（玩家回饋＋審查常見問題）→ content/lessons.md，製作前必讀
 *   npm run game -- remote story <id>              讀取人在 Studio 寫的故事 → content/<id>/story.md
 *   npm run game -- remote push-docs <id>          上傳 story.md、treatment.md 到 Studio（給人看）
 *   npm run game -- remote review-treatment <id>   （審查結果自動上傳到 Studio）
 *   npm run game -- remote review <id> [--chapter <章節ID>]
 *   npm run game -- remote status <id>
 *   npm run game -- remote versions <id>
 *   npm run game -- remote publish <id>            在本機檢查後發布；API Token 不能略過品質指標
 * 結束碼 0＝成功／通過，2＝失敗，1＝用法錯誤。
 */

loadLocalEnv();
const CONTENT = "content";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { title: { type: "string" }, genre: { type: "string" }, demo: { type: "boolean" }, chapter: { type: "string" } },
});
const [command, id, arg] = positionals;

const out = (data: unknown, code: number) => {
  console.log(JSON.stringify(data, null, 2));
  process.exit(code);
};
const fail = (message: string, code = 2): never => out({ ok: false, error: message }, code) as never;
const dir = (gameId: string) => path.join(CONTENT, gameId);
const projectFile = (gameId: string) => path.join(dir(gameId), "project.json");

// ---------- 關卡（三層把關） ----------

const reviewFile = (gameId: string, target: string) => path.join(dir(gameId), "reviews", `${target}.json`);
function readReview(gameId: string, target: string): ReviewResult | null {
  const f = reviewFile(gameId, target);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as ReviewResult) : null;
}
function writeReview(gameId: string, r: ReviewResult) {
  mkdirSync(path.join(dir(gameId), "reviews"), { recursive: true });
  writeFileSync(reviewFile(gameId, r.target), JSON.stringify(r, null, 2) + "\n");
}

/** 送出操作前的關卡：大綱要先通過審查；新增下一章前，上一章要先通過章節審查；一次只能新增一章 */
function opsGate(gameId: string, project: GameProject, ops: unknown[]): string | null {
  if (values.demo) return null;
  if (!readReview(gameId, "treatment")?.passed) return `劇本大綱尚未通過審查：先寫 ${path.join(dir(gameId), "treatment.md")}，再執行 npm run game -- review-treatment ${gameId}`;
  const added = ops.filter((o): o is { op: "chapter.upsert"; chapter: { id: string } } => (o as { op?: string }).op === "chapter.upsert" && !project.chapters.some((c) => c.id === (o as { chapter: { id: string } }).chapter.id));
  if (added.length > 1) return "一次只能新增一章：完成這一章並通過章節審查後，再新增下一章";
  const last = project.chapters.at(-1);
  if (added.length === 1 && last && !readReview(gameId, last.id)?.passed) return `第 ${project.chapters.length} 章「${last.title}」尚未通過章節審查（npm run game -- review ${gameId} --chapter ${last.id}），不能開始下一章`;
  return null;
}

/** 目前的關卡狀態 */
function gateStatus(gameId: string, project: GameProject) {
  const revision = projectRevision(project);
  const treatment = readReview(gameId, "treatment");
  const chapters = project.chapters.map((c, i) => ({ index: i + 1, id: c.id, title: c.title, reviewPassed: Boolean(readReview(gameId, c.id)?.passed) }));
  const full = readReview(gameId, "full");
  // 連載中：每章通過章節審查就可以推出；完結時才需要整體審查
  const ongoing = project.release?.status === "ongoing";
  const fullCurrent = ongoing || Boolean(full?.passed && full.revision === revision);
  const blockers = [
    ...(treatment?.passed ? [] : ["劇本大綱尚未通過審查（review-treatment）"]),
    ...chapters.filter((c) => !c.reviewPassed).map((c) => `第 ${c.index} 章「${c.title}」尚未通過章節審查（review --chapter ${c.id}）`),
    ...(fullCurrent ? [] : [full?.passed ? "整體審查之後內容又改過了，請重新執行整體審查（review）" : "尚未通過整體審查（review）"]),
  ];
  return { treatmentPassed: Boolean(treatment?.passed), chapters, fullReviewPassed: fullCurrent, blockers, next: blockers[0] ?? "可以發布" };
}

async function provider() {
  const p = providerFromEnv();
  const status = p ? await p.available() : { ok: false, detail: "AI_PROVIDER=none" };
  if (!p || !status.ok) fail(`AI 審查不可用：${status.detail}`);
  return p!;
}

/** 案例庫（玩家回饋＋歷次審查最常出現的問題），由 remote lessons 產生 */
const LESSONS_FILE = path.join(CONTENT, "lessons.md");
const readLessons = () => (existsSync(LESSONS_FILE) ? readFileSync(LESSONS_FILE, "utf8") : null);

const readText = (gameId: string, file: string) => (existsSync(path.join(dir(gameId), file)) ? readFileSync(path.join(dir(gameId), file), "utf8") : null);

async function doReviewTreatment(gameId: string): Promise<ReviewResult> {
  const treatment = readText(gameId, "treatment.md");
  if (!treatment || treatment.length < 400) fail(`找不到 ${path.join(dir(gameId), "treatment.md")}，或內容太短；請依規範第 5 節的格式撰寫劇本大綱`);
  const story = readText(gameId, "story.md") ?? "";
  const r = await reviewTreatment(await provider(), story, treatment!, { previous: readReview(gameId, "treatment"), lessons: readLessons() });
  writeReview(gameId, r);
  return r;
}

async function doReview(gameId: string, project: GameProject): Promise<ReviewResult> {
  const validation = validateProject(project);
  if (!validation.isValid) fail("專案尚未通過驗證，請先讓 check 的驗證錯誤清空再審查");
  const story = readText(gameId, "story.md") ?? project.description;
  const treatment = readText(gameId, "treatment.md") ?? undefined;
  const playtest = runPlaytest(project);
  const chapters = checkChapters(project);
  const quality = assessQuality(project, playtest, { checkDuration: !values.demo, chapters });
  let chapter: Parameters<typeof reviewProject>[1]["chapter"];
  if (values.chapter) {
    const index = project.chapters.findIndex((c) => c.id === values.chapter);
    if (index < 0) fail(`找不到章節「${values.chapter}」`);
    const report = chapters[index];
    if (!report.ok) return out({ ok: false, stage: "chapter-check", chapter: report }, 2) as never;
    // 收集這一章路線經過的地圖（專案太大時，審查摘要只保留這些地圖）
    const { start, playtest: cp } = chapterPlaytest(project, index);
    const mapIds = new Set<string>([start!.mapId]);
    let st = settle(project, start!);
    for (const a of cp!.goals[0].actions ?? []) {
      st = applyAction(project, st, a);
      mapIds.add(st.mapId);
    }
    chapter = { index, route: report.route, minutes: report.minutes, mapIds: [...mapIds] };
  } else if (!values.demo) {
    const blocking = quality.blocking.length + (playtest.ok ? 0 : 1);
    if (blocking > 0) return out({ ok: false, stage: "check", message: "整體審查前，check 必須全部通過", blocking: quality.blocking, playtest: playtest.issues }, 2) as never;
  }
  const r = await reviewProject(await provider(), {
    story,
    treatment,
    project,
    playtest,
    quality,
    revision: projectRevision(project),
    chapter,
    previous: readReview(gameId, values.chapter ?? "full"),
    lessons: readLessons(),
  });
  writeReview(gameId, r);
  return r;
}

const reviewOut = (r: ReviewResult, extra: Record<string, unknown> = {}) => out({ ok: r.passed, ...extra, ...r }, r.passed ? 0 : 2);

function inspect(project: GameProject) {
  const valid = validateProject(project);
  console.log(projectDigest(project, valid.project ? runPlaytest(project) : null));
  if (!valid.isValid) console.log(`\n## 目前的驗證錯誤\n${valid.errors.map((e) => `- ${e.path}：${e.message}`).join("\n")}`);
}

/** 遠端模式：以 API Token 呼叫 Studio 後台 */
async function remote(sub: string | undefined, target: string | undefined, file: string | undefined) {
  const base = process.env.STUDIO_URL?.replace(/\/$/, "");
  const token = process.env.STUDIO_TOKEN;
  if (!base || !token) fail("遠端模式需要在 .env.local 設定 STUDIO_URL 與 STUDIO_TOKEN（token 在 Studio「AI 協作」產生）", 1);
  const api = async (method: string, p: string, body?: unknown) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return { status: res.status, ok: res.ok, data };
  };
  const done = (r: { ok: boolean; data: unknown }) => out(r.data, r.ok ? 0 : 2);
  /** 後台的審查紀錄是關卡的依據：每個目標最新一次的結果寫進 content/<id>/reviews/ */
  const syncReviews = async (gameId: string) => {
    const r = await api("GET", `/api/projects/${gameId}/reviews`);
    if (!r.ok) return;
    const seen = new Set<string>();
    rmSync(path.join(dir(gameId), "reviews"), { recursive: true, force: true });
    for (const rev of r.data.reviews as Array<{ target: string; data: ReviewResult }>) {
      if (seen.has(rev.target)) continue;
      seen.add(rev.target);
      writeReview(gameId, rev.data);
    }
  };
  const pushDocs = async (gameId: string) => {
    for (const kind of ["story", "treatment"] as const) {
      const text = readText(gameId, `${kind}.md`);
      if (text) await api("PUT", `/api/projects/${gameId}/docs/${kind}`, { content: text });
    }
  };
  const need = (usage: string) => target || fail(`用法：npm run game -- remote ${usage}`, 1);
  switch (sub) {
    case "list":
      return done(await api("GET", "/api/projects"));
    case "create":
      need("create <名稱>");
      return done(await api("POST", "/api/projects", { title: target, template: "blank" }));
    case "pull": {
      need("pull <id>");
      const r = await api("GET", `/api/projects/${target}`);
      if (!r.ok) return done(r);
      mkdirSync(dir(target!), { recursive: true });
      writeFileSync(projectFile(target!), JSON.stringify(r.data.project, null, 2) + "\n");
      return out({ ok: true, pulled: projectFile(target!), version: r.data.version }, 0);
    }
    case "inspect": {
      need("inspect <id>");
      const r = await api("GET", `/api/projects/${target}`);
      if (!r.ok) return done(r);
      return inspect(r.data.project);
    }
    case "apply": {
      if (!target || !file) fail("用法：npm run game -- remote apply <id> <ops.json>", 1);
      const ops = JSON.parse(readFileSync(file!, "utf8"));
      const cur = await api("GET", `/api/projects/${target}`);
      if (!cur.ok) return done(cur);
      const list = Array.isArray(ops) ? ops : [ops];
      await syncReviews(target!);
      const blocked = opsGate(target!, cur.data.project, list);
      if (blocked) return out({ ok: false, stage: "gate", error: blocked }, 2);
      // 先在本機試算並驗證，回報錯誤給 agent；伺服器只套用操作
      const local = applyOps(cur.data.project, list);
      if (!local.results.every((x) => x.ok)) return out({ ok: false, stage: "local", results: local.results.filter((x) => !x.ok) }, 2);
      const r = await api("POST", `/api/projects/${target}/ops`, { ops: list, baseVersion: cur.data.version });
      return out({ ...r.data, report: local.report, lint: lintDelta(cur.data.project, local.project) }, r.ok ? 0 : 2);
    }
    case "check": {
      // 伺服器不執行檢查（CPU 限制）：下載目前版本，在本機驗證＋自動試玩＋品質指標
      need("check <id>");
      const r = await api("GET", `/api/projects/${target}`);
      if (!r.ok) return done(r);
      const report = runCheck(r.data.project, { demo: values.demo });
      return out({ ok: report.passed, version: r.data.version, ...report }, report.passed ? 0 : 2);
    }
    case "story": {
      // 讀取人在 Studio 寫給 AI 的故事（與已上傳的大綱），存到 content/<id>/
      need("story <id>");
      const r = await api("GET", `/api/projects/${target}/docs`);
      if (!r.ok) return done(r);
      mkdirSync(dir(target!), { recursive: true });
      const written: string[] = [];
      for (const kind of ["story", "treatment"] as const) {
        const doc = r.data.docs[kind];
        if (!doc) continue;
        const file = path.join(dir(target!), `${kind}.md`);
        if (kind === "treatment" && existsSync(file)) continue;
        writeFileSync(file, doc.content);
        written.push(file);
      }
      return out({ ok: true, written, story: r.data.docs.story?.content ?? null }, 0);
    }
    case "lessons": {
      // AI 案例庫：玩家回饋＋歷次審查最常退件的問題 → content/lessons.md（製作與審查都會讀）
      const res = await fetch(`${base}/api/lessons`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return out({ ok: false, error: `HTTP ${res.status}` }, 2);
      mkdirSync(CONTENT, { recursive: true });
      writeFileSync(LESSONS_FILE, await res.text());
      return out({ ok: true, written: LESSONS_FILE }, 0);
    }
    case "push-docs":
      need("push-docs <id>");
      await pushDocs(target!);
      return out({ ok: true, pushed: ["story.md", "treatment.md"].filter((f) => readText(target!, f)) }, 0);
    case "review-treatment": {
      need("review-treatment <id>");
      await pushDocs(target!);
      const r = await doReviewTreatment(target!);
      await api("POST", `/api/projects/${target}/reviews`, r);
      return reviewOut(r, { uploaded: true });
    }
    case "review":
    case "status": {
      need(`${sub} <id>`);
      const r = await api("GET", `/api/projects/${target}`);
      if (!r.ok) return done(r);
      mkdirSync(dir(target!), { recursive: true });
      writeFileSync(projectFile(target!), JSON.stringify(r.data.project, null, 2) + "\n");
      await syncReviews(target!);
      if (sub === "status") return out({ ok: true, version: r.data.version, ...gateStatus(target!, r.data.project) }, 0);
      await pushDocs(target!);
      const rev = await doReview(target!, r.data.project);
      await api("POST", `/api/projects/${target}/reviews`, rev);
      return reviewOut(rev, { uploaded: true });
    }
    case "versions":
      need("versions <id>");
      return done(await api("GET", `/api/projects/${target}/versions`));
    case "publish": {
      need("publish <id>");
      const r = await api("GET", `/api/projects/${target}`);
      if (!r.ok) return done(r);
      const report = runCheck(r.data.project);
      if (!report.passed) return out({ ok: false, stage: "check", ...report }, 2);
      await syncReviews(target!);
      const gate = gateStatus(target!, r.data.project);
      if (gate.blockers.length) return out({ ok: false, stage: "gate", ...gate }, 2);
      return done(await api("POST", `/api/projects/${target}/publish`, { check: publishSummary(report) }));
    }
    default:
      fail("用法：npm run game -- remote <list|create|lessons|story|push-docs|pull|inspect|apply|check|review-treatment|review|status|versions|publish> …", 1);
  }
}

/**
 * 設計防呆：每次 apply 之後立刻比對前後，只回報「這批操作新產生的」問題，讓 agent 當場修正。
 * 製作途中有些問題是暫時的（例如先寫了讀取開關的事件、打開開關的事件下一批才做），所以 apply 不擋，check／publish 才擋。
 */
function lintDelta(before: GameProject, after: GameProject) {
  try {
    const key = (x: { path: string; message: string }) => `${x.path}|${x.message}`;
    const old = lintDesign(before);
    const now = lintDesign(after);
    const had = new Set([...old.errors, ...old.warnings].map(key));
    const newErrors = now.errors.filter((x) => !had.has(key(x)));
    const newWarnings = now.warnings.filter((x) => !had.has(key(x)));
    return {
      newErrors,
      newWarnings,
      openErrors: now.errors.length,
      ...(newErrors.length ? { hint: "這批操作新產生了設計錯誤（卡關或永遠不會出現的事件頁）。如果只是還沒做完的部分，下一批補上即可；check／publish 時仍有錯誤會被擋下" } : {}),
    };
  } catch {
    return null;
  }
}

/** 製作中的專案允許暫時不完整（例如結局還沒接上），所以只檢查 schema 格式；完整驗證由 check／publish 把關 */
function load(gameId: string): GameProject {
  if (!existsSync(projectFile(gameId))) fail(`找不到 ${projectFile(gameId)}，請先執行 npm run game -- new ${gameId}`);
  const parsed = gameProjectSchema.safeParse(JSON.parse(readFileSync(projectFile(gameId), "utf8")));
  if (!parsed.success) out({ ok: false, error: "project.json 格式錯誤", issues: parsed.error.issues.slice(0, 20) }, 2);
  return parsed.data!;
}

async function main() {
  if (command === "remote") return remote(id, arg, positionals[3]);
  if (command === "schema") return out(z.toJSONSchema(z.array(opSchema)), 0);
  if (command === "assets") {
    // 給 AI 挑選素材：地形字元（依村莊／城市／室內分組）、角色圖、物品圖示、背景音樂
    const terrain = Object.entries(TERRAIN).map(([ch, d]) => ({ ch, name: d.name, group: d.group ?? "village", walkable: d.walkable, ...(d.examine ? { examine: d.examine } : {}) }));
    const pick = (kind: string) => ASSET_CATALOG.filter((a) => a.kind === kind).map((a) => ({ id: a.id, name: a.name, tags: a.tags }));
    return out({ terrain, characters: pick("character"), icons: pick("icon"), music: Object.entries(MUSIC).map(([mood, m]) => ({ mood, title: m.title })), note: "地形字元用在 map.terrain／map.paint；角色圖用在 actor.spriteAssetId 與事件頁 graphic；圖示用在 item.iconAssetId；音樂情緒用在 map.music 與 music 指令" }, 0);
  }
  if (command === "seeds") {
    // 發想提案用：強迫離開 AI 最先想到的老套點子（規範第 3 節「提案」）
    return out({ seeds: drawSeeds(Math.min(Math.max(Number(id) || 3, 1), 8)), cliches: CLICHES, note: "種子只是起點：可以換牌、混搭，但每個提案都要說明它避開了哪些老套" }, 0);
  }
  if (!command || !id) fail("用法：npm run game -- <schema|new|inspect|apply|check|review-treatment|review|status|publish> <id> …", 1);
  if (!/^[a-z0-9-]{3,48}$/.test(id)) fail("遊戲 ID 只能用小寫英數字與連字號（3～48 字）", 1);

  switch (command) {
    case "new": {
      if (existsSync(projectFile(id))) fail(`${projectFile(id)} 已存在`);
      const project = blankProject(id, values.title ?? id, (values.genre as GameProject["genre"]) ?? "fantasy");
      mkdirSync(dir(id), { recursive: true });
      writeFileSync(projectFile(id), JSON.stringify(project, null, 2) + "\n");
      if (!existsSync(path.join(dir(id), "story.md"))) writeFileSync(path.join(dir(id), "story.md"), `# ${project.title}\n\n（把原始故事寫在這裡）\n`);
      return out({ ok: true, created: projectFile(id), next: "寫 story.md 與 treatment.md，然後逐章用 apply 實作" }, 0);
    }
    case "inspect":
      return inspect(load(id));
    case "apply": {
      if (!arg) fail("用法：npm run game -- apply <id> <ops.json>", 1);
      const ops = JSON.parse(readFileSync(arg, "utf8"));
      const list = Array.isArray(ops) ? ops : [ops];
      const base = load(id);
      const blocked = opsGate(id, base, list);
      if (blocked) return out({ ok: false, stage: "gate", error: blocked }, 2);
      const result = applyOps(base, list);
      const allOk = result.results.every((r) => r.ok);
      // 中途允許暫時不合法（例如結局還沒寫好），但每筆操作都必須成功；驗證錯誤會回報給 agent 處理
      if (allOk) writeFileSync(projectFile(id), JSON.stringify(result.project, null, 2) + "\n");
      return out({ ok: allOk, written: allOk, results: result.results.filter((r) => !r.ok || result.results.length <= 20), report: result.report, ...(allOk ? { lint: lintDelta(base, result.project) } : {}) }, allOk ? 0 : 2);
    }
    case "check": {
      const report = runCheck(load(id), { demo: values.demo });
      return out({ ok: report.passed, ...report }, report.passed ? 0 : 2);
    }
    case "review-treatment":
      return reviewOut(await doReviewTreatment(id));
    case "review":
      return reviewOut(await doReview(id, load(id)));
    case "status":
      return out({ ok: true, ...gateStatus(id, load(id)) }, 0);
    case "publish": {
      const project = load(id);
      const report = runCheck(project, { demo: values.demo });
      if (!report.passed) return out({ ok: false, stage: "check", ...report }, 2);
      const gate = gateStatus(id, project);
      if (!values.demo && gate.blockers.length) return out({ ok: false, stage: "gate", ...gate }, 2);
      const review = readReview(id, "full");
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
