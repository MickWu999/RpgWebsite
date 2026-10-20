# RPG 敘事設計準則

這份準則給 AI 生成端與 AI 審查端共用，適用於本專案的遊戲型態：小型 2D 俯視角敘事 RPG，10 分鐘內可以通關，有 2～5 位 NPC、對話樹、依序完成的任務目標、物品、旗標條件和 2～3 種結局，沒有戰鬥系統。

- **精簡版**：寫在 `src/ai/designGuide.ts`，會實際放進生成和審查的 prompt。
- **可以用程式判斷的規則**：由 `src/game/quality.ts` 和 `src/game/validate.ts` 強制檢查，不依賴 AI 判斷。
- **原則**：只採用設計原則與結構模式，不引用任何作品的劇情或台詞。

## 程式強制檢查的規則

| 準則 | 由程式檢查的內容 | 位置 |
|---|---|---|
| A3 死旗標 | 被設定但從未被讀取的旗標 | quality.ts（blocking） |
| A4 不卡關 | 自動試玩找出卡死狀態 | playtest.ts |
| C3 物品用途 | 取得後沒有任何用途的物品 | quality.ts（suggestion） |
| F1 結局條件 | 只由單一條件決定的結局 | quality.ts（blocking） |
| F3 結局可達 | 自動試玩找不到路線的結局 | playtest.ts |
| 物品一致性 | 被移除，卻沒有任何取得方式的物品 | validate.ts |

## 一、準則

### A. 故事結構與分支

| 編號 | 準則 | 來源 |
|---|---|---|
| A1 | 用「分支與瓶頸」當骨架。主線切成 2～4 個瓶頸，也就是任務目標。分支在下一個瓶頸前會合，會合點至少有一句台詞或描述依先前的分支而不同。 | S1、S9 |
| A2 | 禁止整局做成時間洞穴（time cave）。分支最多 2 層就要會合，只有結局段落可以完全分開。 | S1、S3、S4 |
| A3 | 後果記在旗標或數值上，不記在路徑上。每個主要選擇都設定一個有名稱的旗標；每個旗標設定之後至少被讀取 1 次。 | S9、S2、S3 |
| A4 | 蒐集型步驟不限順序；每個節點都走得到、不會卡關。 | S2 |

### B. 選擇設計

| 編號 | 準則 | 來源 |
|---|---|---|
| B1 | 選擇要有意圖。玩家做選擇前，看得出這個選擇的利害、方向與代價，不做盲選。 | S8、S5 |
| B2 | 至少一個真正的兩難：兩邊都是玩家在乎的東西，沒有明顯的正確答案，雙方立場的說明量相近。 | S5、S10、S8 |
| B3 | 選項之間在語氣、意圖或價值取向上不同，並回應 NPC 的上一句話；不要全部都是問句。 | S7、S6 |
| B4 | 全局 2～4 個主要選擇，放在戲劇高點；其他選擇屬於風味選擇，但也要換到一句專屬回應。 | S6、S7、S13 |
| B5 | 每個主要選擇都要在「後續的另一段對話」和「結局文字」中各被回應一次。 | S5、S6、S7、S9 |

### C. 任務設計

| 編號 | 準則 | 來源 |
|---|---|---|
| C1 | 一個任務只有一個終點，寫清楚交付者、他為什麼在乎，以及完成條件。 | S10 |
| C2 | 不做單純跑腿。每個任務至少有 1 個轉折或新資訊。 | S5、S11 |
| C3 | 每個物品都要有敘事脈絡，並在對話或條件中出現；不加入沒有意義的系統。 | S5、S10 |
| C4 | 相鄰的任務目標要換人或換地點；至少 1 個目標有 2 種解法，而且各有台詞。 | S11、S6、S10 |

### D. NPC 與對話

| 編號 | 準則 | 來源 |
|---|---|---|
| D1 | 每位 NPC 都有一句話說得出的「想要什麼」、固定的說話特徵，並牽涉任務或結局。 | S6、S10 |
| D2 | 對話要圍繞玩家的目標推進。 | S6 |
| D3 | 每個對話框 2～3 句；關鍵資訊不放在第一句；重大揭露之後給玩家一個回應選項。 | S7、S6 |
| D4 | 不重複資訊；每位主要 NPC 至少有 1 句台詞會依旗標改變。 | S5、S4、S7、S2 |
| D5 | 長對話要有一個可以直接推進主線的選項。 | S6 |

