"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import CoverArt from "@/components/game/CoverArt";
import IssueList from "@/components/IssueList";
import { coverDataOf } from "@/game/cover";
import type { GameProject } from "@/game/schema";
import { studioApi, type CheckResult, type VersionEntry } from "@/lib/studioApi";
import StudioShell, { PageHeader } from "../StudioShell";

/**
 * 專案總覽：製作進度清單（依專案內容自動打勾，每一步都有「前往」）、規模與時長、封面預覽、最近版本。
 * 讓第一次使用的人照著清單做，就能完成一款可以發布的 RPG。
 */

type Step = { done: boolean; title: string; how: string; href: string; cta: string };

function steps(p: GameProject, id: string, check: CheckResult | null, published: boolean): Step[] {
  const edit = `/studio/edit/?id=${id}`;
  const terrainKinds = new Set(p.scenes.flatMap((s) => [...(s.terrain ?? []).join("")]));
  const interactables = p.scenes.reduce((n, s) => n + (s.interactables?.length ?? 0), 0);
  const placeholder = p.endings.some((e) => e.id === "end_placeholder");
  return [
    { done: p.description !== "（待補）" && p.description.length >= 10, title: "1. 寫下遊戲名稱與簡介", how: "在「資料庫 → 系統」設定名稱、簡介、開場訊息與封面。", href: `${edit}&db=system`, cta: "開啟系統設定" },
    { done: terrainKinds.size >= 4, title: "2. 畫出地圖", how: "在「地圖」模式選圖塊，在畫布上拖曳繪製道路、房屋、樹林。需要更多地圖時按地圖清單的「＋」。", href: edit, cta: "開啟地圖編輯器" },
    { done: p.scenes.length >= 2 && p.scenes.some((s) => s.exits.length > 0), title: "3. 用出口連接地圖", how: "切到「事件」模式，在地圖邊緣雙擊空格 →「＋ 出口」，設定要通往哪張地圖。雙向通行要兩邊各放一個。", href: edit, cta: "放置出口" },
    { done: p.npcs.length >= 2, title: "4. 放置 NPC", how: "「事件」模式雙擊空格 →「＋ NPC」，設定名稱、角色圖與聲音。至少 2 位。", href: edit, cta: "放置 NPC" },
    { done: p.dialogues.length >= 8, title: "5. 撰寫對話", how: "在「資料庫 → 對話」編輯台詞，加上選項、下一句與效果（例如給道具、設定旗標）。", href: `${edit}&db=dialogues`, cta: "開啟對話" },
    { done: interactables >= 2, title: "6. 加入調查點", how: "「事件」模式雙擊門、告示牌、寶箱 →「＋ 調查點」。玩家按確認時會看到回應，避免迷路。至少 2 個。", href: edit, cta: "放置調查點" },
    { done: p.quests.some((q) => q.objectives.length >= 3), title: "7. 建立任務", how: "在「資料庫 → 任務」設定目標（和誰說話、收集什麼、去哪裡），目標會依序完成。", href: `${edit}&db=quests`, cta: "開啟任務" },
    { done: p.endings.length >= 2 && !placeholder, title: "8. 設定結局", how: "在「資料庫 → 結局」設定 2～4 個結局與達成條件，並用「尾聲」回應玩家的選擇。", href: `${edit}&db=endings`, cta: "開啟結局" },
    { done: Boolean(check?.playtest?.ok && check.validation.errors.length === 0), title: "9. 通過檢查與自動試玩", how: "系統會驗證所有引用，並自動把每個結局玩過一遍。錯誤會列在下方。", href: `/studio/publish/?id=${id}`, cta: "查看檢查結果" },
    { done: published, title: "10. 發布到玩家網站", how: "通過檢查後在「發布」頁按下發布，玩家網站會立即出現這款遊戲。", href: `/studio/publish/?id=${id}`, cta: "前往發布" },
  ];
}

