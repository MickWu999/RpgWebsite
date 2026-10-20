import Link from "next/link";
import { IS_PLAYER_SITE } from "@/lib/siteMode";

/** 開發者工具頁面在玩家版網站不提供 */
export default function CreatorOnly({ children }: { children: React.ReactNode }) {
  if (!IS_PLAYER_SITE) return <>{children}</>;
  return (
    <div className="container">
      <div className="notice info">這個頁面只在開發者版本提供。</div>
      <p>
        <Link href="/">回到遊戲首頁</Link>
      </p>
    </div>
  );
}
