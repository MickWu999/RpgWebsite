"use client";

import { Suspense } from "react";
import { DashboardPage } from "@/components/studio/pages/OpsPages";

export default function Page() {
  return (
    <Suspense fallback={<div className="shell-loading muted">載入中…</div>}>
      <DashboardPage />
    </Suspense>
  );
}
