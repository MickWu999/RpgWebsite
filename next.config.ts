import type { NextConfig } from "next";

// 純靜態輸出，可直接部署到 Cloudflare（Workers 靜態資源或 Pages）。
// 遊戲、編輯、驗證與存檔都在瀏覽器端執行；AI 生成只在本機（scripts/ai-server.ts）執行。
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,
};

export default nextConfig;
