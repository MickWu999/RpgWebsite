"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PLAYER_SITE_URL, studioApi, type AdminOverview, type AdminPlayerDetail, type AdminPlayerRow } from "@/lib/studioApi";
import StudioShell, { PageHeader } from "../StudioShell";

/**
 * 營運：誰在玩、玩了什麼。玩家是匿名的裝置代號，靠邀請連結（?from=）或玩家自己留的暱稱認出是誰；不記錄 IP。
 * 這些紀錄同時會整理成 AI 案例庫（見各專案總覽的「遊玩數據」與 remote insights）。
 */

const time = (iso: string) => new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const DEVICE_LABEL: Record<string, string> = { mobile: "手機", tablet: "平板", desktop: "電腦" };

/** 玩家的顯示名稱：暱稱 → 邀請來源 → 匿名代號 */
export function playerName(p: { visitor: string; nickname?: string | null; invite?: string | null }) {
  if (p.nickname) return p.invite ? `${p.nickname}（${p.invite} 的邀請）` : p.nickname;
  if (p.invite) return `${p.invite} 的邀請`;
  return `匿名 #${p.visitor.slice(0, 6)}`;
}

const EVENT_LABEL: Record<string, string> = {
  load: "下載遊戲",
  start: "開始遊戲",
  chapter: "進入章節",
  chapter_done: "完成章節",
  ending: "抵達結局",
  leave: "離開",
  achievement: "解鎖成就",
  interact: "對話／調查",
  choice: "選擇",
  transfer: "前往",
  item: "物品",
  quest: "任務",
  menu: "開選單",
  save: "存檔",
  load_save: "讀檔",
  setting: "改設定",
  error: "錯誤",
};

function describe(e: AdminPlayerDetail["events"][number]) {
  const extra = e.type === "choice" ? `「${e.detail ?? e.value}」` : e.type === "item" ? `${e.ref} ${e.value && e.value > 0 ? "+" : ""}${e.value}` : e.type === "quest" ? `${e.ref}（${e.detail}）` : e.type === "setting" ? `${e.ref} → ${e.detail}` : e.type === "leave" ? `玩了 ${e.value} 分鐘` : e.type === "load" ? `${e.value} KB` : (e.detail ?? e.ref ?? "");
  return `${EVENT_LABEL[e.type] ?? e.type}　${extra}`;
}

