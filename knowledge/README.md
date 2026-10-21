# 知識庫

AI 製作遊戲時查得到、而且會一直累積的參考資料。程式不會讀這裡；這裡給 AI agent 和人閱讀，讀完的結論再整理進 `src/ai/designGuide.ts`（準則）或 `docs/`（規範）。

| 資料夾 | 放什麼 |
|---|---|
| `research/` | AI 上網查回來的研究報告（設計者訪談、業界方法），每條都要有出處 |
| `references/` | 使用者提供的參考文件（企劃書、設定集、和其他 AI 的對話紀錄）。只當參考，不是規則 |

素材（圖、音樂、音效）不在這裡，在 `public/assets/`，授權紀錄在 `src/game/assets.ts` 的 `ASSET_LICENSES`。遊戲原始檔在 `content/<遊戲 ID>/`。

## 新增研究資料的規則

1. **一份報告一個主題**，檔名用英文小寫加連字號，例如 `research/narrative-indie-rpg.md`。
2. 開頭寫：研究日期、研究問題、用途（準備整理進哪一份準則）。
3. **每一條內容都要附 URL**，並標示可信度：
   - 「已讀」：實際開啟原頁面，引文出自那裡。
   - 「摘要」：原頁打不開，只看過搜尋結果的摘要，引用前要再核對。
   - 「未查證」：沒有找到原始出處。
4. 引文不超過 25 字；不要整段複製別人的文章。
5. 自己的歸納要明確標成「本平台歸納」，不要混在出處內容裡。
6. 研究結論被採用時，在準則裡註明出處編號（例如 W1～W11），並在 `docs/narrative-design-guide.md` 的參考來源列出。

## 目前的內容

- `research/narrative-indie-rpg.md`：劇情驅動 RPG 的設計者怎麼想出前提（LISA、Undertale、OMORI、To the Moon、MOTHER、Disco Elysium、Pentiment、DDLC）。已整理成 P 段（W1～W11）與老套清單 CLICHES。
- `references/gpt-rpg-studio-建議.md`：ChatGPT 對「怎麼寫好玩的 RPG 故事、AI 常犯的錯、AI 協作 Studio 怎麼設計」的建議（沒有出處，只當參考）。其中「角色降智、規模膨脹、秘密不揭曉、拒絕被強迫繞回、悲劇連發、角色知道不該知道的事」整理成 X9～X14。
- `references/gpt-橫向捲軸與3D網頁RPG.md`：橫向捲軸（LISA）與 3D 網頁 RPG 的討論，以及本平台的結論（目前維持 2D 俯視角，之後可以讓單張地圖改成側面視角）。
- `references/明天再拯救世界_RPG設定集.docx`：《明天再拯救世界！》原始設定集（使用者用 ChatGPT 產生）。曾做成第一章 Demo，2026-10-21 使用者決定刪除專案、從《最後一個會哭的人》重新開始；設定集留著當參考。
