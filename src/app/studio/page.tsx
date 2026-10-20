"use client";

import { Suspense } from "react";
import ProjectsPage from "@/components/studio/pages/ProjectsPage";

export default function Page() {
  return (
    <Suspense fallback={<div className="shell-loading muted">載入中…</div>}>
      <ProjectsPage />
    </Suspense>
  );
}
