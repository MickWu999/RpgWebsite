/**
 * 網站版本（build 時決定）：
 * - player：部署給玩家的版本（npm run deploy），只有遊戲入口與遊戲畫面
 * - creator：開發者版本（npm run dev 預設），另外提供 /create（建立遊戲、AI 生成、我的專案）與 /studio
 */
export const IS_PLAYER_SITE = process.env.NEXT_PUBLIC_SITE_MODE === "player";
