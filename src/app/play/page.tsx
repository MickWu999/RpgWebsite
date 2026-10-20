"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import GameScreen from "@/components/game/GameScreen";
import { DEMO_PROJECT_ID } from "@/game/storage";

function PlayPage() {
  const id = useSearchParams().get("id") ?? DEMO_PROJECT_ID;
  return <GameScreen key={id} projectId={id} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="rm-stage" />}>
      <PlayPage />
    </Suspense>
  );
}
