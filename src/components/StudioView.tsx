"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import IssueList from "@/components/IssueList";
import { ASSET_CATALOG, LICENSES, findCatalogAsset, manifestEntry, TERRAIN, walkableFromTerrain } from "@/game/assets";
import { describeCondition, describeEffect } from "@/game/describe";
import { GENRE_LABELS, type GameProject } from "@/game/schema";
import {
  DEMO_PROJECT_ID,
  deleteProject,
  downloadJson,
  exportProjectJson,
  loadProject,
  parseProjectJson,
  saveProject,
  undoProject,
  type ProjectMetadata,
} from "@/game/storage";
import { validateProject } from "@/game/validate";
import { bridgeGenerate, bridgeRepair, checkBridge, type BridgeStatus } from "@/lib/aiBridge";
import { STATUS_LABELS } from "@/lib/labels";

type Section = "overview" | "scenes" | "npcs" | "dialogues" | "quests" | "items" | "endings" | "assets" | "json";
const SECTIONS: Array<[Section, string]> = [
  ["overview", "概要"],
  ["scenes", "場景"],
  ["npcs", "NPC"],
  ["dialogues", "對話"],
  ["quests", "任務"],
  ["items", "物品"],
  ["endings", "結局"],
  ["assets", "素材"],
  ["json", "JSON"],
];
const characterAssets = ASSET_CATALOG.filter((a) => a.kind === "character");
const iconAssets = ASSET_CATALOG.filter((a) => a.kind === "icon");

/** 確保素材出現在專案的 assetManifest 中（只能加入內建素材庫的素材） */
function ensureAsset(p: GameProject, id: string) {
  if (!findCatalogAsset(id)) return;
  if (!p.assetManifest.assets.some((a) => a.id === id)) p.assetManifest.assets.push(manifestEntry(id));
}

