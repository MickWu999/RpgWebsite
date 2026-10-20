"use client";

import { Suspense } from "react";
import HelpPage from "@/components/studio/pages/HelpPage";

export default function Page() {
  return (
    <Suspense fallback={<div className="shell-loading muted">載入中…</div>}>
      <HelpPage />
    </Suspense>
  );
}
