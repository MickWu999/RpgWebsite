"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import GameScreen from "@/components/game/GameScreen";

/** 後台測試遊玩：讀取雲端專案的最新版本（不需要先發布） */
function StudioPlay() {
  const id = useSearchParams().get("id") ?? "";
  return <GameScreen key={id} source={{ kind: "studio", id }} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="rm-stage" />}>
      <StudioPlay />
    </Suspense>
  );
}
