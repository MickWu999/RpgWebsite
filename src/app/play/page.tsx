"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import GameScreen from "@/components/game/GameScreen";
import NotifyPrompt from "@/components/NotifyPrompt";

/** /play/?pack=<id> 從遊戲庫下載模組包並遊玩 */
function PlayPage() {
  const id = useSearchParams().get("pack") ?? "demo-lantern";
  return (
    <>
      <GameScreen key={id} source={{ kind: "pack", id }} />
      <NotifyPrompt delay={2500} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="rm-stage" />}>
      <PlayPage />
    </Suspense>
  );
}