export default function ProjectOverview() {
  const id = useSearchParams().get("id") ?? "";
  const [data, setData] = useState<{ project: GameProject; version: number } | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    studioApi
      .getProject(id)
      .then((r) => setData({ project: r.project, version: r.version }))
      .catch((e: Error) => setError(e.message));
    studioApi.check(id).then(setCheck).catch(() => {});
    studioApi.versions(id).then((r) => setVersions(r.versions.slice(0, 6))).catch(() => {});
    studioApi
      .listProjects()
      .then((r) => setPublished(Boolean(r.projects.find((p) => p.id === id)?.published_version)))
      .catch(() => {});
  }, [id]);

  const cover = useMemo(() => (data ? coverDataOf(data.project) : null), [data]);
  if (error) {
    return (
      <StudioShell>
        <div className="page">
          <div className="notice err">{error}</div>
        </div>
      </StudioShell>
    );
  }
  if (!data || !cover) {
    return (
      <StudioShell>
        <div className="page muted">載入中…</div>
      </StudioShell>
    );
  }
  const p = data.project;
  const list = steps(p, id, check, published);
  const doneCount = list.filter((s) => s.done).length;
  const next = list.find((s) => !s.done);
  const minutes = check?.quality?.metrics.duration?.typicalMinutes;

  return (
    <StudioShell title={p.title}>
      <div className="page">
        <PageHeader
          title={p.title}
          subtitle={`第 ${data.version} 版・${p.description}`}
          actions={
            <>
              <Link className="btn primary" href={`/studio/edit/?id=${id}`} data-testid="open-editor">
                開啟編輯器
              </Link>
              <Link className="btn" href={`/studio/play/?id=${id}`} target="_blank">
                ▶ 測試遊玩
              </Link>
            </>
          }
        />
        <div className="overview-grid">
          <section className="card stack" data-testid="checklist">
            <div className="row">
              <h2 className="grow" style={{ margin: 0 }}>
                製作進度
              </h2>
              <span className="badge ok">
                {doneCount} / {list.length}
              </span>
            </div>
            <div className="progress">
              <span style={{ width: `${(doneCount / list.length) * 100}%` }} />
            </div>
            {next && (
              <div className="next-step">
                <div className="small muted">下一步</div>
                <b>{next.title}</b>
                <div className="small">{next.how}</div>
                <Link className="btn small primary" href={next.href} style={{ marginTop: 8 }}>
                  {next.cta} →
                </Link>
              </div>
            )}
            <div className="steps">
              {list.map((s) => (
                <div key={s.title} className={`step${s.done ? " done" : ""}`}>
                  <span className="step-mark">{s.done ? "✓" : "○"}</span>
                  <div className="grow">
                    <div>{s.title}</div>
                    {!s.done && <div className="small muted">{s.how}</div>}
                  </div>
                  <Link className="btn small" href={s.href}>
                    {s.cta}
                  </Link>
                </div>
              ))}
            </div>
          </section>

          <div className="stack">
            <section className="card">
              <div className="overview-cover">
                <CoverArt cover={cover} />
                <div className="game-card-title">{p.title}</div>
              </div>
            </section>
            <section className="card">
              <h2>規模</h2>
              <div className="stat-grid">
                <div><b>{p.scenes.length}</b><span>地圖</span></div>
                <div><b>{p.npcs.length}</b><span>NPC</span></div>
                <div><b>{p.dialogues.length}</b><span>對話</span></div>
                <div><b>{p.quests.length}</b><span>任務</span></div>
                <div><b>{p.items.length}</b><span>物品</span></div>
                <div><b>{p.endings.length}</b><span>結局</span></div>
              </div>
              <div className="small muted" style={{ marginTop: 8 }}>
                預估遊玩時間：{minutes ? `${minutes[0]}～${minutes[1]} 分鐘` : check ? "需要先通過驗證才能估算" : "計算中…"}
              </div>
            </section>
            {check && check.validation.errors.length > 0 && (
              <section className="card">
                <h2>待修正（{check.validation.errors.length}）</h2>
                <IssueList errors={check.validation.errors.slice(0, 6)} warnings={[]} />
              </section>
            )}
            <section className="card">
              <div className="row">
                <h2 className="grow" style={{ margin: 0 }}>
                  最近的修改
                </h2>
                <Link className="small" href={`/studio/versions/?id=${id}`}>
                  全部 →
                </Link>
              </div>
              {versions.map((v) => (
                <div key={v.version} className="version-line small">
                  <span className="badge">v{v.version}</span> <span className={v.actor.includes("API Token") ? "actor-ai" : "actor-human"}>{v.actor.includes("API Token") ? "🤖" : "👤"} {v.actor}</span>
                  <div className="muted">{v.label}</div>
                </div>
              ))}
            </section>
          </div>
        </div>
      </div>
    </StudioShell>
  );
}
