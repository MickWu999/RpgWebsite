"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { DbTab } from "@/components/studio/Database";
import StudioApp from "@/components/studio/StudioApp";
import StudioShell from "@/components/studio/StudioShell";

/** /studio/edit/?id=<專案>[&db=<資料庫分頁>]：RPG Maker 式編輯器 */
function EditPage() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  return (
    <StudioShell fullBleed>
      <StudioApp key={id} projectId={id} initialDb={(params.get("db") as DbTab | null) ?? null} />
    </StudioShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="shell-loading muted">載入中…</div>}>
      <EditPage />
    </Suspense>
  );
}
