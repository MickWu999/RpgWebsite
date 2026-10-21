"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { achievementList } from "@/game/achievements";
import { commandAt } from "@/game/refs";
import type { GameProject } from "@/game/schema";
import { PLAYER_SITE_URL, studioApi, type AdminOverview, type AdminPlayerDetail, type AdminPlayerRow, type FeedbackEntry, type GameInsights, type NoticeRow, type PlayAnalytics } from "@/lib/studioApi";
import StudioShell, { PageHeader } from "../StudioShell";

/**
 * 營運與系統管理的頁面（一般後台的樣子）：
 * - 儀表板：全站的玩家與遊玩次數、每款遊戲的完成情況
 * - 玩家：誰在玩（匿名裝置代號＋邀請連結／暱稱），單一玩家的時間軸
 * - 玩家回饋：所有遊戲的星等與留言
 * - 遊戲數據：單一遊戲的漏斗、每章時間、選擇比例、卡關、沒人發現的事件
 * - 通知：發出公告並推播給開啟通知的玩家（新章節、更新、修正、新遊戲推出）
 * - 登入紀錄：後台的登入（含 IP）
 * 每個數字都附一句定義，避免看不懂；這些紀錄同時會整理成 AI 案例庫。
 */

const time = (iso: string) => new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const DEVICE_LABEL: Record<string, string> = { mobile: "手機", tablet: "平板", desktop: "電腦" };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");

/** 玩家的顯示名稱：暱稱 → 邀請來源 → 匿名代號 */
export function playerName(p: { visitor: string; nickname?: string | null; invite?: string | null }) {
  if (p.nickname) return p.invite ? `${p.nickname}（${p.invite} 的邀請）` : p.nickname;
  if (p.invite) return `${p.invite} 的邀請`;
  return `匿名 #${p.visitor.slice(0, 6)}`;
}

/** 一個指標：數字＋名稱＋一句定義 */
function Metric({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="metric" title={hint}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-hint">{hint}</div>
    </div>
  );
}

