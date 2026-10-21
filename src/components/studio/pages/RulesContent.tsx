"use client";

import { DESIGN_GUIDE, REVIEW_RUBRIC, TREATMENT_RUBRIC } from "@/ai/designGuide";
import { REVIEW_PASS_RULE } from "@/ai/review";
import { QUALITY_THRESHOLDS as Q } from "@/game/quality";

/** 審查規則：AI 製作與審查依據的準則、評分標準與門檻（與程式實際使用的同一份） */
export default function RulesContent() {
  return (
    <div className="stack">
      <section className="card stack">
        <h2>三層審查（不通過就不能往下走）</h2>
        <table className="version-table">
          <tbody>
            <tr>
              <td className="small">1. 劇本大綱審查</td>
              <td className="small">動工前。沒通過，AI 不能送出任何製作操作。</td>
            </tr>
            <tr>
              <td className="small">2. 章節審查</td>
              <td className="small">每章做完、該章從起點自動試玩通過之後。沒通過，不能開始下一章。</td>
            </tr>
            <tr>
              <td className="small">3. 整體審查</td>
              <td className="small">全部完成時。連載中的遊戲只要每章通過就可以推出，完結時才做整體審查。</td>
            </tr>
          </tbody>
        </table>
        <div className="small">
          <b>通過門檻</b>：總分 ≥ {REVIEW_PASS_RULE.minOverall}、每個面向 ≥ {REVIEW_PASS_RULE.minEachScore}、沒有 critical、major 最多 {REVIEW_PASS_RULE.maxMajorIssues} 個。
        </div>
        <div className="small muted">
          審查會收斂：重審時審查員會拿到上一輪的意見，先逐條判定是否已解決；新問題只有在屬於 critical 或會讓某個面向低於 6 分時才能提出。審查員也會參考 AI 案例庫（玩家回饋與過去最常退件的問題）。
        </div>
      </section>
      <section className="card stack">
        <h2>程式強制的品質門檻</h2>
        <table className="version-table">
          <tbody>
            <tr>
              <td className="small">全長（完結時）</td>
              <td className="small">
                {Q.targetMinutes[0]}～{Q.targetMinutes[1]} 分鐘；{Q.minChapters}～{Q.maxChapters} 章（建議 {Q.recommendedChapters[0]}～{Q.recommendedChapters[1]} 章）
              </td>
            </tr>
            <tr>
              <td className="small">每一章</td>
              <td className="small">
                {Q.chapterMinutes[0]}～{Q.chapterMinutes[1]} 分鐘（建議 10～25 分鐘），從章節起點能玩到下一章、沒有卡死
              </td>
            </tr>
            <tr>
              <td className="small">連載中</td>
              <td className="small">至少推出 1 章；全長、章節數與結局數完結時才檢查；「未完待續」結局可以讓玩家在新章推出後接著玩</td>
            </tr>
            <tr>
              <td className="small">規模</td>
              <td className="small">
                NPC {Q.minPeople}～{Q.maxPeople} 位、結局 {Q.minEndings}～{Q.maxEndings} 種、可調查的事件 ≥ {Q.minInteractables}、有後果的選項 ≥ {Q.minMeaningfulChoices}
              </td>
            </tr>
            <tr>
              <td className="small">敘事</td>
              <td className="small">沒有死開關；結局由 2 個以上的條件或選擇決定；不同結局的路線要有不同的選擇；不得有佔位文字</td>
            </tr>
          </tbody>
        </table>
      </section>
      <details className="card" open>
        <summary>
          <b>敘事設計準則（A～H 與 AI 常見盲點 X）</b>
        </summary>
        <div className="doc-text small">{DESIGN_GUIDE}</div>
      </details>
      <details className="card">
        <summary>
          <b>章節與整體審查的評分標準</b>
        </summary>
        <div className="doc-text small">{REVIEW_RUBRIC}</div>
      </details>
      <details className="card">
        <summary>
          <b>劇本大綱審查的評分標準</b>
        </summary>
        <div className="doc-text small">{TREATMENT_RUBRIC}</div>
      </details>
    </div>
  );
}
