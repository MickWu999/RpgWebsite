"use client";

import { Suspense } from "react";
import SettingsPage from "@/components/studio/pages/SettingsPage";

export default function Page() {
  return (
    <Suspense fallback={<div className="shell-loading muted">載入中…</div>}>
      <SettingsPage />
    </Suspense>
  );
}
