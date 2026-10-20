"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import GameScreen, { type TestStart } from "@/components/game/GameScreen";

/**
 * 後台測試遊玩：讀取雲端專案的最新版本（不需要先發布）。
 * ?chapter=<章節ID> 從某一章開始；?map=<地圖ID>&x=&y= 從指定位置開始（編輯器的「從這裡測試」）。
 */
function StudioPlay() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const chapter = params.get("chapter");
  const map = params.get("map");
  const x = params.get("x");
  const y = params.get("y");
  const test = useMemo<TestStart | undefined>(() => {
    if (!chapter && !map) return undefined;
    return { ...(chapter ? { chapterId: chapter } : {}), ...(map ? { at: { mapId: map, x: Number(x ?? 0), y: Number(y ?? 0) } } : {}) };
  }, [chapter, map, x, y]);
  return <GameScreen key={`${id}:${chapter}:${map}:${x}:${y}`} source={{ kind: "studio", id, test }} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="rm-stage" />}>
      <StudioPlay />
    </Suspense>
  );
}
