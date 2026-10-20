/** AI 流程最終狀態的顯示文字與 badge 樣式 */
export const STATUS_LABELS: Record<string, [string, string]> = {
  approved: ["審查通過", "ok"],
  needs_human_review: ["需要人工 review", "warn"],
  unreviewed: ["未審查", "warn"],
  edited: ["已手動修改", ""],
  fixture: ["demo 範本", ""],
};
