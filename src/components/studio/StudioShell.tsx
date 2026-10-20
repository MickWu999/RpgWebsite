"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { studioApi } from "@/lib/studioApi";

/**
 * Studio 應用程式外框：左側導覽（專案 → 專案內的各工具 → AI 協作、設定、說明），並負責登入檢查。
 * 所有後台頁面都包在這個外框裡；後台不連到前台。
 */

type NavItem = { href: string; icon: string; label: string; hint: string; external?: boolean };

export default function StudioShell({ children, title, fullBleed = false }: { children: React.ReactNode; title?: string; fullBleed?: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const projectId = params.get("id");
  const db = params.get("db");
  const [user, setUser] = useState<string | null>(null);

  useEffect(() => {
    studioApi
      .me()
      .then((r) => setUser(r.user.username))
      .catch(() => {
        // 401 時 studioApi 會自動導向登入頁
      });
  }, []);

  const projectNav: NavItem[] = projectId
    ? [
        { href: `/studio/project/?id=${projectId}`, icon: "🏠", label: "總覽", hint: "製作進度清單與專案狀態" },
        { href: `/studio/edit/?id=${projectId}`, icon: "🗺", label: "地圖與事件", hint: "繪製地圖、放置 NPC 與調查點" },
        { href: `/studio/edit/?id=${projectId}&db=dialogues`, icon: "📚", label: "資料庫", hint: "對話、任務、物品、結局、系統設定" },
        { href: `/studio/play/?id=${projectId}`, icon: "▶", label: "測試遊玩", hint: "在新分頁從頭玩一次", external: true },
        { href: `/studio/versions/?id=${projectId}`, icon: "🕘", label: "版本紀錄", hint: "每次儲存與 AI 操作的紀錄，可還原" },
        { href: `/studio/publish/?id=${projectId}`, icon: "🚀", label: "發布", hint: "檢查通過後發布到玩家網站" },
      ]
    : [];
  const bottomNav: NavItem[] = [
    { href: "/studio/ai/", icon: "🤖", label: "AI 協作", hint: "產生 API Token，讓 AI agent 操作 Studio" },
    { href: "/studio/settings/", icon: "⚙", label: "設定", hint: "帳號與密碼" },
    { href: "/studio/help/", icon: "❓", label: "說明", hint: "新手教學、名詞解釋、快捷鍵" },
  ];
  const isActive = (href: string) => {
    const [p, q] = href.split("?");
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
          <Link href="/studio/" className={`shell-nav-item${pathname.replace(/\/$/, "") === "/studio" ? " active" : ""}`} title="所有專案" data-testid="nav-專案">
            <span className="shell-icon">📁</span>
            <span className="shell-label">專案</span>
          </Link>
          {projectNav.length > 0 && (
            <>
              <div className="shell-section shell-label">{title ?? "目前專案"}</div>
              {projectNav.map(link)}
            </>
          )}
        </nav>
        <nav className="shell-nav shell-bottom">
          {bottomNav.map(link)}
          <div className="shell-user">
            <span className="shell-icon">👤</span>
            <span className="shell-label">
              {user ?? "…"}
              <button
                className="link-button"
                onClick={async () => {
                  await studioApi.logout().catch(() => {});
                  window.location.href = "/studio/login/";
                }}
              >
                登出
              </button>
            </span>
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
