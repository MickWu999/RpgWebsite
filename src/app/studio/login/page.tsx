"use client";

import { Suspense } from "react";
import LoginPage from "@/components/studio/pages/LoginPage";

export default function Page() {
  return (
    <Suspense fallback={<div className="shell-loading muted">載入中…</div>}>
      <LoginPage />
    </Suspense>
  );
}
