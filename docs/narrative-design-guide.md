# RPG 敘事設計準則

這份準則給 AI 製作端與 AI 審查端共用。適用的遊戲型態是 **1～2 小時、分 4～6 章、以 RPG Maker 事件模型製作的 2D 敘事 RPG**：沒有戰鬥，玩法是探索、對話、調查、輕度謎題、抉擇與多重結局。

- **精簡版**：寫在 `src/ai/designGuide.ts`，會放進大綱審查、章節審查與整體審查的 prompt；AI 製作前也要讀過一遍。
- **可以用程式判斷的規則**：由 `src/game/quality.ts`、`src/game/validate.ts`、`src/game/chapters.ts` 強制檢查，不靠 AI 判斷。
- **原則**：採用業界前輩公開的設計方法與結構模式，不引用任何作品的劇情或台詞。H 段每一條都標出依據的來源（R1～R20）。為什麼要這樣做：AI 只憑自己的直覺設計故事，很容易有盲點（見 X 段）。

## 程式強制檢查的規則

| 準則 | 由程式檢查的內容 | 位置 |
|---|---|---|
| A3 死開關 | 被打開卻從未被讀取的開關 | quality.ts（blocking） |
| A4 不卡關 | 自動試玩找出卡死狀態（整體與每一章） | playtest.ts、chapters.ts |
| E1 時長 | 全長 60～120 分鐘；3～8 章（建議 4～6 章）；每章 8～30 分鐘（建議 10～25 分鐘） | quality.ts |
| F1 結局條件 | 只由不到 2 個條件或選擇決定的結局 | quality.ts（blocking） |
| F3 結局可達 | 自動試玩找不到路線的結局 | playtest.ts |
| H4 章節收束 | 每章從測試起點能不能玩到下一章 | chapters.ts |
| 物品一致性 | 會被交出，卻沒有任何取得方式的物品 | validate.ts |
| 自動執行 | 不會關閉自己的自動執行頁、無限跳轉 | validate.ts、engine.ts |

## 三層審查（由程式把關，不能跳過）

1. **劇本大綱審查**（`review-treatment`）：用 `TREATMENT_RUBRIC` 評分。沒通過就不能送出任何製作操作。
2. **章節審查**（`review --chapter`）：每章做完，從章節起點自動試玩通過後，用 `REVIEW_RUBRIC` 只審這一章。沒通過就不能新增下一章。
3. **整體審查**（`review`）：全部章節完成、`check` 全部通過後審查整款遊戲。通過之後內容又改過，要重新審查才能發布。

通過門檻：總分 ≥ 7、每個面向 ≥ 6、沒有 critical、major 最多 1 個。

## 一、準則

A～G 沿用基礎敘事設計原則（來源 S1～S14），H 是長篇與章節的前輩方法（來源 R1～R20），X 是 AI 常見盲點。

### A. 結構與分支

| 編號 | 準則 | 來源 |
|---|---|---|
| A1 | 用「分支與瓶頸」當骨架：章內的分支在章末的瓶頸會合，會合點至少有一句台詞依先前分支不同。 | S1、S9 |
| A2 | 禁止整局時間洞穴：分支最多 2 層就要會合，只有最終章的結局段落可以完全分開。 | S1、S3、S4 |
| A3 | 後果記在開關或變數上；每個打開的開關都至少被讀取 1 次。 | S9、S2、S3 |
| A4 | 蒐集型步驟不限順序；每個狀態都走得到下一步。 | S2 |

### B. 選擇設計

| 編號 | 準則 | 來源 |
|---|---|---|
| B1 | 選擇要有意圖：玩家選之前看得出利害、方向與代價。 | S8、S5 |
| B2 | 每章至少一個真正的兩難。 | S5、S10、S8 |
| B3 | 選項在語氣、意圖或價值上不同，並回應上一句話。 | S7、S6 |
| B4 | 主要選擇全局 4～8 個（每章 1～2 個），放在戲劇高點。 | S6、S7、S13 |
| B5 | 每個主要選擇都在後續章節與結局（或尾聲）各被回應一次。 | S5、S6、S7、S9 |

### C. 任務設計

| 編號 | 準則 | 來源 |
|---|---|---|
| C1 | 每個任務一個終點；任務日誌的步驟寫出「找誰／去哪／做什麼」。 | S10 |
| C2 | 不做單純跑腿：每個任務至少 1 個轉折或新資訊。 | S5、S11 |
| C3 | 每個物品都有敘事脈絡並被用到。 | S5、S10 |
| C4 | 相鄰步驟換人或換地點；每章至少 1 個步驟有 2 種解法。 | S11、S6、S10 |

### D. 人物與對話

