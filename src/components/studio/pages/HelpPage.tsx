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
            <li>到「專案」按「＋ 新增專案」，選「從範本開始」（範本是一款 2 章的短篇，可以邊看邊學）。</li>
            <li>進入專案「總覽」，照著<b>製作進度清單</b>一步步做。每一步都有「前往」按鈕。</li>
            <li>在「地圖與事件」：上方切到 <b>🖌 地圖</b> 模式，選圖塊，在畫布上拖曳繪製。</li>
            <li>切到 <b>❗ 事件</b> 模式，選一格，用右側的<b>快速事件建立</b>放人物、門、寶箱、調查點；雙擊事件打開「事件編輯」，在<b>執行內容</b>加入文字、選項、條件分支。</li>
            <li>按 <b>📚 資料庫</b>（或 F9）設定角色、物品、任務、結局、章節。</li>
            <li>按 <b>▶ 測試遊玩</b>（或 F5）。可以從頭、從某一章、或從選取的位置開始；測試時按 F9 改開關與變數，編輯器的修改會即時套用。</li>
            <li>到「發布」執行檢查，全部通過後按「發布」。</li>
          </ol>
        </section>
        <section className="card">
          <h2>名詞解釋（與 RPG Maker 相同）</h2>
          <dl className="glossary">
            <dt>事件</dt>
            <dd>地圖上的一切互動都是事件：人物、門、寶箱、告示、場所移動、劇情觸發。</dd>
            <dt>事件頁</dt>
            <dd>同一個事件可以有多頁。系統使用「出現條件成立、編號最大」的那一頁。例如第 1 頁「門鎖著」，第 2 頁（條件：持有鑰匙）「門打開了」。</dd>
            <dt>觸發方式</dt>
            <dd>確定鍵：玩家面對它按確定；接觸：玩家走上去或撞到；自動執行：頁面成立就自動播放（過場），最後要打開獨立開關讓它停下。</dd>
            <dt>開關／變數／獨立開關</dt>
            <dd>開關記錄 ON／OFF（劇情進度、玩家的選擇）；變數記錄數字（好感度、次數）；獨立開關只屬於單一事件（例如寶箱已打開）。打開了卻從沒被讀取的開關，會被品質檢查指出（代表那個選擇沒有後果）。</dd>
            <dt>執行內容（事件指令）</dt>
            <dd>事件被觸發時依序執行的指令：顯示文字、顯示選項、條件分支、開關操作、增減物品、任務、場所移動、章節、結局…</dd>
            <dt>共用事件</dt>
            <dd>可以重複使用的指令組合，在事件中用「共用事件」指令呼叫。</dd>
            <dt>章節</dt>
            <dd>長篇遊戲的段落。「章節」指令會顯示標題卡；每章可以設定測試起點，直接從那一章開始測試。</dd>
            <dt>結局與尾聲</dt>
            <dd>用「結局」指令觸發；「尾聲」會依玩家其他選擇追加描述，不必增加結局數量就能回應更多選擇。</dd>
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
              <tr><td>指令清單：<kbd>Enter</kbd>／<kbd>Delete</kbd>／<kbd>Ctrl/⌘ + C、V</kbd></td><td>編輯、刪除、複製貼上指令</td></tr>
              <tr><td>測試遊玩：<kbd>F9</kbd>／<kbd>F</kbd></td><td>除錯面板（開關、變數、章節跳轉）／全螢幕</td></tr>
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
