"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** 註冊 service worker（只在 production build；開發模式不快取，避免看到舊版） */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 註冊失敗不影響遊玩，只是沒有離線功能
    });
  }, []);
  return null;
}

/**
 * 首頁的安裝提示：
 * - Android／桌面 Chrome：攔下 beforeinstallprompt，顯示「安裝」按鈕
 * - iPhone／iPad Safari：沒有安裝提示，顯示「分享 → 加入主畫面」說明（安裝後才能真正全螢幕）
 */
export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || (navigator as { standalone?: boolean }).standalone === true;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const frame = requestAnimationFrame(() => {
      setInstalled(standalone);
      setIosHint(ios && !standalone);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;
  if (installEvent) {
    return (
      <button
        className="btn"
        data-testid="install-app"
        onClick={async () => {
          await installEvent.prompt();
          const choice = await installEvent.userChoice;
          if (choice.outcome === "accepted") setInstalled(true);
          setInstallEvent(null);
        }}
      >
        📲 安裝到主畫面（可離線、全螢幕）
      </button>
    );
  }
  if (iosHint) {
    return <div className="notice info small">📲 iPhone／iPad：點 Safari 的「分享」→「加入主畫面」，從主畫面開啟即可全螢幕遊玩、離線也能玩。</div>;
  }
  return null;
}
