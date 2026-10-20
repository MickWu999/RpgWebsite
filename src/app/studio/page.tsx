"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import StudioView from "@/components/StudioView";
import { DEMO_PROJECT_ID } from "@/game/storage";

function StudioPage() {
  const id = useSearchParams().get("id") ?? DEMO_PROJECT_ID;
  return <StudioView key={id} projectId={id} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="container muted">載入中…</div>}>
      <StudioPage />
    </Suspense>
  );
}
