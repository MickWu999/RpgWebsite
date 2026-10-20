"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import CreatorOnly from "@/components/CreatorOnly";
import StudioApp from "@/components/studio/StudioApp";
import StudioHome from "@/components/studio/StudioHome";

/** /studio：Studio 首頁（專案列表）；/studio/?id=<專案>：RPG Maker 式編輯器 */
function StudioPage() {
  const id = useSearchParams().get("id");
  return id ? <StudioApp key={id} projectId={id} /> : <StudioHome />;
}

export default function Page() {
  return (
    <CreatorOnly>
      <Suspense fallback={<div className="container muted">載入中…</div>}>
        <StudioPage />
      </Suspense>
    </CreatorOnly>
  );
}