| 編號 | 準則 | 來源 |
|---|---|---|
| D1 | 每位角色有「想要什麼」與「秘密」、固定的說話特徵，寫在角色設定。 | S6、S10 |
| D2 | 對話圍繞玩家的目標推進。 | S6 |
| D3 | 每則文字 2～3 句；關鍵資訊不放第一句；重大揭露後給回應選項。 | S7、S6 |
| D4 | 不重複資訊；主要人物用多個事件頁依劇情進度說不同的話。 | S5、S4、S7、S2 |
| D5 | 長對話要有一個直接推進主線的選項。 | S6 |

### E. 節奏（1～2 小時）

| 編號 | 準則 | 來源 |
|---|---|---|
| E1 | 全長 60～120 分鐘，分 4～6 章，每章 10～25 分鐘；時長來自內容。 | S7、S5、R17 |
| E2 | 關鍵資訊用專屬事件傳達；情感高點前後留短的停頓。 | S5 |
| E3 | 每章至少 3 個可調查的事件分擔背景與伏筆。 | S5、S14、R5 |

### F. 結局

| 編號 | 準則 | 來源 |
|---|---|---|
| F1 | 結局由至少 2 個開關或狀態的組合決定。 | S4、S9 |
| F2 | 結局點名回應至少 2 個玩家的決定；各結局意義不同。 | S5、S12、S13 |
| F3 | 結局回答開場的主要問題，並交代每位主要角色的去向。 | S12、S1 |

### G. 互動回饋

| 編號 | 準則 | 來源 |
|---|---|---|
| G1 | 主要路線旁要有可調查的事件。 | S5、S14 |
| G2 | 被鎖住的事要有回饋並提示解法，取得條件後用下一個事件頁換回應。 | R1、R16 |
| G3 | 玩家隨時知道下一步（任務日誌、人物的提示頁）。 | S10、R1 |
| G4 | 同一個事件在不同狀態下回應不同、有個性。 | S5 |

### H. 長篇與章節（前輩方法）

| 編號 | 準則 | 來源 |
|---|---|---|
| H1 | 開場幾分鐘內，由角色說出最終目標與第一個小目標。 | R1、R12 |
| H2 | 主線從小目標開始，一章一章擴大範圍與賭注；不要每章重複同一種衝突。 | R13、R17 |
| H3 | 每章依「起：介紹 → 承：加深 → 轉：意外變化 → 合：讓玩家運用」安排。 | R3 |
| H4 | 每章結尾有收束點（線索會合），之後接懸念或揭露，帶進下一章。 | R2、R17 |
| H5 | 驚喜與反轉來自外部世界，不讓主角違背玩家的意志。 | R18 |
| H6 | 中段至少一次「原以為的真相被推翻」，而且能回頭找到伏筆。 | R18、R17、R6（中段翻轉的位置是由這幾篇推得的） |
| H7 | 每章同時開放 2～3 條互不依賴的調查線，再收斂到同一個關卡。 | R1、R2 |
| H8 | 每個謎題或步驟都推進劇情或揭露新資訊；不准湊時間。 | R1、R6、R14 |
| H9 | 跑腿式任務至少一次「預期被改變」，或做成門與鑰匙的連鎖。 | R15、R14 |
| H10 | 先讓玩家看到問題，再給解法；需要的物品不能永久錯過。 | R1、R15 |
| H11 | 支線是完整的小故事，用不同語氣映照主題，並影響尾聲。 | R14 |
| H12 | 關鍵資訊藏在場景裡讓玩家拼湊，不靠人物長篇說明。 | R6、R5、R4、R19 |
| H13 | 讓玩家注意到的擺設與伏筆，後面一定要回收。 | R5、R6 |
| H14 | 抉擇前講清楚代價；選完給立即回應，之後回收延遲的後果。 | R6、R7、R9 |
| H15 | 抉擇是沒有標準答案的兩難；不做假抉擇，也不做「選錯就卡關」。 | R6、R9 |
| H16 | 核心人物少而深，對玩家的選擇有反應，背景分章揭露；村民也有自己的小故事。 | R11、R12 |
| H17 | 提示分層：輕推 → 重述線索 → 直接說答案，每則提示寫出具體的物件與地點。 | R16、R15、R1 |
| H18 | 結局回收累積的關係與選擇，導向意義不同的結局，並用尾聲點名回應。 | R8、R7 |

### X. 常見盲點（AI 最容易犯）

