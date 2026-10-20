import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/PwaSupport";

export const metadata: Metadata = {
  title: "AI RPG Builder",
  description: "把故事、世界觀與角色設定轉換成可在瀏覽器遊玩的 2D RPG。",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  // iPhone 從主畫面開啟時隱藏 Safari 介面（這是 iPhone 上唯一能全螢幕的方式）
  appleWebApp: { capable: true, title: "AI RPG", statusBarStyle: "black-translucent" },
};

// 手機上鎖定縮放，避免遊戲操作時誤觸放大；viewport-fit=cover 讓虛擬手把可以避開瀏海與 Home 條
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-TW">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
