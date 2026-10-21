# 劇情驅動 RPG 的設計者怎麼想出前提

- 研究日期：2026-10-21
- 研究問題：故事性強、令人難忘的 RPG，設計者是怎麼想出核心前提與故事的？哪些方法能轉成 AI 的規則？
- 用途：整理成 `src/ai/designGuide.ts` 的 P 段（W1～W11）與老套清單 `CLICHES`
- 可信度：「已讀」＝直接讀過原頁；「摘要」＝原頁回傳 403，只看過搜尋摘要；「未查證」＝沒有找到設計者本人的出處

## 一、各作品

### LISA（Austin Jorgensen／Dingaling）
- 前提：世界末日後女人全部消失，一個中年男人在全是男人的暴力荒原上，保護他撿到的女嬰 Buddy。
- 為什麼新鮮：「世上沒有女人」這條規則讓每個角色都有理由去搶 Buddy，衝突是世界自己產生的。
- 設計者原話：
  - "The key to good story telling… is to have HIGH stakes."（已讀）
  - "The sacrifice element is my way of trying my best to really get the player to FEEL something."（已讀）
  - "my satirical take on masculinity"（已讀）
  - 出處：https://www.siliconera.com/finding-humour-lisas-world-violent-masculinity-perverts/
  - "kind of like my diary in digital form"（已讀）：https://phudginteractive.wordpress.com/2015/01/26/an-interview-with-austin-jorgensen/
  - 主要靈感是職業摔角和 EarthBound（摘要）：https://archive.rpgamer.com/games/indie/lisa/lisaint.html
- 未查證：失去手臂、犧牲隊友等取捨的設計理由；父親虐待是否來自他的個人經歷。
- 可轉成的規則：讓玩家用真正在乎的東西換取進度；喜劇多用暗示，不直接說破；前提要讓動機自然產生。

### Undertale（Toby Fox）
- 前提：一款不必殺任何人也能通關的 RPG。戰鬥指令裡多了 MERCY（饒恕），怪物都有個性、可以交朋友。
- 為什麼新鮮：把「打怪升級」這個 RPG 預設反過來。
- 設計者原話：
  - 官方："Killing is unnecessary"、"character-rich story with an emphasis on humor"（已讀）：https://store.steampowered.com/app/391540/Undertale/
  - 日文訪談（已讀）：先從文字系統、戰鬥系統做起；MERCY 的靈感來自《真・女神轉生》；他說自己的腦袋像「カクテルのシェイカー」，把喜歡的遊戲混在一起；主題「プレイヤーの解釈次第」。出處：https://automaton-media.com/articles/interviewsjp/undertale-developer-toby-fox-interview/
  - 故事在戰鬥系統之後才有；不殺路線很少見，是因為傷害在遊戲裡被正常化了（摘要）：https://themarysue.com/?p=342934
- 可轉成的規則：先挑一個 RPG 慣例，再設計它的反面；每個「敵人」都有一個可以被理解的小怪癖；主題不直接講出來。

### OMORI（OMOCAT）
- 前提：繭居少年躲在繽紛的夢境「Headspace」，逃避現實中一件不敢面對的往事。
- 為什麼新鮮：可愛的畫風包著創傷，夢境的世界規則就是「主角在逃避什麼」。
- 設計者原話（已讀）：「すべてのキャラクターは私自身や、私の人生に関わる人々から」取材；「現実の体験、経験などから着想を得て」；恐怖橋段最後採用讓人覺得「ありえそう」的點子。出處：https://news.mynavi.jp/article/20230612-2702569/
- 夢境、惡夢、美國郊區鄉愁等來源是記者的轉述，不是本人原話。
- 可轉成的規則：前提來自具體的個人情緒；幻想空間要有心理功能（例如逃避）；恐怖寫「現實中可能發生」的事。

### To the Moon（Kan Gao／高瞰）
- 前提：兩名醫生進入臨終老人的記憶，從晚年回溯到童年，幫他實現「去月球」的願望。
- 為什麼新鮮：記憶就是關卡；往回走時，謎底是「他為什麼想去月球」。
- 設計者原話（已讀）："turn some real life misfortunes into something meaningful"；"I wondered that when I'm on my deathbed one day, if there would be anything I'd regret."；曾想加戰鬥系統，被測試者勸退，說法是 "refraining to not add token gameplay elements"。出處：https://www.classic.rpgfan.com/features/kanrgaointerview/
- 祖父住院開心臟手術是發想起點（摘要）：https://www.gamespot.com/articles/to-the-moon-postmortem-qanda-with-kan-gao/1100-6347050/
- 未查證：為什麼採用倒敘結構。
- 可轉成的規則：不為了「像遊戲」硬塞玩法；核心問題問一個人一生的遺憾；用倒敘讓答案出現在最後。