| 編號 | 盲點 | 來源 |
|---|---|---|
| X1 | 用說明代替參與：人物長篇講背景。 | R19、R5、R6 |
| X2 | 重複：多個人物講同一件事，或每章同一種衝突。 | R6、R17 |
| X3 | 填充：為了拉長時間加跑腿或無意義的謎題。 | R1、R14、R6 |
| X4 | 細節過度：堆砌不會回收的設定。 | R6、R5 |
| X5 | 抉擇無效：分支馬上合流、沒有開關記住。 | R7、R9、R10 |
| X6 | 倒序謎題或猜謎題。 | R1 |
| X7 | 只有一種語氣，缺少幽默與反差。 | R12、R14 |
| X8 | 為了驚喜讓主角突然背叛玩家。 | R18 |

## 二、審查評分標準

- **整體與章節審查**：10 個面向，包括 structure、choices、quests、characters、pacing、endings、feedback、arc、fun，另外加上 fidelity（是否忠於原作）。
- **劇本大綱審查**：7 個面向，包括 hook、arc、characters、choices、variety、endings、budget。

各面向的 3／6／9 分描述，寫在 `src/ai/designGuide.ts` 的 `REVIEW_RUBRIC` 與 `TREATMENT_RUBRIC`。

## 三、參考來源

以下來源都由研究 agent 實際開啟確認過；括號內標示只確認到摘要或二手整理的項目。

### 基礎敘事設計（S）

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

### 長篇與章節的前輩方法（R）

- [R1] Ron Gilbert, Why Adventure Games Suck — https://grumpygamer.com/why_adventure_games_suck/
- [R2] Ron Gilbert, Puzzle Dependency Charts — https://grumpygamer.com/puzzle_dependency_charts/
- [R3] Christian Nutt, The Secret to Mario Level Design（訪談林田宏一，起承轉合） — https://www.gamedeveloper.com/design/the-secret-to-i-mario-i-level-design
- [R4] Harvey Smith、Matthias Worch, What Happened Here? Environmental Storytelling, GDC 2010（只確認到摘要） — https://gdcvault.com/play/1012647
- [R5] Nieman Storyboard, Harvey Smith on environmental storytelling — https://niemanstoryboard.org/2011/01/14/harvey-smith-on-environmental-storytelling-and-embedding-narrative/
- [R6] Holly Green, 10 key takeaways from the quest design of Cyberpunk 2077 and The Witcher 3（Paweł Sasko GDC 2023） — https://www.gamedeveloper.com/marketing/10-key-takeaways-from-the-quest-design-of-cyberpunk-2077-and-the-witcher-3
- [R7] Sam Kabo Ashwell, Standard Patterns in Choice-Based Games（branch and bottleneck） — https://heterogenoustasks.wordpress.com/2015/01/26/standard-patterns-in-choice-based-games/
- [R8] Emily Short, Small-Scale Structures in CYOA — https://emshort.blog/2016/11/05/small-scale-structures-in-cyoa/
- [R9] Emily Short, Choice Poetics (Peter Mawhorter) — https://emshort.blog/2019/04/09/choice-poetics-peter-mawhorter/
- [R10] Peter Gross, Should Games Have Meaningful Choices?（整理 inkle Jon Ingold 的演講） — https://www.gamedeveloper.com/design/should-games-have-meaningful-choices-
- [R11] Chris Avellone, Project Eternity and Characterization（GameBanshee 轉載） — https://www.gamebanshee.com/kahp
- [R12] 25 Years of Dragon Quest: An Interview with Yuji Horii — https://www.gamedeveloper.com/business/25-years-of-i-dragon-quest-i-an-interview-with-yuji-horii
- [R13] Game World Observer, Tim Cain on design documents（Tim Cain 影片的二手整理） — https://gameworldobserver.com/2023/06/07/design-documents-setting-story-systems-tim-cain
- [R14] David Milner, Side Quest Syndrome（Game Informer） — https://www.gameinformer.com/b/features/archive/2017/02/09/side-quest-syndrome-designing-the-road-less-travelled
- [R15] JB Oger, Quest Design Lessons from Monkey Island — https://jboger.substack.com/p/monkeyisland
- [R16] Meghann O'Neill, How and why to write low-spoiler hints for adventure games — https://www.gamedeveloper.com/design/how-and-why-to-write-low-spoiler-hints-for-adventure-games-
- [R17] Pascal Luban, The Design of Episodic Games (Part I) — https://www.gamedeveloper.com/design/the-design-of-episodic-games-part-i-
- [R18] Iwata Asks: Xenoblade Vol. 2 Story（高橋哲哉、竹田裕一郎） — https://iwataasks.nintendo.com/interviews/wii/xenoblade/1/2
- [R19] Katarina Gyllenback, Part 1, Don't show, involve — https://www.gamedeveloper.com/design/part-1-don-t-show-involve
- [R20] Jesse Schell, Lessons from Game Design（只確認到投影片文字） — https://www.slideshare.net/slideshow/lessons-from-game-design/53490943