export default function StudioView({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<GameProject | null>(null);
  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null);
  const [historyCount, setHistoryCount] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [section, setSection] = useState<Section>("overview");
  const [message, setMessage] = useState<{ kind: "info" | "err"; text: string } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonIssues, setJsonIssues] = useState<ReturnType<typeof validateProject> | null>(null);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [story, setStory] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiLog, setAiLog] = useState<string[]>([]);
  const [pendingStatus, setPendingStatus] = useState<string | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = () => {
    const loaded = loadProject(projectId);
    if (!loaded) {
      setNotFound(true);
      return;
    }
    setDraft(loaded.project);
    setMetadata(loaded.metadata);
    setHistoryCount(loaded.history.length);
    setDirty(false);
    setStory(loaded.metadata.story ?? "");
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 專案存在 localStorage，只能在瀏覽器端讀取
    reload();
    checkBridge().then(setBridge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const report = useMemo(() => (draft ? validateProject(draft) : null), [draft]);

  if (notFound) {
    return (
      <div className="container">
        <div className="notice err">找不到專案「{projectId}」。專案只存在建立它的瀏覽器中。</div>
        <p>
          <Link href="/">回首頁</Link>
        </p>
      </div>
    );
  }
  if (!draft || !report || !metadata) return <div className="container muted">載入中…</div>;

  const update = (fn: (p: GameProject) => void) => {
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
    setDirty(true);
  };

  const save = () => {
    try {
      const meta = saveProject(draft, { story: story || undefined, ...(pendingStatus ? { pipelineStatus: pendingStatus } : {}) });
      setPendingStatus(undefined);
      setMetadata(meta);
      setHistoryCount((n) => Math.min(n + 1, 15));
      setDirty(false);
      setMessage({ kind: "info", text: "已儲存。注意：修改內容後，舊的遊戲存檔將無法沿用。" });
      return true;
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
      return false;
    }
  };

  const undo = () => {
    if (dirty) {
      reload();
      setMessage({ kind: "info", text: "已捨棄尚未儲存的修改" });
      return;
    }
    const previous = undoProject(projectId);
    if (!previous) {
      setMessage({ kind: "err", text: "沒有可以復原的版本" });
      return;
    }
    reload();
    setMessage({ kind: "info", text: "已復原到上一個儲存版本" });
  };

  const play = () => {
    if (dirty && !save()) return;
    router.push(`/play/?id=${encodeURIComponent(projectId)}`);
  };

  const applyGenerated = (project: GameProject, label: string, status?: string) => {
    setPendingStatus(status);
    setDraft({ ...project, id: projectId });
    setDirty(true);
    setMessage({ kind: "info", text: `${label}結果已載入編輯區（尚未儲存）。確認後按「儲存」；不滿意可按「捨棄修改」。` });
  };

  const runAi = async (kind: "generate" | "repair") => {
    setAiBusy(true);
    setAiLog([kind === "generate" ? "已送出生成請求，本機 Claude Code 處理中…" : "已送出修復請求…"]);
    try {
      const result =
        kind === "generate"
          ? await bridgeGenerate({ story, title: draft.title, genre: draft.genre, projectId })
          : await bridgeRepair({ project: draft, errors: report.errors, projectId });
      setAiLog(
        [
          result.message,
          ...result.attempts.map((a) => `第 ${a.attempt} 次（${a.kind === "generate" ? "生成" : "修復"}）：${a.errors.length} 個錯誤${a.notes.length ? `；正規化 ${a.notes.length} 項` : ""}`),
        ].filter(Boolean),
      );
      if (result.review) setAiLog((log) => [...log, `AI 審查：${result.review!.review.overall}/10，${result.review!.passed ? "通過" : result.review!.reasons.join("、")}`, result.review!.review.summary]);
      if (result.project) applyGenerated(result.project, kind === "generate" ? "AI 生成" : "AI 修復", result.status);
      else setJsonIssues({ ...result.report, project: undefined });
      if (!result.project) {
        setJsonText(JSON.stringify(result.rawProject, null, 2));
        setSection("json");
      }
    } catch (e) {
      setAiLog([(e as Error).message]);
    } finally {
      setAiBusy(false);
    }
  };

  const importInto = async (file: File) => {
    const result = parseProjectJson(await file.text());
    if (!result.project) {
      setJsonText(await file.text());
      setJsonIssues(result);
      setSection("json");
      setMessage({ kind: "err", text: "匯入的 JSON 未通過驗證，已在 JSON 頁籤顯示錯誤" });
      return;
    }
    applyGenerated(result.project, "匯入");
  };

  const sceneOptions = draft.scenes.map((s) => (
    <option key={s.id} value={s.id}>
      {s.name}（{s.id}）
    </option>
  ));
  const nodeOptions = draft.dialogues.map((d) => (
    <option key={d.id} value={d.id}>
      {d.id}：{d.text.slice(0, 18)}
    </option>
  ));

  return (
    <>
      <div className="topbar">
        <Link href="/" className="small">
          ← 首頁
        </Link>
        <span className="title">{draft.title}</span>
        <span className="badge">{metadata.source === "demo" ? "內建 demo" : metadata.source}</span>
        {metadata.pipelineStatus && STATUS_LABELS[metadata.pipelineStatus] && (
          <span className={`badge ${STATUS_LABELS[metadata.pipelineStatus][1]}`}>{STATUS_LABELS[metadata.pipelineStatus][0]}</span>
        )}
        {dirty ? <span className="badge warn">尚未儲存</span> : <span className="badge ok">已儲存</span>}
        <span className={`badge ${report.isValid ? "ok" : "err"}`} data-testid="validation-badge">
          {report.isValid ? `驗證通過${report.warnings.length ? `（${report.warnings.length} 個警告）` : ""}` : `${report.errors.length} 個錯誤`}
        </span>
        <span className="grow" />
        <button className="btn small primary" disabled={!dirty || !report.isValid} onClick={save}>
          儲存
        </button>
        <button className="btn small" disabled={!dirty && historyCount === 0} onClick={undo}>
          {dirty ? "捨棄修改" : `復原上一版（${historyCount}）`}
        </button>
        <button className="btn small primary" disabled={!report.isValid} onClick={play} data-testid="studio-play">
          ▶ 試玩
        </button>
        <button className="btn small" disabled={!report.isValid} onClick={() => downloadJson(`${draft.id}.json`, exportProjectJson(draft))}>
          匯出 JSON
        </button>
        <button className="btn small" onClick={() => fileRef.current?.click()}>
          匯入 JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importInto(f);
            e.target.value = "";
          }}
        />
        {projectId === DEMO_PROJECT_ID && metadata.source !== "demo" && (
          <button
            className="btn small danger"
            onClick={() => {
              if (window.confirm("確定要把 demo 還原成內建原始版本嗎？你的修改與 demo 存檔都會刪除。")) {
                deleteProject(DEMO_PROJECT_ID);
                reload();
              }
            }}
          >
            還原原始 demo
          </button>
        )}
      </div>

      <div className="studio">
        <nav className="studio-nav">
          {SECTIONS.map(([key, label]) => (
            <button
              key={key}
              className={section === key ? "active" : ""}
              onClick={() => {
                if (key === "json") {
                  setJsonText(JSON.stringify(draft, null, 2));
                  setJsonIssues(null);
                }
                setSection(key);
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        <main className="stack">
          {message && <div className={`notice ${message.kind}`}>{message.text}</div>}

          {section === "overview" && (
            <div className="panel stack">
              <h2>概要</h2>
              <label className="field">
                專案名稱
                <input type="text" value={draft.title} onChange={(e) => update((p) => void (p.title = e.target.value))} />
              </label>
              <label className="field">
                簡介
                <textarea value={draft.description} onChange={(e) => update((p) => void (p.description = e.target.value))} />
              </label>
              <label className="field">
                開場文字
                <textarea rows={5} value={draft.intro ?? ""} onChange={(e) => update((p) => void (p.intro = e.target.value || undefined))} />
              </label>
              <label className="field">
                類型
                <select value={draft.genre} onChange={(e) => update((p) => void (p.genre = e.target.value as GameProject["genre"]))}>
                  {Object.entries(GENRE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <h3>玩家角色</h3>
              <div className="row">
                <label className="field grow">
                  名稱
                  <input type="text" value={draft.player.name} onChange={(e) => update((p) => void (p.player.name = e.target.value))} />
                </label>
                <label className="field grow">
                  角色圖
                  <select
                    value={draft.player.spriteAssetId ?? ""}
                    onChange={(e) =>
                      update((p) => {
                        p.player.spriteAssetId = e.target.value;
                        ensureAsset(p, e.target.value);
                      })
                    }
                  >
                    {characterAssets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}（{a.id}）
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                描述
                <textarea value={draft.player.description ?? ""} onChange={(e) => update((p) => void (p.player.description = e.target.value || undefined))} />
              </label>
            </div>
          )}

          {section === "scenes" &&
            draft.scenes.map((scene, si) => (
              <div key={scene.id} className="panel stack">
                <h2>
                  場景：{scene.name} <span className="badge mono">{scene.id}</span>
                </h2>
                <label className="field">
                  名稱
                  <input type="text" value={scene.name} onChange={(e) => update((p) => void (p.scenes[si].name = e.target.value))} />
                </label>
                {scene.terrain ? (
                  <label className="field">
                    地形（每列一行，{scene.width}×{scene.height}；修改後會自動重新計算可行走區域）
                    <textarea
                      className="terrain-editor"
                      spellCheck={false}
                      rows={scene.height + 1}
                      value={scene.terrain.join("\n")}
                      onChange={(e) =>
                        update((p) => {
                          const rows = e.target.value.split("\n");
                          const s = p.scenes[si];
                          s.terrain = rows;
                          s.height = rows.length;
                          s.width = Math.max(...rows.map((r) => [...r].length));
                          s.walkable = walkableFromTerrain(rows);
                        })
                      }
                    />
                  </label>
                ) : (
                  <div className="muted small">此場景沒有 terrain，使用色塊 placeholder 繪製；可在 JSON 頁籤編輯 walkable。</div>
                )}
                <div className="legend">
                  {Object.entries(TERRAIN).map(([ch, d]) => (
                    <span key={ch}>
                      <code>{ch}</code> {d.name}
                      {d.walkable ? "" : "（擋）"}
                    </span>
                  ))}
                </div>
                <div className="small muted">
                  出口：{scene.exits.map((x) => `(${x.x},${x.y})→${x.targetSceneId}`).join("、") || "無"}；地點：
                  {(scene.locations ?? []).map((l) => `${l.name}(${l.x},${l.y})`).join("、") || "無"}；撿取物：
                  {(scene.pickups ?? []).map((pk) => `${pk.itemId}(${pk.x},${pk.y})`).join("、") || "無"}。這些欄位請在 JSON 頁籤編輯。
                </div>
              </div>
            ))}

          {section === "npcs" &&
            draft.npcs.map((npc, ni) => (
              <div key={npc.id} className="panel stack">
                <h2>
                  {npc.name} <span className="badge mono">{npc.id}</span>
                </h2>
                <div className="row">
                  <label className="field grow">
                    名稱
                    <input type="text" value={npc.name} onChange={(e) => update((p) => void (p.npcs[ni].name = e.target.value))} />
                  </label>
                  <label className="field grow">
                    角色圖
                    <select
                      value={npc.spriteAssetId ?? ""}
                      onChange={(e) =>
                        update((p) => {
                          p.npcs[ni].spriteAssetId = e.target.value;
                          ensureAsset(p, e.target.value);
                        })
                      }
                    >
                      {characterAssets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}（{a.id}）
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="field">
                  描述
                  <textarea value={npc.description} onChange={(e) => update((p) => void (p.npcs[ni].description = e.target.value))} />
                </label>
                <div className="row">
                  <label className="field grow">
                    所在場景
                    <select
                      value={npc.sceneId}
                      onChange={(e) =>
                        update((p) => {
                          const old = p.scenes.find((s) => s.id === p.npcs[ni].sceneId);
                          if (old) old.npcIds = old.npcIds.filter((id) => id !== npc.id);
                          p.npcs[ni].sceneId = e.target.value;
                          const next = p.scenes.find((s) => s.id === e.target.value);
                          if (next && !next.npcIds.includes(npc.id)) next.npcIds.push(npc.id);
                        })
                      }
                    >
                      {sceneOptions}
                    </select>
                  </label>
                  <label className="field">
                    X
                    <input type="number" min={0} value={npc.position.x} onChange={(e) => update((p) => void (p.npcs[ni].position.x = Number(e.target.value)))} />
                  </label>
                  <label className="field">
                    Y
                    <input type="number" min={0} value={npc.position.y} onChange={(e) => update((p) => void (p.npcs[ni].position.y = Number(e.target.value)))} />
                  </label>
                </div>
                <label className="field">
                  預設對話節點
                  <select value={npc.dialogueNodeId} onChange={(e) => update((p) => void (p.npcs[ni].dialogueNodeId = e.target.value))}>
                    {nodeOptions}
                  </select>
                </label>
                {(npc.dialogueVariants ?? []).length > 0 && (
                  <div className="small muted">
                    條件分支：
                    {npc.dialogueVariants!.map((v, vi) => (
                      <div key={vi}>
                        若 {describeCondition(draft, v.condition)} → {v.dialogueNodeId}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

          {section === "dialogues" &&
            draft.dialogues.map((node, di) => (
              <div key={node.id} className="panel stack">
                <h3>
                  <span className="badge mono">{node.id}</span>
                </h3>
                <label className="field">
                  說話者
                  <input type="text" value={node.speaker} onChange={(e) => update((p) => void (p.dialogues[di].speaker = e.target.value))} />
                </label>
                <label className="field">
                  對話文字
                  <textarea rows={3} value={node.text} onChange={(e) => update((p) => void (p.dialogues[di].text = e.target.value))} />
                </label>
                {(node.choices ?? []).map((choice, ci) => (
                  <div key={choice.id} className="sub stack" style={{ gap: 6 }}>
                    <div className="row">
                      <label className="field grow">
                        選項 <span className="mono">{choice.id}</span>
                        <input type="text" value={choice.text} onChange={(e) => update((p) => void (p.dialogues[di].choices![ci].text = e.target.value))} />
                      </label>
                      <label className="field grow">
                        下一個節點
                        <select
                          value={choice.nextNodeId ?? ""}
                          onChange={(e) => update((p) => void (p.dialogues[di].choices![ci].nextNodeId = e.target.value || undefined))}
                        >
                          <option value="">（結束對話）</option>
                          {nodeOptions}
                        </select>
                      </label>
                    </div>
                    {(choice.effects ?? []).length > 0 && <div className="small muted">效果：{choice.effects!.map((e) => describeEffect(draft, e)).join("；")}</div>}
                    {choice.condition && <div className="small muted">顯示條件：{describeCondition(draft, choice.condition)}</div>}
                  </div>
                ))}
              </div>
            ))}

          {section === "quests" &&
            draft.quests.map((quest, qi) => (
              <div key={quest.id} className="panel stack">
                <h2>
                  {quest.title} <span className="badge mono">{quest.id}</span>
                </h2>
                <label className="field">
                  任務標題
                  <input type="text" value={quest.title} onChange={(e) => update((p) => void (p.quests[qi].title = e.target.value))} />
                </label>
                <label className="field">
                  任務描述
                  <textarea value={quest.description} onChange={(e) => update((p) => void (p.quests[qi].description = e.target.value))} />
                </label>
                {quest.startCondition && <div className="small muted">開始條件：{describeCondition(draft, quest.startCondition)}</div>}
                <h3>目標（依序完成）</h3>
                {quest.objectives.map((o, oi) => (
                  <label key={o.id} className="field">
                    {oi + 1}. {o.type} → <span className="mono">{o.targetId}</span>
                    {o.requiredCount ? ` ×${o.requiredCount}` : ""}
                    <input type="text" value={o.description} onChange={(e) => update((p) => void (p.quests[qi].objectives[oi].description = e.target.value))} />
                  </label>
                ))}
                <h3>獎勵</h3>
                {(quest.rewards ?? []).map((r, ri) =>
                  r.type === "add_xp" ? (
                    <label key={ri} className="field">
                      經驗值
                      <input
                        type="number"
                        value={r.amount}
                        onChange={(e) =>
                          update((p) => {
                            const reward = p.quests[qi].rewards![ri];
                            if (reward.type === "add_xp") reward.amount = Number(e.target.value);
                          })
                        }
                      />
                    </label>
                  ) : (
                    <div key={ri} className="small muted">
                      {describeEffect(draft, r)}
                    </div>
                  ),
                )}
                {(quest.rewards ?? []).length === 0 && <div className="small muted">無</div>}
              </div>
            ))}

          {section === "items" &&
            draft.items.map((item, ii) => (
              <div key={item.id} className="panel stack">
                <h2>
                  {item.name} <span className="badge mono">{item.id}</span>
                </h2>
                <div className="row">
                  <label className="field grow">
                    名稱
                    <input type="text" value={item.name} onChange={(e) => update((p) => void (p.items[ii].name = e.target.value))} />
                  </label>
                  <label className="field grow">
                    圖示
                    <select
                      value={item.iconAssetId ?? ""}
                      onChange={(e) =>
                        update((p) => {
                          p.items[ii].iconAssetId = e.target.value;
                          ensureAsset(p, e.target.value);
                        })
                      }
                    >
                      {iconAssets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}（{a.id}）
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="field">
                  描述
                  <textarea value={item.description} onChange={(e) => update((p) => void (p.items[ii].description = e.target.value))} />
                </label>
              </div>
            ))}

          {section === "endings" &&
            draft.endings.map((ending, ei) => (
              <div key={ending.id} className="panel stack">
                <h2>
                  {ending.title} <span className="badge mono">{ending.id}</span>
                </h2>
                <label className="field">
                  結局標題
                  <input type="text" value={ending.title} onChange={(e) => update((p) => void (p.endings[ei].title = e.target.value))} />
                </label>
                <label className="field">
                  結局文字
                  <textarea rows={4} value={ending.text} onChange={(e) => update((p) => void (p.endings[ei].text = e.target.value))} />
                </label>
                <div className="small muted">達成條件：{describeCondition(draft, ending.condition)}</div>
              </div>
            ))}

          {section === "assets" && (
            <div className="panel stack">
              <h2>素材</h2>
              <p className="small muted">遊戲資料只引用素材 ID；素材只能來自內建素材庫，授權資訊由素材庫產生，不可手動虛構。</p>
              <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th>ID</th>
                    <th>類型</th>
                    <th>圖塊</th>
                    <th>授權</th>
                    <th>署名</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.assetManifest.assets.map((a) => (
                    <tr key={a.id}>
                      <td className="mono">{a.id}</td>
                      <td>{a.kind}</td>
                      <td>{a.frame ?? "—"}</td>
                      <td>{a.license}</td>
                      <td>{a.attribution}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>素材包授權紀錄</h3>
              {Object.values(LICENSES).map((l) => (
                <div key={l.packId} className="sub small">
                  <strong>{l.packName}</strong>（{l.author}）
                  <div>
                    來源：<a href={l.sourceUrl}>{l.sourceUrl}</a>
                  </div>
                  <div>
                    授權：<a href={l.licenseUrl}>{l.license}</a>・可商用：{l.commercialUse ? "是" : "否"}・需署名：{l.attributionRequired ? "是" : "否（建議）"}・可修改：
                    {l.modificationAllowed ? "是" : "否"}・可隨生成作品散布：{l.redistributionWithGeneratedWorks ? "是" : "否"}
                  </div>
                  <div>
                    下載日期：{l.downloadedAt}・授權檔：<a href={l.localLicenseFile}>{l.localLicenseFile}</a>
                  </div>
                </div>
              ))}
            </div>
          )}

          {section === "json" && (
            <div className="panel stack">
              <h2>JSON 檢視／編輯</h2>
              <textarea className="mono" rows={28} spellCheck={false} value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
              <div className="row">
                <button
                  className="btn primary small"
                  onClick={() => {
                    const result = parseProjectJson(jsonText);
                    setJsonIssues(result);
                    if (result.project) applyGenerated(result.project, "JSON 編輯");
                  }}
                >
                  驗證並套用
                </button>
                <button className="btn small" onClick={() => setJsonText(JSON.stringify(draft, null, 2))}>
                  重設為目前內容
                </button>
              </div>
              {jsonIssues && !jsonIssues.isValid && <div className="notice err">JSON 未通過驗證，未套用：</div>}
              {jsonIssues && <IssueList errors={jsonIssues.errors} warnings={jsonIssues.warnings} />}
            </div>
          )}
        </main>

        <aside className="stack">
          <div className="panel stack">
            <h2>驗證</h2>
            {report.isValid && report.warnings.length === 0 && <div className="small" style={{ color: "var(--accent-2)" }}>✓ 結構、引用、地圖與結局可達性檢查全部通過</div>}
            <IssueList errors={report.errors} warnings={report.warnings} />
          </div>

          <div className="panel stack">
            <h2>AI（本機 Claude Code）</h2>
            {bridge === null ? (
              <div className="small muted">偵測中…</div>
            ) : bridge.available ? (
              <span className="badge ok">可用：{bridge.detail}</span>
            ) : (
              <div className="notice small">AI 生成僅限本機：{bridge.detail}。其他編輯、驗證與試玩功能不受影響。</div>
            )}
            <label className="field">
              故事／世界觀
              <textarea rows={6} value={story} maxLength={8000} onChange={(e) => setStory(e.target.value)} placeholder="貼上故事後可讓 AI 依此重新生成整個專案" />
            </label>
            <button className="btn primary small" disabled={!bridge?.available || aiBusy || story.trim().length < 10} onClick={() => runAi("generate")}>
              {aiBusy ? "AI 處理中…" : "依故事重新生成"}
            </button>
            <button className="btn small" disabled={!bridge?.available || aiBusy || report.isValid} onClick={() => runAi("repair")}>
              AI 修復驗證錯誤
            </button>
            <button className="btn small" disabled title="尚未實作">
              AI 局部修改（尚未實作）
            </button>
            {aiLog.length > 0 && (
              <div className="stack small" style={{ gap: 2 }}>
                {aiLog.map((l, i) => (
                  <div key={i} className="muted">
                    {l}
                  </div>
                ))}
              </div>
            )}
            <div className="small muted">AI 結果會先放進編輯區、不會自動儲存；原本已儲存的版本仍可用「捨棄修改」或「復原」找回。</div>
          </div>
        </aside>
      </div>
    </>
  );
}