### E. 節奏

| 編號 | 準則 | 來源 |
|---|---|---|
| E1 | 遵守 10 分鐘預算：3～5 個段落，每段都推進一個目標或揭露一個新資訊。 | S7、S5 |
| E2 | 關鍵資訊用專屬的對話傳達；情感高點前後留一個短的停頓。 | S5 |
| E3 | 交給環境說的就不用台詞說：至少 2 個可以調查的人事物負責分擔背景說明。 | S5、S14 |

### F. 結局

| 編號 | 準則 | 來源 |
|---|---|---|
| F1 | 結局由至少 2 個旗標或狀態的組合決定，不能只看最後一個選擇。 | S4、S9 |
| F2 | 結局文字要點名回應至少 2 個玩家做過的決定；各結局在意義上不同，不是同一個結果的好壞版本。 | S5、S12、S13 |
| F3 | 結局要回答開場的主要問題，並交代每位主要 NPC 的去向；每個結局都要有明確可以達成的路徑。 | S12、S1 |

## 二、審查評分標準

共 6 個面向，每個面向 1～10 分，另外加評 fidelity（忠於原作的程度）。通過門檻：
- 總分 ≥ 7
- 每個面向都 ≥ 6
- 沒有 critical 問題
- major 問題最多 1 個

各面向的 3／6／9 分描述，寫在 `src/ai/designGuide.ts` 的 `REVIEW_RUBRIC`。

## 三、參考來源

以下來源都由研究 agent 實際打開確認過。

- [S1] Sam Kabo Ashwell, Standard Patterns in Choice-Based Games — https://heterogenoustasks.wordpress.com/2015/01/26/standard-patterns-in-choice-based-games/
- [S2] Emily Short, Beyond Branching: Quality-Based, Salience-Based, and Waypoint Narrative Structures — https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/
- [S3] Emily Short, Storylets: You Want Them — https://emshort.blog/2019/11/29/storylets-you-want-them/
- [S4] Emily Short, Small-Scale Structures in CYOA — https://emshort.blog/2016/11/05/small-scale-structures-in-cyoa/
- [S5] Game Developer, 10 key takeaways from the quest design of Cyberpunk 2077 and The Witcher 3 — https://www.gamedeveloper.com/marketing/10-key-takeaways-from-the-quest-design-of-cyberpunk-2077-and-the-witcher-3
- [S6] Alexander Freed, Branching Conversation Systems and the Working Writer, Part 4 — https://www.gamedeveloper.com/design/branching-conversation-systems-and-the-working-writer-part-4-key-principles
- [S7] Alexander Freed, Branching Conversation Systems and the Working Writer, Part 5 — https://www.gamedeveloper.com/design/branching-conversation-systems-and-the-working-writer-part-5-arts-and-craft
- [S8] Choice of Games, How to Write Intentional Choices — https://www.choiceofgames.com/2016/12/how-to-write-intentional-choices/
- [S9] Choice of Games, By the Numbers — https://www.choiceofgames.com/2011/07/by-the-numbers-how-to-write-a-long-interactive-novel-that-doesnt-suck/
- [S10] Game Developer, An Iterative Approach to Quest Design — https://www.gamedeveloper.com/design/an-iterative-approach-to-quest-design
- [S11] Game Developer, What are the defining qualities of a good side quest? — https://gamedeveloper.com/design/what-are-the-defining-qualities-of-a-good-side-quest-
- [S12] Weather Factory, Embed the ending in the middle — https://weatherfactory.biz/embed-the-ending-in-the-middle-or-crush-it-up-and-stir-it-into-the-rest-of-the-game/
- [S13] inkle, Just being there — https://www.inklestudios.com/2012/10/12/just-being-there.html
- [S14] GDC Vault, Environmental Narrative: Your World is Your Story（只確認到場次簡介） — https://gdcvault.com/play/1012712/Environmental-Narrative-Your-World-is
