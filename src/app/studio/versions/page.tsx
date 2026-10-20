"use client";

import { Suspense } from "react";
import VersionsPage from "@/components/studio/pages/VersionsPage";

export default function Page() {
  return (
    <Suspense fallback={<div className="shell-loading muted">載入中…</div>}>
      <VersionsPage />
    </Suspense>
  );
}