/** 橫向長條：名稱、長度、數字 */
function Bar({ label, value, max, note }: { label: string; value: number; max: number; note?: string }) {
  return (
    <div className="hbar">
      <div className="hbar-label" title={label}>
        {label}
      </div>
      <div className="hbar-track">
        <div className="hbar-fill" style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%` }} />
      </div>
      <div className="hbar-value">
        {value}
        {note ? <span className="muted">　{note}</span> : null}
      </div>
    </div>
  );
}

function Section({ title, how, children }: { title: string; how: string; children: React.ReactNode }) {
  return (
    <section className="card stack">
      <h2>{title}</h2>
      <div className="small muted">怎麼看：{how}</div>
      {children}
    </section>
  );
}

/** 各遊戲的名稱（專案標題；內建示範另外命名） */
function useTitles() {
  const [titles, setTitles] = useState(new Map<string, string>());
  useEffect(() => {
    studioApi
      .listProjects()
      .then((r) => setTitles(new Map([...r.projects.map((p) => [p.id, p.title] as const), ["demo-lantern", "燈塔示範"]])))
      .catch(() => {});
  }, []);
  return titles;
}

// ---------------------------------------------------------------------------
// 儀表板

export function DashboardPage() {
  const titles = useTitles();
  const [o, setO] = useState<AdminOverview | null>(null);
  /** 近 30 天，每一天都列出來（沒有玩家的日子是 0），圖表才不會只剩一根很寬的長條 */
  const [days, setDays] = useState<Array<{ day: string; visitors: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    studioApi
      .adminOverview()
      .then((r) => {
        setO(r.overview);
        const byDay = new Map(r.overview.daily.map((d) => [d.day, d.visitors]));
        setDays(
          Array.from({ length: 30 }, (_, i) => {
            const day = new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10);
            return { day, visitors: byDay.get(day) ?? 0 };
          }),
        );
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  const group = (k: AdminOverview["groups"][number]["k"]) =>
    (o?.groups ?? [])
      .filter((g) => g.k === k)
      .sort((a, b) => b.n - a.n)
      .map((g) => ({ label: (k === "device" ? DEVICE_LABEL[g.v ?? ""] : g.v) ?? "未知", n: g.n }));
  const max = Math.max(1, ...days.map((d) => d.visitors));
  return (
    <StudioShell title="營運">
      <div className="page stack">
        <PageHeader title="儀表板" subtitle="全站的玩家與遊玩情況。玩家是匿名的裝置代號；想知道是誰，分享時用「玩家」頁的邀請連結。" />
        {error && <div className="notice err">{error}</div>}
        {!o ? (
          <div className="card small muted">載入中…</div>
        ) : (
          <>
            <div className="metrics" data-testid="admin-overview">
              <Metric label="玩家" value={o.visitors} hint="不同的裝置數（同一台裝置換網路仍算同一位）" />
              <Metric label="今天活躍" value={o.today} hint="今天有打開遊戲的玩家" />
              <Metric label="近 7 天活躍" value={o.week} hint="最近 7 天有打開遊戲的玩家" />
              <Metric label="近 30 天活躍" value={o.month} hint="最近 30 天有打開遊戲的玩家" />
              <Metric label="遊玩次數" value={o.sessions} hint="打開遊戲到離開算一次" />
              <Metric label="平均每次" value={o.avgMinutes != null ? `${o.avgMinutes.toFixed(1)} 分` : "-"} hint="每次遊玩從開始到最後一個操作的時間" />
            </div>
            <Section title="各遊戲" how="開始＝按下新遊戲或繼續；通關＝抵達任何結局（含連載的章末）。通關率低，代表很多人中途放棄，點進「遊戲數據」看卡在哪裡。">
              {o.games.length === 0 ? (
                <div className="small muted">還沒有人玩過。</div>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>遊戲</th>
                      <th>玩家</th>
                      <th>遊玩次數</th>
                      <th>開始</th>
                      <th>通關</th>
                      <th>通關率</th>
                      <th>平均每次</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {o.games.map((g) => (
                      <tr key={g.game_id}>
                        <td>{titles.get(g.game_id) ?? g.game_id}</td>
                        <td>{g.visitors}</td>
                        <td>{g.sessions}</td>
                        <td>{g.starters}</td>
                        <td>{g.finishers}</td>
                        <td>{pct(g.finishers, g.starters)}</td>
                        <td>{g.avgMinutes != null ? `${g.avgMinutes.toFixed(1)} 分` : "-"}</td>
                        <td>
                          <Link className="btn small" href={`/studio/stats/?id=${g.game_id}`}>
                            遊戲數據
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
            <Section title="近 30 天每日玩家" how="每天有打開遊戲的玩家數（同一位玩家一天只算一次）。">
              <div className="bars">
                {days.map((d, i) => (
                  <div key={d.day} className="bar" title={`${d.day}：${d.visitors} 人`}>
                    <div className="bar-value">{d.visitors || ""}</div>
                    <div className="bar-fill" style={{ height: `${(d.visitors / max) * 100}%`, minHeight: d.visitors ? 3 : 0 }} />
                    <div className="bar-label">{i % 5 === 4 || i === 29 ? d.day.slice(5) : ""}</div>
                  </div>
                ))}
              </div>
            </Section>
            <div className="grid-2">
              {(["device", "os", "browser", "country"] as const).map((k) => {
                const rows = group(k);
                const top = Math.max(1, ...rows.map((r) => r.n));
                return (
                  <Section key={k} title={{ device: "裝置", os: "系統", browser: "瀏覽器", country: "地區" }[k]} how={k === "country" ? "Cloudflare 判斷的國家或地區代碼，不記錄 IP。" : "玩家第一次來時的裝置。"}>
                    {rows.length === 0 ? <div className="small muted">-</div> : rows.map((r) => <Bar key={r.label} label={r.label} value={r.n} max={top} note={pct(r.n, o.visitors)} />)}
                  </Section>
                );
              })}
            </div>
            {o.recentErrors.length > 0 && (
              <Section title="近 7 天的頁面錯誤" how="玩家瀏覽器回報的錯誤；同一則出現很多次就要修。">
                {o.recentErrors.map((e, i) => (
                  <div key={i} className="small err-text">
                    {e.detail}（{titles.get(e.game_id) ?? e.game_id}，{e.n} 次）
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </StudioShell>
  );
}

// ---------------------------------------------------------------------------
// 玩家

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
  const extra =
    e.type === "choice"
      ? `「${e.detail ?? e.value}」`
      : e.type === "item"
        ? `${e.ref} ${e.value && e.value > 0 ? "+" : ""}${e.value}`
        : e.type === "quest"
          ? `${e.ref}（${e.detail}）`
          : e.type === "setting"
            ? `${e.ref} → ${e.detail}`
            : e.type === "leave"
              ? `玩了 ${e.value} 分鐘`
              : e.type === "load"
                ? `${e.value} KB`
                : (e.detail ?? e.ref ?? "");
  return `${EVENT_LABEL[e.type] ?? e.type}　${extra}`;
}

function InviteLink() {
  const [name, setName] = useState("");
  const base = PLAYER_SITE_URL || "（請在 .env.local 設定 NEXT_PUBLIC_PLAYER_URL）";
  const who = name.trim() || "朋友的名字";
  // 畫面上顯示中文方便閱讀，複製時用編碼過的網址（所有通訊軟體都能正確開啟）
  const link = `${base}/?from=${who}`;
  const copyLink = `${base}/?from=${encodeURIComponent(who)}`;
  return (
    <Section title="邀請連結" how="分享給朋友時，每個人給一個專屬連結。朋友第一次用這個連結打開網站，下面的列表就會顯示「名字 的邀請」，不需要記錄 IP。也可以用來分辨來源，例如「FB社團」。">
      <div className="row">
        <input type="text" maxLength={20} placeholder="朋友的名字或來源" value={name} onChange={(e) => setName(e.target.value)} data-testid="invite-name" />
        <button className="btn small" disabled={!name.trim() || !PLAYER_SITE_URL} onClick={() => void navigator.clipboard?.writeText(copyLink)}>
          複製連結
        </button>
      </div>
      <code className="copyable" data-testid="invite-link">
        {link}
      </code>
    </Section>
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

export function PlayersPage() {
  const visitor = useSearchParams().get("v");
  const titles = useTitles();
  const [players, setPlayers] = useState<{ total: number; rows: AdminPlayerRow[] } | null>(null);
  useEffect(() => {
    studioApi
      .adminPlayers(100, 0)
      .then((r) => setPlayers({ total: r.total, rows: r.players }))
      .catch(() => setPlayers({ total: 0, rows: [] }));
  }, []);
  return (
    <StudioShell title="營運">
      <div className="page stack">
        <PageHeader title="玩家" subtitle="誰在玩、玩到哪裡。玩家是匿名的裝置代號；靠邀請連結或玩家自己留的暱稱認出是誰，不記錄 IP。" />
        {visitor ? (
          <PlayerDetail visitor={visitor} titles={titles} />
        ) : (
          <>
            <InviteLink />
            <Section title={`玩家列表${players ? `（${players.total} 位）` : ""}`} how="點名稱看這位玩家每一次遊玩的完整時間軸。「進度」是最後所在的章節。">
              {!players ? (
                <div className="small muted">載入中…</div>
              ) : players.rows.length === 0 ? (
                <div className="small muted">還沒有玩家。</div>
              ) : (
                <table className="admin-table" data-testid="player-list">
                  <thead>
                    <tr>
                      <th>玩家</th>
                      <th>裝置</th>
                      <th>地區</th>
                      <th>第一次來</th>
                      <th>最近一次</th>
                      <th>遊玩次數</th>
                      <th>玩過</th>
                      <th>進度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {players.rows.map((p) => (
                      <tr key={p.visitor}>
                        <td>
                          <Link href={`/studio/players/?v=${p.visitor}`}>{playerName(p)}</Link>
                        </td>
                        <td>{[DEVICE_LABEL[p.device ?? ""] ?? p.device, p.os, p.browser].filter(Boolean).join("・") || "-"}</td>
                        <td>{p.country ?? "-"}</td>
                        <td className="muted">{time(p.first_seen)}</td>
                        <td className="muted">{time(p.last_seen)}</td>
                        <td>{p.sessions}</td>
                        <td>
                          {(p.games ?? "")
                            .split(",")
                            .filter(Boolean)
                            .map((g) => titles.get(g) ?? g)
                            .join("、") || "-"}
                        </td>
                        <td>
                          {p.last_chapter ?? "-"}
                          {p.endings ? `・結局 ${p.endings} 次` : ""}・{p.events} 個操作
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          </>
        )}
      </div>
    </StudioShell>
  );
}

// ---------------------------------------------------------------------------
// 玩家回饋（所有遊戲）

export function FeedbackPage() {
  const titles = useTitles();
  const [rows, setRows] = useState<Array<FeedbackEntry & { game_id: string }> | null>(null);
  const [game, setGame] = useState("");
  useEffect(() => {
    studioApi
      .adminFeedback()
      .then((r) => setRows(r.feedback))
      .catch(() => setRows([]));
  }, []);
  const list = (rows ?? []).filter((r) => !game || r.game_id === game);
  const avg = list.length ? (list.reduce((n, r) => n + r.rating, 0) / list.length).toFixed(1) : "-";
  const tags = new Map<string, number>();
  list.forEach((r) => r.tags.forEach((t) => tags.set(t, (tags.get(t) ?? 0) + 1)));
  const topTag = Math.max(1, ...tags.values());
  return (
    <StudioShell title="營運">
      <div className="page stack">
        <PageHeader title="玩家回饋" subtitle="玩家玩完一章時留下的星等、標籤與留言。這些也會整理進 AI 案例庫。" />
        <div className="row">
          <select value={game} onChange={(e) => setGame(e.target.value)}>
            <option value="">所有遊戲</option>
            {[...new Set((rows ?? []).map((r) => r.game_id))].map((g) => (
              <option key={g} value={g}>
                {titles.get(g) ?? g}
              </option>
            ))}
          </select>
        </div>
        {!rows ? (
          <div className="card small muted">載入中…</div>
        ) : (
          <>
            <div className="metrics">
              <Metric label="回饋數" value={list.length} hint="玩完一章時送出的回饋（同一位玩家同一章只算最新一筆）" />
              <Metric label="平均星等" value={avg} hint="1～5 顆星" />
            </div>
            <Section title="最常被選的標籤" how="正面標籤（好笑、感動）代表做對的地方；負面標籤（卡關、不知道下一步）代表要修的地方。">
              {tags.size === 0 ? <div className="small muted">-</div> : [...tags].sort((a, b) => b[1] - a[1]).map(([t, n]) => <Bar key={t} label={t} value={n} max={topTag} />)}
            </Section>
            <Section title="留言" how="最新的在最上面。">
              {list.length === 0 ? (
                <div className="small muted">還沒有回饋。</div>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>時間</th>
                      <th>遊戲／章節</th>
                      <th>星等</th>
                      <th>標籤</th>
                      <th>留言</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r, i) => (
                      <tr key={i}>
                        <td className="muted">{time(r.created_at)}</td>
                        <td>
                          {titles.get(r.game_id) ?? r.game_id}／{r.chapter_id}
                        </td>
                        <td>{"★".repeat(r.rating)}</td>
                        <td>{r.tags.join("、")}</td>
                        <td>{r.comment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          </>
        )}
      </div>
    </StudioShell>
  );
}

// ---------------------------------------------------------------------------
// 遊戲數據（單一遊戲）

export function GameStatsPage() {
  const id = useSearchParams().get("id") ?? "";
  const [project, setProject] = useState<GameProject | null>(null);
  const [a, setA] = useState<PlayAnalytics | null>(null);
  const [ins, setIns] = useState<GameInsights | null>(null);
  useEffect(() => {
    if (!id) return;
    studioApi.getProject(id).then((r) => setProject(r.project)).catch(() => {});
    studioApi.analytics(id).then((r) => setA(r.analytics)).catch(() => {});
    studioApi.insights(id).then((r) => setIns(r.insights)).catch(() => {});
  }, [id]);
  const top = Math.max(1, a?.loads ?? 0, a?.starters ?? 0);
  const label = (locator: string) => (project ? (commandAt(project, locator)?.label ?? locator) : locator);
  const achv = project ? achievementList(project) : [];
  return (
    <StudioShell title={project?.title}>
      <div className="page stack">
        <PageHeader title="遊戲數據" subtitle="玩家實際怎麼玩這款遊戲。這些也會自動整理進 AI 案例庫（remote insights），修改或擴充前先看。" />
        {!a ? (
          <div className="card small muted">載入中…</div>
        ) : a.visitors === 0 ? (
          <div className="card small muted">還沒有人玩過這款遊戲。發布後，玩家在玩家網站遊玩的紀錄會出現在這裡。</div>
        ) : (
          <>
            <div className="metrics" data-testid="game-stats">
              <Metric label="玩家" value={a.visitors} hint="玩過這款遊戲的不同裝置" />
              <Metric label="遊玩次數" value={a.sessions} hint="打開遊戲到離開算一次" />
              <Metric label="平均每位玩家" value={a.minutes ? `${(a.minutes / a.visitors).toFixed(1)} 分` : "-"} hint="所有遊玩時間加總除以玩家數" />
              <Metric label="通關率" value={pct(a.finishers, a.starters)} hint="開始的玩家裡，抵達任何結局（含章末）的比例" />
            </div>
            <Section title="漏斗：玩家在哪一步流失" how="每一條是「做到這一步的玩家數」，百分比以「開始遊戲」為 100%；章節的「完成」是進入這一章的玩家裡完成的比例。長條突然變短的地方，就是玩家放棄的地方。">
              <Bar label="下載遊戲" value={a.loads} max={top} />
              <Bar label="開始遊戲" value={a.starters} max={top} note="100%" />
              {(project?.chapters ?? []).map((c, i) => {
                const row = a.chapters.find((x) => x.chapter_id === c.id);
                return (
                  <div key={c.id}>
                    <Bar label={`第 ${i + 1} 章 進入`} value={row?.entered ?? 0} max={top} note={pct(row?.entered ?? 0, a.starters)} />
                    <Bar label={`第 ${i + 1} 章 完成`} value={row?.done ?? 0} max={top} note={`${pct(row?.done ?? 0, row?.entered ?? 0)}${row?.minutes ? `・平均 ${row.minutes.toFixed(0)} 分鐘` : ""}`} />
                  </div>
                );
              })}
              <Bar label="抵達結局" value={a.finishers} max={top} note={pct(a.finishers, a.starters)} />
            </Section>
            <div className="grid-2">
              <Section title="結局" how="每個結局有幾位玩家看到。">
                {a.endings.length === 0 ? (
                  <div className="small muted">還沒有人抵達結局。</div>
                ) : (
                  a.endings.map((e) => <Bar key={e.ref} label={project?.endings.find((x) => x.id === e.ref)?.title ?? e.ref} value={e.players} max={a.finishers || 1} />)
                )}
              </Section>
              <Section title="成就解鎖率" how="開始遊戲的玩家裡，解鎖這個成就的比例。太低可能藏得太深，太高可能太簡單。">
                {achv.length === 0 ? (
                  <div className="small muted">這款遊戲沒有成就。</div>
                ) : (
                  achv.map((x) => {
                    const n = ins?.achievements.find((y) => y.ref === x.id)?.players ?? 0;
                    return <Bar key={x.id} label={x.title} value={n} max={a.starters || 1} note={pct(n, a.starters)} />;
                  })
                )}
              </Section>
            </div>
            <Section title="玩家怎麼選" how="每個選擇的各選項比例。幾乎一面倒（85% 以上）可能是假抉擇，或其他選項不吸引人。">
              {!ins ? (
                <div className="small muted">載入中…</div>
              ) : ins.choices.length === 0 ? (
                <div className="small muted">還沒有選擇紀錄。</div>
              ) : (
                ins.choices.map((c) => (
                  <div key={c.locator} className="choice-block">
                    <div className="small">
                      <b>{label(c.locator)}</b> <span className="muted">（{c.total} 人）</span>
                      {c.lopsided && <span className="badge err">一面倒</span>}
                    </div>
                    {c.options.map((o) => (
                      <Bar key={o.value} label={o.text ?? `選項 ${o.value + 1}`} value={o.n} max={c.total} note={`${o.pct}%`} />
                    ))}
                  </div>
                ))
              )}
            </Section>
            <div className="grid-2">
              <Section title="卡關的地方" how="同一次遊玩裡，兩次進度之間停了超過 2 分鐘（中間沒有離開頁面）。代表玩家可能不知道下一步。">
                {!ins ? (
                  <div className="small muted">載入中…</div>
                ) : ins.stuck.length === 0 ? (
                  <div className="small muted">沒有明顯卡關的地方。</div>
                ) : (
                  ins.stuck.map((s) => <Bar key={s.place} label={s.place} value={s.sessions} max={Math.max(...ins.stuck.map((x) => x.sessions))} note={`平均 ${s.avgMinutes} 分、最久 ${s.maxMinutes} 分`} />)
                )}
              </Section>
              <Section title="最常離開的地方" how="還沒破關的玩家，最後一次離開時所在的章節與地圖。">
                {a.quits.length === 0 ? (
                  <div className="small muted">-</div>
                ) : (
                  a.quits.map((q, i) => <Bar key={i} label={`${q.chapter_id ?? "?"}・${project?.maps.find((m) => m.id === q.ref)?.name ?? q.ref ?? "?"}`} value={q.players} max={Math.max(...a.quits.map((x) => x.players))} />)
                )}
              </Section>
            </div>
            <Section title="從來沒人觸發的事件" how="可以按確定鍵、但從來沒有玩家觸發過的事件（玩家 3 人以上才判斷）。可能太隱密、沒有引導，或玩家不知道可以調查。">
              {!ins ? <div className="small muted">載入中…</div> : ins.unseen.length === 0 ? <div className="small muted">沒有。</div> : <div className="small">{ins.unseen.map((u) => `${u.map}／${u.name}`).join("、")}</div>}
            </Section>
            {ins && ins.errors.length > 0 && (
              <Section title="頁面錯誤" how="玩家瀏覽器回報的錯誤。">
                {ins.errors.map((e, i) => (
                  <div key={i} className="small err-text">
                    {e.detail}（{e.n} 次）
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </StudioShell>
  );
}

// ---------------------------------------------------------------------------
// 通知（推播）

const NOTICE_KIND_LABEL: Record<NoticeRow["kind"], string> = { chapter: "📖 新章節", update: "✨ 更新", fix: "🔧 修正", new_game: "🎮 新遊戲推出" };
const NOTICE_TEMPLATE: Record<NoticeRow["kind"], (game: string) => { title: string; body: string }> = {
  chapter: (g) => ({ title: `《${g}》新章節上線`, body: "接著上次的進度繼續玩吧！" }),
  update: (g) => ({ title: `《${g}》更新了`, body: "" }),
  fix: (g) => ({ title: `《${g}》問題修正`, body: "" }),
  new_game: (g) => ({ title: `新遊戲《${g}》推出`, body: "" }),
};

export function NoticesPage() {
  const [data, setData] = useState<{ notices: NoticeRow[]; subscribers: number; ready: boolean } | null>(null);
  const [games, setGames] = useState<Array<{ id: string; title: string }>>([]);
  const [kind, setKind] = useState<NoticeRow["kind"]>("chapter");
  const [game, setGame] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () =>
    studioApi
      .notices()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void reload();
    studioApi
      .listProjects()
      .then((r) => setGames(r.projects.filter((p) => p.published_version).map((p) => ({ id: p.id, title: p.title }))))
      .catch(() => {});
  }, []);
  const fill = (k: NoticeRow["kind"], g: string) => {
    const name = games.find((x) => x.id === g)?.title;
    if (!name) return;
    const t = NOTICE_TEMPLATE[k](name);
    setTitle(t.title);
    setBody(t.body);
  };
  const url = game ? `/play/?pack=${game}` : "/";
  const send = async () => {
    if (!data) return;
    if (!window.confirm(`要把這則公告推播給 ${data.subscribers} 位開啟通知的玩家嗎？送出後無法收回。`)) return;
    setError(null);
    try {
      await studioApi.createNotice({ kind, title, body, url, gameId: game || undefined });
      setProgress("已送出，正在推播給玩家（人數多時，排程會每分鐘接著送）");
      setTitle("");
      setBody("");
      void reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <StudioShell title="營運">
      <div className="page stack">
        <PageHeader title="通知" subtitle="通知會在發布時自動發出：新遊戲推出、新章節上線、附了更新說明的更新／修正（同一款遊戲 12 小時內最多一次）。修改途中反覆發布不會通知玩家。這裡是發送紀錄，也可以補發其他公告。" />
        {data && !data.ready && <div className="notice err">推播金鑰還沒設定，只會建立公告、不會推播。請在後台 Worker 設定 VAPID_PRIVATE_JWK、VAPID_PUBLIC_KEY、VAPID_SUBJECT。</div>}
        <div className="metrics">
          <Metric label="開啟通知的玩家" value={data?.subscribers ?? "-"} hint="同一位玩家用不同瀏覽器或裝置開啟，會各算一位；取消訂閱或清除瀏覽器資料的會在下次推播時自動移除" />
          <Metric label="已發出的通知" value={data ? data.notices.filter((n) => n.done !== 2).length : "-"} hint="最近 50 則（不含基準紀錄）" />
        </div>
        <section className="card stack" data-testid="notice-form">
          <h2>補發公告（選用）</h2>
          <div className="small muted">平常不需要用：發布時會自動通知。只有活動、維護公告這類跟發布無關的消息才在這裡發。</div>
          <div className="row">
            <label className="field">
              類型
              <select
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as NoticeRow["kind"];
                  setKind(k);
                  fill(k, game);
                }}
              >
                {(Object.keys(NOTICE_KIND_LABEL) as NoticeRow["kind"][]).map((k) => (
                  <option key={k} value={k}>
                    {NOTICE_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              遊戲（點通知後開啟）
              <select
                value={game}
                onChange={(e) => {
                  setGame(e.target.value);
                  fill(kind, e.target.value);
                }}
              >
                <option value="">玩家網站首頁</option>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            標題（60 字內）
            <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="例如：《最後一個會哭的人》第 2 章上線" data-testid="notice-title" />
          </label>
          <label className="field">
            內容（200 字內）
            <textarea value={body} maxLength={200} onChange={(e) => setBody(e.target.value)} placeholder="一兩句話說明更新了什麼" data-testid="notice-body" />
          </label>
          <div className="small muted">
            玩家看到的樣子：<b>{NOTICE_KIND_LABEL[kind].split(" ")[0]} {title || "（標題）"}</b>　{body || "（內容）"}　→ 開啟 <code>{url}</code>
          </div>
          <div className="row">
            <button className="btn primary" disabled={!title.trim() || !body.trim() || !data} onClick={send} data-testid="notice-send">
              📣 送出通知
            </button>
            {progress && <span className="small">{progress}</span>}
            {error && <span className="small err-text">{error}</span>}
          </div>
        </section>
        <section className="card">
          <h2>發送紀錄</h2>
          {!data ? (
            <div className="small muted">載入中…</div>
          ) : data.notices.length === 0 ? (
            <div className="small muted">還沒有發過通知。</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>類型</th>
                  <th>標題與內容</th>
                  <th>送達</th>
                  <th>發送者</th>
                </tr>
              </thead>
              <tbody>
                {data.notices.map((n) => (
                  <tr key={n.id}>
                    <td>{time(n.created_at)}</td>
                    <td>{NOTICE_KIND_LABEL[n.kind] ?? n.kind}</td>
                    <td>
                      <b>{n.title}</b>
                      <div className="small muted">
                        {n.body}　<code>{n.url}</code>
                      </div>
                    </td>
                    <td>
                      {n.done === 2 ? (
                        <span className="small muted">基準紀錄（不推播）</span>
                      ) : (
                        <>
                          {n.sent}
                          {n.failed ? <span className="small muted">（失敗 {n.failed}）</span> : null}
                          {n.done === 0 && <span className="badge warn">送出中</span>}
                        </>
                      )}
                    </td>
                    <td>{n.author}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </StudioShell>
  );
}

// 登入紀錄（系統管理）

type LoginRow = Awaited<ReturnType<typeof studioApi.logins>>["logins"][number];

export function LoginsPage() {
  const [logins, setLogins] = useState<LoginRow[] | null>(null);
  const [failed, setFailed] = useState(0);
  useEffect(() => {
    studioApi
      .logins()
      .then((r) => {
        setLogins(r.logins);
        const weekAgo = Date.now() - 7 * 864e5;
        setFailed(r.logins.filter((l) => !l.success && Date.parse(l.created_at) > weekAgo).length);
      })
      .catch(() => setLogins([]));
  }, []);
  const ips = new Set((logins ?? []).filter((l) => l.success).map((l) => l.ip)).size;
  return (
    <StudioShell title="系統管理">
      <div className="page stack">
        <PageHeader title="登入紀錄" subtitle="登入 Studio 的紀錄（保留 90 天）。帳號是共用的，記錄 IP 才能發現陌生人登入；看到不認識的 IP、地區，或失敗次數異常，請到帳號設定修改密碼。" />
        <div className="metrics">
          <Metric label="近 7 天登入失敗" value={failed} hint="密碼錯誤的次數；同一帳號或 IP 15 分鐘內失敗 5 次會被暫時鎖定" />
          <Metric label="登入過的 IP" value={ips} hint="最近 100 筆成功登入裡，不同的 IP 數" />
        </div>
        <section className="card" data-testid="login-log">
          {!logins ? (
            <div className="small muted">載入中…</div>
          ) : logins.length === 0 ? (
            <div className="small muted">還沒有紀錄。</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>帳號（操作者）</th>
                  <th>IP</th>
                  <th>地區</th>
                  <th>裝置</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {logins.map((l, i) => (
                  <tr key={i}>
                    <td>{new Date(l.created_at).toLocaleString("zh-TW", { hour12: false })}</td>
                    <td>
                      {l.username}
                      {l.operator ? `（${l.operator}）` : ""}
                    </td>
                    <td>
                      <code>{l.ip}</code>
                    </td>
                    <td>{l.country ?? "-"}</td>
                    <td>{l.device}</td>
                    <td>{l.success ? <span className="badge ok">成功</span> : <span className="badge err">失敗</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </StudioShell>
  );
}
