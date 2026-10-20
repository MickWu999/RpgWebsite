import type { ValidationIssue } from "@/game/validate";

export default function IssueList({ errors, warnings, limit = 30 }: { errors: ValidationIssue[]; warnings: ValidationIssue[]; limit?: number }) {
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="issues">
      {errors.slice(0, limit).map((e, i) => (
        <div key={`e${i}`} className="issue err">
          <div>✗ {e.message}</div>
          {e.path && <div className="path">{e.path}</div>}
        </div>
      ))}
      {warnings.slice(0, limit).map((w, i) => (
        <div key={`w${i}`} className="issue warn">
          <div>⚠ {w.message}</div>
          {w.path && <div className="path">{w.path}</div>}
        </div>
      ))}
      {errors.length + warnings.length > limit * 2 && <div className="small muted">（僅顯示前 {limit} 筆）</div>}
    </div>
  );
}
