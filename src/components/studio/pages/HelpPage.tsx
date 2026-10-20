"use client";

import StudioShell, { PageHeader } from "../StudioShell";

/** 說明：新手教學、名詞解釋、快捷鍵、AI 協作 */
export default function HelpPage() {
  return (
    <StudioShell>
      <div className="page help">
        <PageHeader title="說明" subtitle="第一次使用 Studio？照著「15 分鐘做出第一款遊戲」走一遍就會了。" />
        <section className="card">
          <h2>15 分鐘做出第一款遊戲</h2>
          <ol>
            <li>到「專案」按「＋ 新增專案」，選「從範本開始」。</li>
            <li>進入專案「總覽」，照著<b>製作進度清單</b>一步步做。每一步都有「前往」按鈕。</li>
            <li>在「地圖與事件」：上方切到 <b>🖌 地圖</b> 模式，選圖塊，在畫布上拖曳繪製；切到 <b>❗ 事件</b> 模式，雙擊格子放置 NPC、調查點、出口。</li>
            <li>按 <b>📚 資料庫</b>（或 F9）寫對話、任務、物品、結局。</li>
            <li>隨時按 <b>▶ 測試遊玩</b>（或 F5）從頭玩一次。</li>
            <li>到「發布」執行檢查，全部通過後按「發布」。</li>
          </ol>
        </section>
        <section className="card">
          <h2>名詞解釋</h2>
          <dl className="glossary">
            <dt>事件</dt>
            <dd>地圖上可以互動的東西：NPC、調查點（門、告示、寶箱）、撿取物、出口、地點、玩家起點。</dd>
            <dt>事件頁（分頁）</dt>
            <dd>同一個 NPC 或調查點，依條件顯示不同的對話。由上往下，第一個條件成立的分頁生效；都不成立時用「預設分頁」。例如：拿到鑰匙後，門的回應從「鎖著」變成「打開了」。</dd>
            <dt>旗標</dt>
            <dd>記錄玩家做過什麼的開關，例如 <code>accepted_quest = true</code>。對話選項的「效果」可以設定旗標，條件可以讀取旗標。設定了卻從沒被讀取的旗標，會被品質檢查指出（代表那個選擇沒有後果）。</dd>
            <dt>任務目標</dt>
            <dd>依序完成：和 NPC 說話、收集物品、抵達地點、做出選擇、調查物件。全部完成後發放獎勵。</dd>
            <dt>結局與尾聲</dt>
            <dd>結局由條件決定（建議至少 2 個條件組合）；「尾聲」會依玩家其他選擇追加描述，不必增加結局數量就能回應更多選擇。</dd>
            <dt>自動試玩</dt>
            <dd>系統自動把遊戲的所有走法探索一遍，確認每個結局都玩得到、沒有卡死的狀態。</dd>
            <dt>版本</dt>
            <dd>每次儲存或 AI 操作都會產生新版本，可以在「版本紀錄」還原。</dd>
          </dl>
        </section>
        <section className="card">
          <h2>快捷鍵（編輯器）</h2>
          <table className="version-table">
            <tbody>
              <tr><td><kbd>Ctrl/⌘ + S</kbd></td><td>儲存到雲端</td></tr>
              <tr><td><kbd>Ctrl/⌘ + Z</kbd>／<kbd>Ctrl/⌘ + Shift + Z</kbd></td><td>復原／重做</td></tr>
              <tr><td><kbd>F9</kbd></td><td>開關資料庫</td></tr>
              <tr><td><kbd>F5</kbd></td><td>測試遊玩</td></tr>
              <tr><td><kbd>Esc</kbd></td><td>關閉資料庫</td></tr>
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2>讓 AI 幫你做</h2>
          <p>到「AI 協作」產生 API Token，交給 VS Code 裡的 Claude Code，輸入 <code>/rpg-new 你的故事</code>。AI 會依照開發規範：寫劇本大綱 → 一章一章製作 → 檢查與自動試玩 → 獨立 AI 審查 → 發布。你可以在 Studio 即時看到 AI 的進度，也可以隨時手動修改或還原。</p>
        </section>
      </div>
    </StudioShell>
  );
}