function Overview({ o, titles }: { o: AdminOverview; titles: Map<string, string> }) {
  const max = Math.max(1, ...o.daily.map((d) => d.visitors));
  const group = (k: AdminOverview["groups"][number]["k"]) =>
    o.groups
      .filter((g) => g.k === k)
      .sort((a, b) => b.n - a.n)
      .map((g) => `${(k === "device" ? DEVICE_LABEL[g.v ?? ""] : g.v) ?? "未知"} ${g.n}`)
      .join("、") || "-";
  return (
    <>
      <div className="card stats-row" data-testid="admin-overview">
        {[
          ["玩家總數", o.visitors],
          ["今天", o.today],
          ["近 7 天", o.week],
          ["近 30 天", o.month],
          ["遊玩次數", o.sessions],
          ["平均每次", o.avgMinutes ? `${o.avgMinutes.toFixed(1)} 分鐘` : "-"],
        ].map(([label, value]) => (
          <div key={label} className="stat">
            <div className="small muted">{label}</div>
            <div className="stat-value">{value}</div>
          </div>
        ))}
      </div>
      <div className="card stack">
        <h2>近 30 天每日玩家</h2>
        {o.daily.length === 0 ? (
          <div className="small muted">還沒有資料。</div>
        ) : (
          <div className="bars">
            {o.daily.map((d) => (
              <div key={d.day} className="bar" title={`${d.day}：${d.visitors} 人`}>
                <div className="bar-fill" style={{ height: `${(d.visitors / max) * 100}%` }} />
                <div className="bar-label">{d.day.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="small">
          <b>裝置</b>：{group("device")}　<b>系統</b>：{group("os")}　<b>瀏覽器</b>：{group("browser")}　<b>地區</b>：{group("country")}
        </div>
        <div className="small">
          <b>各遊戲</b>：{o.games.map((g) => `${titles.get(g.game_id) ?? g.game_id} ${g.visitors} 人／${g.sessions} 次`).join("、") || "-"}
        </div>
        {o.recentErrors.length > 0 && (
          <div className="small err-text">
            <b>近 7 天的頁面錯誤</b>：{o.recentErrors.map((e) => `${e.detail}（${titles.get(e.game_id) ?? e.game_id}，${e.n} 次）`).join("；")}
          </div>
        )}
      </div>
    </>
  );
}

function InviteLink() {
  const [name, setName] = useState("");
  const base = PLAYER_SITE_URL || "（請在 .env.local 設定 NEXT_PUBLIC_PLAYER_URL）";
  const who = name.trim() || "朋友的名字";
  // 畫面上顯示中文方便閱讀，複製時用編碼過的網址（所有通訊軟體都能正確開啟）
  const link = `${base}/?from=${who}`;
  const copyLink = `${base}/?from=${encodeURIComponent(who)}`;
  return (
    <div className="card stack">
      <h2>邀請連結</h2>
      <div className="small muted">分享給朋友時，每個人給一個專屬連結。朋友第一次用這個連結打開網站，玩家列表就會顯示「名字 的邀請」，不需要記錄 IP。也可以用來分辨來源，例如「FB社團」。</div>
      <div className="row">
        <input type="text" maxLength={20} placeholder="朋友的名字或來源" value={name} onChange={(e) => setName(e.target.value)} data-testid="invite-name" />
        <button className="btn small" disabled={!name.trim() || !PLAYER_SITE_URL} onClick={() => void navigator.clipboard?.writeText(copyLink)}>
          複製連結
        </button>
      </div>
      <code className="copyable" data-testid="invite-link">
        {link}
      </code>
    </div>
  );
}

function PlayerList({ rows, total, titles }: { rows: AdminPlayerRow[]; total: number; titles: Map<string, string> }) {
  return (
    <div className="card stack">
      <h2>玩家（{total} 位）</h2>
      {rows.length === 0 ? (
        <div className="small muted">還沒有玩家。玩家在玩家網站開始玩之後，這裡會列出每一位（匿名裝置代號，靠邀請連結或暱稱認出是誰）。</div>
      ) : (
        <table className="version-table" data-testid="player-list">
          <thead>
            <tr>
              <th>玩家</th>
              <th>裝置</th>
              <th>地區</th>
              <th>第一次來</th>
              <th>最近一次</th>
              <th>次數</th>
              <th>玩過</th>
              <th>進度</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.visitor}>
                <td className="small">
                  <Link href={`/studio/players/?v=${p.visitor}`}>{playerName(p)}</Link>
                </td>
                <td className="small">{[DEVICE_LABEL[p.device ?? ""] ?? p.device, p.os, p.browser].filter(Boolean).join("・") || "-"}</td>
                <td className="small">{p.country ?? "-"}</td>
                <td className="small muted">{time(p.first_seen)}</td>
                <td className="small muted">{time(p.last_seen)}</td>
                <td className="small">{p.sessions}</td>
                <td className="small">{(p.games ?? "").split(",").filter(Boolean).map((g) => titles.get(g) ?? g).join("、") || "-"}</td>
                <td className="small">
                  {p.last_chapter ?? "-"}
                  {p.endings ? `・結局 ${p.endings} 次` : ""}・{p.events} 個操作
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PlayerDetail({ visitor, titles }: { visitor: string; titles: Map<string, string> }) {
  const [d, setD] = useState<AdminPlayerDetail | null>(null);
  useEffect(() => {
    studioApi
      .adminPlayer(visitor)
      .then(setD)
      .catch(() => setD({ info: null, sessions: [], events: [] }));
  }, [visitor]);
  if (!d) return <div className="card small muted">載入中…</div>;
  const bySession = new Map<string, AdminPlayerDetail["events"]>();
  for (const e of [...d.events].reverse()) bySession.set(e.session, [...(bySession.get(e.session) ?? []), e]);
  return (
    <div className="stack" data-testid="player-detail">
      <Link className="btn small" href="/studio/players/">
        ← 回到玩家列表
      </Link>
      <div className="card stack">
        <h2>{d.info ? playerName(d.info) : `匿名 #${visitor.slice(0, 6)}`}</h2>
        {d.info && (
          <div className="small">
            {[DEVICE_LABEL[d.info.device ?? ""] ?? d.info.device, d.info.os, d.info.browser, d.info.lang, d.info.country].filter(Boolean).join("・")}　第一次來 {time(d.info.first_seen)}・最近 {time(d.info.last_seen)}・共 {d.info.sessions} 次
          </div>
        )}
      </div>
      {d.sessions.map((s) => (
        <details key={s.session} className="card" open={s === d.sessions[0]}>
          <summary>
            <b>{titles.get(s.game_id) ?? s.game_id}</b>　{time(s.started_at)}・約 {Math.max(1, Math.round((Date.parse(s.last_at) - Date.parse(s.started_at)) / 60000))} 分鐘・{s.events} 個操作
            {s.screen ? `・${s.screen}` : ""}
            {s.touch_mode ? `・觸控：${s.touch_mode === "pad" ? "方向鍵＋A" : "直接點擊"}` : ""}
          </summary>
          <div className="timeline">
            {(bySession.get(s.session) ?? []).map((e, i) => (
              <div key={i} className={`small${e.type === "error" ? " err-text" : ""}`}>
                <span className="muted">{new Date(e.created_at).toLocaleTimeString("zh-TW", { hour12: false })}</span>　{e.chapter_id ? <span className="badge">{e.chapter_id}</span> : null} {describe(e)}
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

export default function PlayersPage() {
  const visitor = useSearchParams().get("v");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [players, setPlayers] = useState<{ total: number; rows: AdminPlayerRow[] } | null>(null);
  const [titles, setTitles] = useState(new Map<string, string>());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    studioApi
      .adminOverview()
      .then((r) => setOverview(r.overview))
      .catch((e: Error) => setError(e.message));
    studioApi
      .adminPlayers(100, 0)
      .then((r) => setPlayers({ total: r.total, rows: r.players }))
      .catch(() => {});
    studioApi
      .listProjects()
      .then((r) => setTitles(new Map([...r.projects.map((p) => [p.id, p.title] as const), ["demo-lantern", "燈塔示範"]])))
      .catch(() => {});
  }, []);
  return (
    <StudioShell>
      <div className="page stack">
        <PageHeader title="營運" subtitle="誰在玩、玩了什麼。玩家是匿名的；分享時用邀請連結，或請玩家留暱稱，就知道是誰。這些紀錄也會整理成 AI 案例庫。" />
        {error && <div className="notice err">{error}</div>}
        {visitor ? (
          <PlayerDetail visitor={visitor} titles={titles} />
        ) : (
          <>
            {overview && <Overview o={overview} titles={titles} />}
            <InviteLink />
            {players && <PlayerList rows={players.rows} total={players.total} titles={titles} />}
          </>
        )}
      </div>
    </StudioShell>
  );
}
