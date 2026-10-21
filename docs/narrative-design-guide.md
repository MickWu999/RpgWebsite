# RPG 敘事設計準則

這份準則給 AI 製作端與 AI 審查端共用。適用的遊戲型態是**分章節、以 RPG Maker 事件模型製作的 2D 敘事 RPG**（長度由故事決定，不設下限）：沒有戰鬥，玩法是探索、對話、調查、輕度謎題、抉擇與多重結局。

- **精簡版**：寫在 `src/ai/designGuide.ts`，會放進大綱審查、章節審查與整體審查的 prompt；AI 製作前也要讀過一遍。
- **可以用程式判斷的規則**：由 `src/game/quality.ts`、`src/game/validate.ts`、`src/game/chapters.ts` 強制檢查，不靠 AI 判斷。
- **原則**：採用業界前輩公開的設計方法與結構模式，不引用任何作品的劇情或台詞。H 段每一條都標出依據的來源（R1～R20）。為什麼要這樣做：AI 只憑自己的直覺設計故事，很容易有盲點（見 X 段）。

## 程式強制檢查的規則

| 準則 | 由程式檢查的內容 | 位置 |
|---|---|---|
| A3 死開關 | 被打開卻從未被讀取的開關 | quality.ts（blocking） |
| A4 不卡關 | 自動試玩找出卡死狀態（整體與每一章） | playtest.ts、chapters.ts |
| E1 長度 | 不設下限；1～8 章；全長超過 120 分鐘、單章超過 30 分鐘只會提醒 | quality.ts |
| F1 結局條件 | 只由不到 2 個條件或選擇決定的結局 | quality.ts（blocking） |
| F3 結局可達 | 自動試玩找不到路線的結局 | playtest.ts |
| H4 章節收束 | 每章從測試起點能不能玩到下一章 | chapters.ts |
| 物品一致性 | 會被交出，卻沒有任何取得方式的物品 | validate.ts |
| 自動執行 | 不會關閉自己的自動執行頁、無限跳轉 | validate.ts、engine.ts |

## 三層審查（由程式把關，不能跳過）

1. **劇本大綱審查**（`review-treatment`）：用 `TREATMENT_RUBRIC` 評分。沒通過就不能送出任何製作操作。
2. **章節審查**（`review --chapter`）：每章做完，從章節起點自動試玩通過後，用 `REVIEW_RUBRIC` 只審這一章。沒通過就不能新增下一章。
3. **整體審查**（`review`）：全部章節完成、`check` 全部通過後審查整款遊戲。通過之後內容又改過，要重新審查才能發布。

通過門檻：總分 ≥ 6.5；核心面向 ≥ 6（大綱看 premise，章節與整體看 soul，使用者提供故事時再加 fidelity）；其他面向 ≥ 5（只是安全網）；沒有 critical；major 最多 3 個；玩家評審團（老玩家、休閒玩家、劇情派，另開一次呼叫，只看故事不看規則）至少 2 人想繼續玩。大綱審查前會先做盲猜測試，只當參考。

critical 只能用在不能玩、邏輯矛盾、違反改編合約或使用者原作的核心；單純違反準則不是 critical。規則分三層：硬規則由程式檢查；標〔全作〕的看整部作品；標〔參考〕的只是建議。類型（喜劇、溫馨、懸疑、悲劇、劇情）有各自的期待值，寫在 `GENRE_EXPECTATIONS`。每次審查都會列出「這部最好的地方（不准動）」與「最重要的 3 個修改」，第二輪起只能補充新的 critical。

## 設計防呆（程式靜態檢查，不需要 AI）

`src/game/lint.ts` 在每次 `apply` 之後與 `check` 時執行，幾毫秒就跑完。錯誤會擋下發布。

| 規則 | 抓什麼 |
|---|---|
| L1 被蓋掉的事件頁 | 後面的頁條件比較寬（或沒有條件），前面的頁永遠不會被使用 |
| L2 永遠不成立的條件 | 需要的開關從沒被打開、物品拿不到、變數到不了、任務不會進入該狀態、獨立開關沒被打開 |
| L3 走不到的事件 | 從地圖的任何入口都走不到（或走不到旁邊）的事件；會推進劇情的算錯誤 |
| L4 困住玩家的區域 | 從入口進來後，走得到的範圍內沒有傳送、章節或結局可以離開 |
| L5 沒有反應 | 確定鍵事件頁沒有指令、選項選了沒有回應、任務開始後沒有終點（警告） |

## 一、準則

**P 是主角**：P 段（故事的靈魂）來自劇情驅動 RPG 設計者本人的訪談（來源 W1～W11），審查時最重要的面向是 premise、surprise、soul。A～G 沿用基礎敘事設計原則（來源 S1～S14），H 是長篇與章節的前輩方法（來源 R1～R20），X 是 AI 常見盲點；這些是輔助與安全網，規則和「好玩」衝突時以 P 為準。

### P. 故事的靈魂（前輩作品怎麼想出前提）

