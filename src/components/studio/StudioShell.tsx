"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { studioApi } from "@/lib/studioApi";

/**
 * Studio 應用程式外框：左側導覽（專案 → 專案內的各工具 → AI 協作），底部是帳號選單（帳號設定、登出），並負責登入檢查。
 * 所有後台頁面都包在這個外框裡；後台不連到前台。
 */

type NavItem = { href: string; icon: string; label: string; hint: string; external?: boolean };

export default function StudioShell({ children, title, fullBleed = false }: { children: React.ReactNode; title?: string; fullBleed?: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const projectId = params.get("id");
  const db = params.get("db");
  const [user, setUser] = useState<string | null>(null);
  const [operator, setOperator] = useState<string | null>(null);

  useEffect(() => {
    studioApi
      .me()
      .then((r) => {
        setUser(r.user.username);
        setOperator(r.operator);
      })
      .catch(() => {
        // 401 時 studioApi 會自動導向登入頁
      });
  }, []);

  const projectNav: NavItem[] = projectId
    ? [
        { href: `/studio/project/?id=${projectId}`, icon: "🏠", label: "總覽", hint: "製作進度清單與專案狀態" },
        { href: `/studio/edit/?id=${projectId}`, icon: "🗺", label: "地圖與事件", hint: "繪製地圖、放置 NPC 與調查點" },
        { href: `/studio/edit/?id=${projectId}&db=actors`, icon: "📚", label: "資料庫", hint: "角色、物品、任務、結局、章節、開關、系統" },
        { href: `/studio/play/?id=${projectId}`, icon: "▶", label: "測試遊玩", hint: "在新分頁從頭玩一次", external: true },
        { href: `/studio/stats/?id=${projectId}`, icon: "📈", label: "遊戲數據", hint: "玩家實際怎麼玩：漏斗、每章時間、選擇比例、卡關、沒人發現的事件" },
        { href: `/studio/versions/?id=${projectId}`, icon: "🕘", label: "版本紀錄", hint: "每次儲存與 AI 操作的紀錄，可還原" },
        { href: `/studio/publish/?id=${projectId}`, icon: "🚀", label: "發布", hint: "檢查通過後發布到玩家網站" },
      ]
    : [];
  // 一般後台的分區：製作、營運、系統管理（個人的密碼、操作者、登出放在左下角的帳號選單）
  const makeNav: NavItem[] = [{ href: "/studio/ai/", icon: "🤖", label: "AI 協作", hint: "讓 VS Code 的 Claude Code 製作遊戲；API Token、使用說明、審查規則" }];
  const opsNav: NavItem[] = [
    { href: "/studio/dashboard/", icon: "📊", label: "儀表板", hint: "全站的玩家與遊玩情況、每款遊戲的通關率" },
    { href: "/studio/players/", icon: "👥", label: "玩家", hint: "誰在玩、玩到哪裡；邀請連結" },
    { href: "/studio/feedback/", icon: "💬", label: "玩家回饋", hint: "所有遊戲的星等、標籤與留言" },
    { href: "/studio/notices/", icon: "📣", label: "通知", hint: "發出公告並推播給開啟通知的玩家：新章節、更新、修正、新遊戲推出" },
  ];
  const systemNav: NavItem[] = [{ href: "/studio/logins/", icon: "🔐", label: "登入紀錄", hint: "Studio 的登入紀錄（含 IP），發現陌生人登入" }];
  const [menu, setMenu] = useState(false);
  const isActive = (href: string) => {
    const [p, q] = href.split("?");
    if (p === "/studio/ai/" && (pathname.startsWith("/studio/help") || pathname.startsWith("/studio/rules"))) return true;
    if (!pathname.startsWith(p.replace(/\/$/, ""))) return false;
    if (q?.includes("db=")) return Boolean(db);
    if (p.startsWith("/studio/edit") && db) return false;
    return true;
  };
  const link = (item: NavItem) => (
    <Link
      key={item.href}
      href={item.href}
      className={`shell-nav-item${isActive(item.href) ? " active" : ""}`}
      title={item.hint}
      target={item.external ? "_blank" : undefined}
      data-testid={`nav-${item.label}`}
    >
      <span className="shell-icon">{item.icon}</span>
      <span className="shell-label">{item.label}</span>
    </Link>
  );

  return (
    <div className="studio-shell">
      <aside className="shell-sidebar">
        <Link href="/studio/" className="shell-brand" title="專案列表">
          <span className="shell-logo">◆</span>
          <span className="shell-label">
            AI RPG <b>Studio</b>
          </span>
        </Link>
        <nav className="shell-nav">
          <div className="shell-section shell-label">製作</div>
          <Link href="/studio/" className={`shell-nav-item${pathname.replace(/\/$/, "") === "/studio" ? " active" : ""}`} title="所有專案" data-testid="nav-專案">
            <span className="shell-icon">📁</span>
            <span className="shell-label">專案</span>
          </Link>
          {projectNav.length > 0 && (
            <div className="shell-subnav">
              <div className="shell-section shell-label">{title ?? "目前專案"}</div>
              {projectNav.map(link)}
            </div>
          )}
          {makeNav.map(link)}
          <div className="shell-section shell-label">營運</div>
          {opsNav.map(link)}
          <div className="shell-section shell-label">系統管理</div>
          {systemNav.map(link)}
        </nav>
        <nav className="shell-nav shell-bottom">
          <div className="shell-user-wrap">
            <button className={`shell-user${menu ? " open" : ""}`} onClick={() => setMenu((v) => !v)} data-testid="user-menu">
              <span className="shell-icon">👤</span>
              <span className="shell-label">{user ? (operator ? `${operator}（${user}）` : user) : "…"}</span>
              <span className="shell-label shell-caret">▾</span>
            </button>
            {menu && (
              <div className="shell-user-menu" role="menu">
                <button
                  className="shell-user-item"
                  role="menuitem"
                  data-testid="set-operator"
                  onClick={async () => {
                    const name = window.prompt("你的名字（多人共用帳號時，用來記錄是誰做的修改；留空就只顯示帳號）", operator ?? "");
                    if (name === null) return;
                    const r = await studioApi.setOperator(name).catch(() => null);
                    if (!r) return;
                    setOperator(r.operator);
                    try {
                      window.localStorage.setItem("studio:operator", r.operator ?? "");
                    } catch {
                      // 記不住也沒關係
                    }
                  }}
                >
                  ✎ 操作者：{operator ?? "未填寫"}
                </button>
                <Link href="/studio/settings/" className="shell-user-item" role="menuitem">
                  ⚙ 帳號設定
                </Link>
                <button
                  className="shell-user-item"
                  role="menuitem"
                  onClick={async () => {
                    await studioApi.logout().catch(() => {});
                    window.location.href = "/studio/login/";
                  }}
                >
                  ↪ 登出
                </button>
              </div>
            )}
          </div>
        </nav>
      </aside>
      <main className={`shell-main${fullBleed ? " full" : ""}`}>{user ? children : <div className="shell-loading muted">確認登入狀態…</div>}</main>
    </div>
  );
}

/** 頁面標題列 */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}
