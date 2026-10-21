"use client";

import { Suspense } from "react";
import AiPage from "@/components/studio/pages/AiPage";

export default function Page() {
  return (
    <Suspense fallback={<div className="shell-loading muted">載入中…</div>}>
      <AiPage tab="rules" />
    </Suspense>
  );
}
