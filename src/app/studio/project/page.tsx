"use client";

import { Suspense } from "react";
import ProjectOverview from "@/components/studio/pages/ProjectOverview";

export default function Page() {
  return (
    <Suspense fallback={<div className="shell-loading muted">載入中…</div>}>
      <ProjectOverview />
    </Suspense>
  );
}
