"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import GameScreen, { type GameSource } from "@/components/game/GameScreen";
import { DEMO_PROJECT_ID } from "@/game/storage";

/** /play/?pack=<id> 從遊戲庫下載模組包；/play/?id=<id> 讀取瀏覽器中的本機專案（Studio 編輯、匯入、AI 生成） */
function PlayPage() {
  const params = useSearchParams();
  const pack = params.get("pack");
  const source: GameSource = pack ? { kind: "pack", id: pack } : { kind: "local", id: params.get("id") ?? DEMO_PROJECT_ID };
  return <GameScreen key={`${source.kind}:${source.id}`} source={source} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="rm-stage" />}>
      <PlayPage />
    </Suspense>
  );
}