| 作品 | 核心前提 | 為什麼新鮮 | 設計者怎麼說 |
|---|---|---|---|
| LISA（Austin Jorgensen） | 末日後世界沒有女人，一個中年男人保護撿到的女嬰 | 一條世界規則讓每個角色都有理由搶她，衝突自己產生 | 「好故事的關鍵是高賭注」「犧牲是為了讓玩家真的感覺到什麼」〔W1〕；「像是我的數位日記」〔W2〕 |
| Undertale（Toby Fox） | 一款不必殺任何人也能通關的 RPG | 把「打怪升級」反過來 | 官方：「殺戮不是必要的」「重視幽默、角色豐富」〔W3〕；腦袋像調酒器，把喜歡的遊戲混在一起；主題交給玩家詮釋〔W4〕 |
| OMORI（OMOCAT） | 繭居少年躲進繽紛夢境，逃避一件不敢面對的往事 | 可愛包著創傷，夢境的規則就是主角在逃避什麼 | 角色都取材自自己和身邊的人；恐怖採用「可能真的會發生」的點子〔W5〕 |
| To the Moon（Kan Gao） | 醫生進入臨終老人的記憶，倒著走回童年實現他的願望 | 記憶就是關卡，謎底是「他為什麼想去月球」 | 把真實的不幸變成有意義的東西；曾想加戰鬥，最後決定不硬塞玩法〔W6〕 |
| MOTHER（糸井重里） | 現代郊區的普通男孩對抗外星人 | 把冒險搬到日常 | 重點是和現代生活、現代場所的連結〔W7〕 |
| Disco Elysium（Robert Kurvitz） | 宿醉失憶的警探，腦中的技能是一個個會說話的人格 | 技能變成角色，失敗本身就是內容 | 「搞砸讓遊戲更好玩」「永遠不阻止玩家進入遊戲的某一部分」〔W8〕；每一場戲都寫到全力〔W9〕 |
| Pentiment（Josh Sawyer） | 修道院謀殺案，你必須指控一個人，但永遠不知道對不對 | 抉擇的代價是不確定 | 「沒有官方的真兇」「你只能接受不確定」〔W10〕 |
| Doki Doki Literature Club（Dan Salvato） | 表面是戀愛遊戲，其實是心理恐怖 | 先把類型外殼做得很真，再從內部崩壞 | 受影響的是作品給人的感受，而不是內容〔W11〕 |

跨作品的共同方法已整理成 `designGuide.ts` 的 P1～P12；AI 最容易寫出的老套與反過來的用法整理成 `CLICHES`（N1～N15，本平台歸納）。OFF、Yume Nikki 沒有找到設計者本人談前提的訪談，所以沒有納入。

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

### E. 節奏

| 編號 | 準則 | 來源 |
|---|---|---|
| E1 | 長度由故事決定，不設下限，不為了湊時間灌水；太長時考慮分部或拆章。 | S7、S5、R17 |
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
| X9 | 角色降智：聰明的角色為了推動劇情突然做蠢事。 | 本平台歸納 |
| X10 | 規模膨脹：每章都比上一章誇張，賭注升高被誤解成規模變大。 | 本平台歸納 |
| X11 | 秘密永遠不揭曉：每章都只丟新謎團。每章至少回答一個先前的問題。 | 本平台歸納 |
| X12 | 拒絕被強迫繞回：選「不要」卻被劇情硬拉回去。 | 本平台歸納 |
| X13 | 悲劇連發：每次努力都被否定。 | 本平台歸納 |
| X14 | 角色知道不該知道的事：台詞超出角色的知識範圍。 | 本平台歸納 |

X9～X14 參考了 `knowledge/references/gpt-rpg-studio-建議.md` 的整理（沒有附設計者出處，所以標成本平台歸納）。

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

### 故事的靈魂（W）

研究 agent 實際開啟確認過原文。原頁無法開啟、只看過摘要的來源（RPGamer、GameSpot、Mary Sue 等）沒有列入。

- [W1] Siliconera, Finding Humour In LISA's World Of Violent Masculinity And Perverts（Austin Jorgensen 訪談） — https://www.siliconera.com/finding-humour-lisas-world-violent-masculinity-perverts/
- [W2] Phudgin Interactive, An Interview with Austin Jorgensen — https://phudginteractive.wordpress.com/2015/01/26/an-interview-with-austin-jorgensen/
- [W3] Undertale 官方 Steam 頁面 — https://store.steampowered.com/app/391540/Undertale/
- [W4] AUTOMATON, Toby Fox 訪談（日文） — https://automaton-media.com/articles/interviewsjp/undertale-developer-toby-fox-interview/
- [W5] マイナビニュース, OMOCAT 訪談（日文） — https://news.mynavi.jp/article/20230612-2702569/
- [W6] RPGFan, Kan Gao Interview — https://www.classic.rpgfan.com/features/kanrgaointerview/
- [W7] Tuxedo Unmasked, Interview with Shigesato Itoi — https://www.tuxedounmasked.com/interview-with-shigesato-itoi-of-mother-and-hobonichi-11212015/
- [W8] ZA/UM, Choose Your Own Misadventure Part 2（Disco Elysium 官方 devblog） — https://discoelysium.com/devblog/2019/07/23/choose-your-own-misadventure-part-2
- [W9] GameAnalytics, Disco Elysium Rezzed 2018 Interview — https://www.gameanalytics.com/blog/disco-elysium-rezzed-2018-interview
- [W10] TheGamer, Josh Sawyer Pentiment Interview — https://www.thegamer.com/interview-obsidian-josh-sawyer-pentiment/
- [W11] Siliconera, Doki Doki Literature Club Creator Listed Yume Nikki As An Inspiration — https://www.siliconera.com/doki-doki-literature-club-creator-listed-yume-nikki-as-an-inspiration-monika-ssbu/

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