### MOTHER／EarthBound（糸井重里）
- 前提：現代美國郊區的「普通男孩」對抗外星人。
- 為什麼新鮮：1989 年主流是奇幻，它把冒險搬到日常。
- 設計者原話（已讀）："It's the connection with modern day life and modern day places"；拿勇者鬥惡龍對比：玩到一半被叫去吃晚餐會被拉出遊戲，MOTHER 不會；主角是 "just an average boy"（英文翻譯為意譯）。出處：https://www.tuxedounmasked.com/interview-with-shigesato-itoi-of-mother-and-hobonichi-11212015/
- 發想問題是「史匹柏會做什麼樣的 RPG？」（二手報導）：https://destructoid.com/shigesato-itoi-interview-comic-explores-the-origins-of-mother
- Giygas 的台詞來自他小時候誤看的電影（未查證）：https://en.wikipedia.org/wiki/Giygas
- 可轉成的規則：舞台放在熟悉的日常；怪誕從平凡裡長出來。

### OFF／Yume Nikki
- 都沒有找到可用的設計者訪談，不提供分析。Kikiyama 唯一的訪談是 Toby Fox 主持、只問是非題的那篇：https://www.dualshockers.com/undertale-creator-toby-fox-interviews-kikiyama/

### Disco Elysium（Robert Kurvitz／ZA/UM）
- 前提：宿醉失憶的警探，腦中的技能會用不同人格跟他說話。
- 為什麼新鮮：把技能檢定變成角色，失敗本身就是內容。
- 設計者原話（已讀）："You never prevent them from accessing a part of the game."；"Getting it wrong makes the game more fun."；"people feel closer to their character when he gets something wrong"；不要 "structures that encourage aggression"。出處：https://discoelysium.com/devblog/2019/07/23/choose-your-own-misadventure-part-2
- 補充（已讀）："we write every scene as hard as we can"、"It's always your choice"：https://www.gameanalytics.com/blog/disco-elysium-rezzed-2018-interview
- 常被引用的 "content just becomes more miserable – and a lot funnier" 只在搜尋摘要看到，未查證原出處。
- 可轉成的規則：失敗不卡關，給一段不同、更好笑的內容；讓主角的缺點有聲音；不受歡迎的路線也寫到全力。

### Pentiment（Josh Sawyer）
- 前提：16 世紀巴伐利亞修道院謀殺案，你必須指控一個人，但遊戲永遠不告訴你對不對。
- 設計者原話（已讀）："there's no canonical true killer"；"You just have to deal with not knowing for sure"；系統很輕，可以 "focus almost entirely on story"。出處：https://www.thegamer.com/interview-obsidian-josh-sawyer-pentiment/
- 可轉成的規則：選擇的代價是不確定性，NPC 事後對你的決定各有意見。

### Doki Doki Literature Club（Dan Salvato）
- 前提：表面是戀愛遊戲，其實是心理恐怖，會打破第四面牆。
- 設計者原話：Yume Nikki 對他的影響 "not because of their literal content, but because of how they made me feel"（已讀，轉引自 PC Invasion）：https://www.siliconera.com/doki-doki-literature-club-creator-listed-yume-nikki-as-an-inspiration-monika-ssbu/
- 真正的驚喜是遊戲用什麼方式嚇人（摘要）：https://primagames.com/gaming/doki-doki-literature-club-plus
- 可轉成的規則：先把類型外殼做得很真，再從內部崩壞；借的是作品給人的感受，不是內容。

## 二、跨作品的共同方法

1. 前提來自設計者的真實情緒或經歷（遺憾、孤獨、苦澀）。依據：To the Moon、OMORI、LISA。
2. 選一條 RPG 或類型慣例，把它反過來。依據：Undertale、DDLC、MOTHER。
3. 一條違反常識的世界規則，能自然產生衝突。依據：LISA、Undertale、Disco Elysium。
4. 賭注要高，代價要讓玩家「感覺到」。依據：LISA。
5. 失敗和錯誤不卡關，只把故事帶往另一個方向。依據：Disco Elysium、Pentiment。
6. 不公布標準答案，讓玩家帶著不確定離開。依據：Pentiment、Undertale。
7. 喜劇與悲劇並存，殘酷的事多用暗示。依據：LISA、Undertale、Disco Elysium。
8. 不為了像遊戲而硬塞玩法；沒有戰鬥時用對話和記憶推進。依據：To the Moon、Pentiment、Disco Elysium。
9. 把日常當舞台，怪誕從平凡裡長出來。依據：MOTHER、OMORI。
10. 混合喜歡的元素，但借「感受」而不是內容。依據：Undertale、DDLC、LISA。

## 三、AI 最容易寫出的老套（本平台歸納，不是出處內容）

已整理成 `src/ai/designGuide.ts` 的 `CLICHES`（N1～N15），每條附「怎麼反過來用」。

## 四、查證限制

- GameSkinny、RPGamer、Mary Sue、GameSpot、Prima Games、Kickstarter 都回傳 403，這些只看過搜尋摘要，已逐一標註。
- web.archive.org 無法存取。
- 糸井重里發想的日文原始來源（電ファミ漫畫訪談、ほぼ日連載）沒能讀到原文。
