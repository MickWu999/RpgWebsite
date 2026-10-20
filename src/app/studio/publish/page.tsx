"use client";

import { Suspense } from "react";
import PublishPage from "@/components/studio/pages/PublishPage";

export default function Page() {
  return (
    <Suspense fallback={<div className="shell-loading muted">載入中…</div>}>
      <PublishPage />
    </Suspense>
  );
}
