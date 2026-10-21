"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { downloadJson } from "@/game/storage";
import type { GameProject } from "@/game/schema";
import { studioApi, type VersionEntry } from "@/lib/studioApi";
import { diffProjects, type DiffEntry } from "@/studio/diff";
import StudioShell, { PageHeader } from "../StudioShell";

/** 版本紀錄（類似 Jenkins 建置紀錄）：每次儲存與 AI 操作都會留下一版，可下載或還原 */
export default function VersionsPage() {
  const id = useSearchParams().get("id") ?? "";
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ from: number; to: number; entries: DiffEntry[] } | null>(null);
  const fetchVersion = (v: number) => fetch(`/api/projects/${id}/versions/${v}`, { credentials: "same-origin" }).then((x) => x.json() as Promise<{ project: GameProject }>);
  // 和上一版比較：讓人快速確認 AI 這一版改了什麼
  const showDiff = async (from: number, to: number) => {
    const [a, b] = await Promise.all([fetchVersion(from), fetchVersion(to)]);
    setDiff({ from, to, entries: diffProjects(a.project, b.project) });
  };
  const load = () => studioApi.versions(id).then((r) => setVersions(r.versions));
  useEffect(() => {
    if (id) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <StudioShell>
      <div className="page">
        <PageHeader title="版本紀錄" subtitle="每次儲存（👤 人）或 AI 操作（🤖 API Token）都會留下一個版本。最多保留最近 60 版。" />
        {notice && <div className="notice info">{notice}</div>}
        <div className="card">
          <table className="version-table" data-testid="versions">
            <thead>
              <tr>
                <th>版本</th>
                <th>操作者</th>
                <th>內容</th>
                <th>時間</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {versions?.map((v, i) => (
                <tr key={v.version}>
                  <td>
                    <span className="badge">v{v.version}</span> {i === 0 && <span className="badge ok">目前</span>}
                  </td>
                  <td className={v.actor.includes("API Token") ? "actor-ai" : "actor-human"}>
                    {v.actor.includes("API Token") ? "🤖" : "👤"} {v.actor}
                  </td>
                  <td className="small">{v.label}</td>
                  <td className="small muted">{new Date(v.created_at).toLocaleString("zh-TW", { hour12: false })}</td>
                  <td className="row" style={{ justifyContent: "flex-end" }}>
                    {versions[i + 1] && (
                      <button className="btn small" data-testid="version-diff" onClick={() => void showDiff(versions[i + 1].version, v.version)}>
                        差異
                      </button>
                    )}
                    <button
                      className="btn small"
                      onClick={async () => {
                        const r = await fetch(`/api/projects/${id}/versions/${v.version}`, { credentials: "same-origin" }).then((x) => x.json());
                        downloadJson(`${id}-v${v.version}.json`, JSON.stringify(r.project, null, 2));
                      }}
                    >
                      下載
                    </button>
                    {i > 0 && (
                      <button
                        className="btn small"
                        onClick={async () => {
                          if (!window.confirm(`還原到第 ${v.version} 版？目前內容會保留在版本紀錄中，之後仍可再還原回來。`)) return;
                          const r = await studioApi.restore(id, v.version);
                          setNotice(`已還原，成為新的第 ${r.version} 版`);
                          void load();
                        }}
                      >
                        還原
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {diff && (
          <div className="card" data-testid="diff-panel">
            <h2>
              v{diff.from} → v{diff.to} 改了什麼 <span className="badge">{diff.entries.length} 項</span>{" "}
              <button className="btn small" onClick={() => setDiff(null)}>
                關閉
              </button>
            </h2>
            {diff.entries.length === 0 && <div className="small muted">兩個版本的內容相同。</div>}
            {diff.entries.map((d, i) => (
              <div key={i} className={`issue ${d.change === "removed" ? "err" : d.change === "added" ? "" : "warn"}`}>
                <div>
                  <span className="badge">{d.change === "added" ? "新增" : d.change === "removed" ? "刪除" : "修改"}</span> {d.area}：{d.label}
                </div>
                {d.details.map((x, j) => (
                  <div key={j} className="path">
                    {x}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </StudioShell>
  );
}
