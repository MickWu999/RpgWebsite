"""《最後一個會哭的人》第 4 章（最終章）：產生 Studio 操作（ops），分批寫成 JSON。

已上線的內容只新增、不刪改 ID：前三章的事件用「加一頁」的方式在第 4 章說不同的話（編號越大的頁越優先）。
第 4 章的條件一律用開關 c4_start（第 4 章開場結束）判斷。
加頁的基底是第 3 章完成時的版本：環境變數 BASE 指定（重跑時才不會重複加頁），預設用目前的 project.json。
"""
import copy, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else HERE
PROJECT = json.load(open(os.environ.get("BASE", os.path.join(HERE, "project.json"))))

# ---------- 小工具（與前幾章相同） ----------
def T(text, actor=None, speaker=None):
    c = {"code": "text", "text": text}
    if actor: c["actorId"] = actor
    if speaker: c["speaker"] = speaker
    return c
def SW(*ids, on=True): return {"code": "switch", "ids": list(ids), "value": on}
def NOTE(text): return {"code": "comment", "text": text}
def SELF(key="A", on=True): return {"code": "selfSwitch", "key": key, "value": on}
def VAR(i, v=1, op="add"): return {"code": "variable", "id": i, "op": op, "value": v}
def ITEM(i, d=1): return {"code": "item", "itemId": i, "delta": d}
def QUEST(q, action, step=None):
    c = {"code": "quest", "questId": q, "action": action}
    if step is not None: c["step"] = step
    return c
def GO(m, x, y, d=None):
    c = {"code": "transfer", "mapId": m, "x": x, "y": y}
    if d: c["direction"] = d
    return c
def IF(cond, then, els=None):
    c = {"code": "if", "condition": cond, "then": then}
    if els: c["else"] = els
    return c
def CH(*opts): return {"code": "choices", "options": list(opts)}
def OPT(text, cmds, cond=None):
    o = {"text": text, "commands": cmds}
    if cond: o["condition"] = cond
    return o
def WAIT(ms): return {"code": "wait", "ms": ms}
def MUSIC(m): return {"code": "music", "mood": m}
def END(i): return {"code": "ending", "endingId": i}

def s(i, v=True): return {"type": "switch", "id": i, "value": v}
def v(i, op, val): return {"type": "variable", "id": i, "op": op, "value": val}
def has(i): return {"type": "item", "itemId": i}
def ALL(*c): return {"type": "all", "conditions": list(c)}
def ANY(*c): return {"type": "any", "conditions": list(c)}

def page(cmds, trigger="action", priority="same", graphic=None, cond=None):
    p = {"trigger": trigger, "priority": priority, "commands": cmds}
    if graphic: p["graphic"] = {"assetId": graphic}
    if cond: p["conditions"] = cond
    return p
def ev(id, name, x, y, pages, note=None):
    e = {"id": id, "name": name, "x": x, "y": y, "pages": pages}
    if note: e["note"] = note
    return e
def look(id, name, x, y, lines, graphic=None, priority="same", cond=None):
    return ev(id, name, x, y, [page([T(l) for l in lines], graphic=graphic, priority=priority, cond=cond)])

def existing(map_id, event_id):
    m = next(m for m in PROJECT["maps"] if m["id"] == map_id)
    return copy.deepcopy(next(e for e in m["events"] if e["id"] == event_id))
def extend(map_id, event_id, *pages):
    """在既有事件後面加頁（舊頁保留，玩家存檔不受影響）"""
    e = existing(map_id, event_id)
    e["pages"] += list(pages)
    return {"op": "event.upsert", "mapId": map_id, "event": e}

HARUO, MIYUKI, FUKUDA, MIKAN, UME, IWA, SHO, FISH, SUOU, MATSU = "player", "miyuki", "fukuda", "mikan", "ume", "iwa", "sho", "fish", "suou", "matsu"
C4 = {"switches": ["c4_start"]}
BLANK = lambda cond: page([], cond=cond, priority="below")
PUBLIC = s("research_public")

# 港口上和來放燈籠的人說話（第一次）：說過三個人之後，小翔會帶著鯨魚出現
TALKED = lambda: [VAR("c4_talked"), SELF("A")]

# ---------- 資料庫 ----------
db = [
    {"op": "project.update", "release": {"status": "complete", "plannedChapters": 4}},
    {"op": "item.upsert", "item": {"id": "sayo_umbrella", "name": "小夜的傘", "description": "天藍色的折傘。斷掉的兩根傘骨接好了，傘柄上貼著小小的名牌：小夜。修了十年。", "iconAssetId": "icon_staff"}},
    {"op": "item.upsert", "item": {"id": "lantern", "name": "燈籠", "description": "阿梅婆婆替他糊的燈籠。上面還沒有寫名字。", "iconAssetId": "icon_candle"}},
    {"op": "quest.upsert", "quest": {"id": "q_lantern", "title": "燈籠流水", "description": "八月十五日，盂蘭盆節。燈籠流水的夜晚，回不了家的東西，都會回家。", "steps": [
        {"text": "把小夜的傘修好（傘店的工作台）"},
        {"text": "帶著燈籠和傘，去潮見港（商店街往西走到底）"},
        {"text": "和來放燈籠的人說說話"},
        {"text": "走到堤岸的最前面，放下你的燈籠"},
    ]}},
    {"op": "chapter.upsert", "chapter": {"id": "ch4", "title": "第四章　燈籠流水", "summary": "燈籠流水的夜晚，他要決定那些眼淚的去處。",
        "testStart": {"mapId": "kasaya", "x": 4, "y": 4,
            "switches": ["accepted_gladly", "clue_konbu", "clue_whale", "clue_letters", "saw_bucket", "refused_mikan", "fish_100", "funeral_ready", "funeral_done",
                         "told_konbu", "told_whale", "told_letters", "miyuki_knows_whale", "miyuki_cried", "tell_done",
                         "c2_start", "c2_knows", "c2_matsu", "c2_crane", "c2_sheet", "c2_reviews", "mikan_stopped", "c2_miyuki", "c2_tai",
                         "c2_used_matsu", "c2_used_crane", "c2_used_sheet", "fukuda_cried", "crane_return", "c2_memorial_done",
                         "c3_start", "c3_fish", "c3_mikan", "c3_obit", "c3_deduced", "m_bed", "m_phone", "m_window", "c3_tried", "research_public", "c3_decided"],
            "variables": {"clues": 3, "told": 3, "c2_clues": 3, "c2_told": 3, "c3_records": 3, "c3_memories": 3, "c3_wrong": 0},
            "items": {"photo": 1, "letters": 1, "score_book": 1, "order_book": 1, "obit_book": 1},
            "quests": {"q_itsuki": {"status": "completed", "step": 2}, "q_hikari": {"status": "completed", "step": 2}, "q_night": {"status": "completed", "step": 3}}}}},
]
switches = [("c4_start", "第 4 章開場結束"), ("c4_umbrella", "修好了小夜的傘"), ("c4_whale", "鯨魚回到了海裡"), ("sho_confessed", "小翔在燈籠流水的夜晚向美雪坦白")]
db += [{"op": "switch.upsert", "switch": {"id": i, "name": n}} for i, n in switches]
db += [{"op": "variable.upsert", "variable": {"id": "c4_talked", "name": "在港口說過話的人數"}},
       {"op": "variable.upsert", "variable": {"id": "returned", "name": "被晴生找回悲傷的人數（美雪、福田、美柑）"}}]

# --- 三個結局（每個結局都交代所有主要角色的去向；文字只寫條件保證成立的事） ---
iwa_reply = lambda line: [
    {"condition": s("clue_letters"), "text": f"老岩終於寫好了回信，放在阿樹的墓前。信只有一行：「{line}」"},
    {"condition": s("clue_letters", False), "text": "老岩對著燈塔，說了一句：「……有人寫信來過。」"},
]
endings = [
    {"id": "end_carry", "title": "繼續扛著", "mood": "somber",
     "text": "潮見町的夏天照常過去。大家照常生活，不太痛，也不太記得。\n雨宮傘店的燈每晚都亮到很晚。晴生還是動不動就哭。\n不同的是，他現在會在一本筆記本上，寫下每一滴眼淚是誰的。\n阿梅婆婆每天傍晚經過傘店，都會敲敲玻璃：「路上小心喔，孩子。」",
     "epilogues": [
        {"condition": s("miyuki_cried"), "text": "美雪每年都帶一根醋昆布去阿樹的墓。她的悲傷，在告別式那天就回到她身上了。她說，她很感謝。"},
        {"condition": s("miyuki_cried", False), "text": "美雪每年都帶一根醋昆布去阿樹的墓。她還是哭不出來，可是她會在墓前站很久。"},
        {"condition": s("c3_decided"), "text": "周防博士留在鎮上，繼續記錄晴生的眼淚。她說，她想看看一個人能扛多久。"},
        *iwa_reply("燈塔不寂寞。因為有人在看。"),
        {"condition": s("mikan_partner"), "text": "美柑去了東京。她寄回一張明信片：「見到了。她說她不知道怎麼難過，所以我替她記著。」"},
        {"condition": s("mikan_stopped"), "text": "美柑的店面改成了一間小小的文具店，專賣色紙。她說，是給想摺紙鶴的人。"},
        {"condition": ALL(s("mikan_partner", False), s("mikan_stopped", False)), "text": "美柑的淚水還在賣。瓶子上的標籤改了：「晴生先生的眼淚（其實是您的）」。"},
        {"condition": s("fukuda_cried"), "text": "福壽堂的業績表改了欄位：「哭泣人數」被劃掉，改成「說了幾個故事」。"},
        {"condition": s("fukuda_cried", False), "text": "福田社長的業績表，滿意度一直停在九成。他說，剩下的一成，他還在找。"},
        {"condition": s("c4_whale"), "text": "小翔把空了的水桶放回學校屋頂。桶邊多了一行字：「鯨魚，路上小心」。"},
        {"condition": s("sho_confessed"), "text": "小翔說，燈籠流水那天晚上說出來以後，他第一次睡得很熟。"},
     ]},
    {"id": "end_return", "title": "把悲傷還給大家", "mood": "bittersweet",
     "text": "那一夜，十年份的悲傷回到了每一個人身上。\n第二天早上下了雨。很久沒有人覺得，雨是這麼重的東西。\n晴生撐著小夜的傘走去港口。他不再動不動就哭了。他終於只為一個人，哭過一次。\n阿梅婆婆坐在駄菓子屋門口，對每一個哭著走過的人說：「路上小心喔。」",
     "epilogues": [
        {"condition": PUBLIC, "text": "美雪在燈籠流水的夜晚，第一次放聲大哭。她說，那是她和阿樹，遲了三個月的告別。"},
        {"condition": s("research_public", False), "text": "美雪不知道那一夜發生了什麼。可是她知道該陪著誰：那一整夜，她陪著小翔。"},
        {"condition": PUBLIC, "text": "周防博士的溫度計，第一次量不到數字。她辭掉了研究所，在商店街租了一間小房子。"},
        {"condition": s("research_public", False), "text": "周防博士被東京叫回去解釋。報告書上，她只寫了一句：「雨停了。」"},
        *iwa_reply("燈塔今天哭了。"),
        {"condition": s("mikan_partner"), "text": "美柑的淚水一夜之間賣不出去了。她拿著單程車票，還是去了東京。她說，這次要自己哭給媽媽看。"},
        {"condition": s("mikan_partner", False), "text": "美柑的庫存全變成了普通的水。她把瓶子倒空，在店門口貼了一張紙：「本店，畢業。」"},
        {"condition": s("fukuda_cried"), "text": "福壽堂那一夜接了四十通電話。社長每一通都說：「請說說故人的事。」"},
        {"condition": s("fukuda_cried", False), "text": "福田社長在福壽堂的會場最後面，哭了一整夜。是為了小光，十年份的。"},
        {"condition": s("c4_whale"), "text": "小翔哭了一整夜，為了阿樹。第二天，他去屋頂把空水桶洗乾淨了。"},
        {"condition": s("sho_confessed"), "text": "美雪後來常去小翔家。她說，想聽聽阿樹在學校的事，那些她不知道的事。"},
     ]},
    {"id": "end_together", "title": "一起慢慢還", "mood": "bittersweet",
     "text": "從那一天起，雨宮傘店的門口，每天晚上都擺著幾張折疊椅。\n有人來說一個故人的故事，悲傷就回到一個人身上。一個晚上，還一個人。\n這會花上很多年。晴生不再一個人扛了。\n每晚散場的時候，阿梅婆婆都對排班的人說：「路上小心喔。」",
     "epilogues": [
        {"condition": s("c4_start"), "text": "排班表上第一個名字，是森下美雪。她說阿樹的事，說一百次也不膩。"},
        {"condition": s("c3_decided"), "text": "周防博士把研究題目改成：「人怎麼一起悲傷」。她負責排班表。"},
        {"condition": s("fukuda_cried"), "text": "福壽堂的會場每個月借出來一次，不收錢。社長說：「這是業務。」"},
        {"condition": s("fukuda_cried", False), "text": "福田社長每次都坐在最後一排。他說，等輪到他的時候，他要說小光的事。"},
        {"condition": s("mikan_stopped"), "text": "美柑改賣「故事集點卡」：聽滿十個故事，送一根醋昆布。"},
        {"condition": s("mikan_partner"), "text": "美柑從東京打電話回來，預約了排班：她要說她媽媽的事，說給她媽媽聽。"},
        {"condition": ALL(s("mikan_partner", False), s("mikan_stopped", False)), "text": "美柑把剩下的淚水，全部倒進了海裡。她說，這些本來就不是本店的。"},
        *iwa_reply("燈塔以後有人輪班了。"),
        {"condition": s("c4_whale"), "text": "小翔每個禮拜都來排班。他說的，都是阿樹的事。"},
        {"condition": s("sho_confessed"), "text": "排班表上，美雪和小翔的名字總是排在同一天。"},
     ]},
]
db += [{"op": "ending.upsert", "ending": e} for e in endings]

# ---------- 地圖：商店街往西通往港口 ----------
mapops = [{"op": "map.paint", "mapId": "shotengai", "cells": [{"x": 0, "y": 6, "ch": "l"}]}]

# ---------- 事件 ----------
evops = []
def add(map_id, *events):
    for e in events:
        evops.append({"op": "event.upsert", "mapId": map_id, "event": e})

# --- 前三章的自動執行：第 4 章（以及從第 4 章開始測試時）不再觸發 ---
evops.append(extend("kasaya", "ch3_opening", BLANK({"switches": ["c3_decided"]})))
evops.append(extend("kasaya", "deduce", BLANK({"switches": ["c3_decided"]})))

# --- 開場：八月十五日的傘店 ---
opening4 = [
    NOTE("章節標題卡：玩家在第 3 章章末（end_ch3，nextChapterId＝ch4）按「繼續」時，系統會切換到第 4 章、自動顯示標題卡，並把玩家放在這一章的起點（傘店）"),
    T("（八月十五日，傍晚。商店街每一戶的門口，都掛上了燈籠。）"),
    IF(PUBLIC, [T("（收音機：「……周防博士的論文引起全國討論。今晚潮見港的燈籠流水，預計湧入大批人潮……」）")],
       [T("（收音機：「……今年潮見港的燈籠流水，報名的人數又創新低。」）")]),
    T("（工作台上攤著小夜那把天藍色的折傘。斷掉的兩根傘骨，昨天晚上終於接好了。只剩最後一針。）"),
    T("孩子，在嗎？（阿梅婆婆探頭進來，手上拿著一盞燈籠。）", UME),
    T("你的燈籠，我替你糊好了。名字還沒寫，你自己寫。……港口見喔。", UME),
    ITEM("lantern"),
    QUEST("q_lantern", "start"),
    SW("c4_start"),
    SELF("A"),
]
add("kasaya", ev("ch4_opening", "第 4 章開場", 6, 3, [
    page(opening4, trigger="autorun", cond={"switches": ["c3_decided"]}, priority="below"),
    page([], cond={"selfSwitch": "A"}, priority="below"),
], note="第 4 章開場：八月十五日"))
evops.append(extend("kasaya", "broken_umbrella", page([
    T("（最後一針。天藍色的傘面，終於又撐得開了。傘柄上的名牌：小夜。）"),
    IF(s("c3_tried"), [T("（在病房那天，他試過只為她哭，可是做不到。今天，他想再試一次。）")],
       [T("（在病房那天，他說「再等我一下」。今天，就是他說好的那一天。）")]),
    T("……修好了喔。你每次都說我騙人。", HARUO),
    ITEM("sayo_umbrella"), SW("c4_umbrella"), QUEST("q_lantern", "step", 1), SELF("B"),
], cond=C4), page([T("（工作台空了。傘在他手上。）")], cond={"selfSwitch": "B"})))
evops.append(extend("kasaya", "radio", page([T("（收音機在播盂蘭盆節的音樂。很慢，很舊的歌。）")], cond=C4)))

# --- 商店街：往港口；其他人都去港口了 ---
add("shotengai", ev("to_harbor", "往潮見港", 0, 6, [
    page([T("（往港口的路。從這裡走下去，看得到海。）")]),
    page([T("（還有一件事沒做完：傘店工作台上，小夜的傘。）")], cond=C4),
    page([GO("harbor", 22, 9, "left")], trigger="touch", priority="below", cond={"switches": ["c4_umbrella"]}),
]))
evops.append(extend("shotengai", "fish", page([
    T("今晚的眼淚，我不打分數了。……打不下去。我等一下也去港口。", FISH),
], cond=C4, graphic="char_bald_villager")))
evops.append(extend("fukujudo_office", "matsu", page([T("社長去港口了，是吧。他帶了兩盞燈籠。", MATSU)], cond=C4, graphic="char_hooded_elder")))
evops.append(extend("fukujudo_office", "fukuda_office", BLANK(C4)))
evops.append(extend("mikan_base", "mikan_boss", page([T("（店面裡沒有人。桌上留著一張紙條：「本店，港口出張中！」）")], cond=C4)))
evops.append(extend("dagashi", "miyuki2", BLANK(C4)))
evops.append(extend("dagashi", "ume", page([T("（駄菓子屋的門口掛著「本日休息」。阿梅婆婆去港口了。）")], cond=C4)))
evops.append(extend("school_roof", "sho", page([T("（屋頂上的藍色水桶不見了。）")], cond=C4)))
evops.append(extend("keeper_hut", "iwa", page([
    T("……今晚，燈塔亮整夜。", IWA),
    IF(s("clue_letters"), [T("（桌上的信紙，已經寫滿了一張。老岩用手蓋住，不讓晴生看。）")]),
], cond=C4, graphic="char_villager")))

# --- 港口 ---
harbor_intro = [
    T("（夜晚的潮見港。堤岸上，一盞一盞的燈籠亮了起來。）"),
    IF(PUBLIC, [
        T("（人比往年多了好幾倍。福壽堂的帳篷前排著長長的隊伍，有人認出晴生，小聲說：「就是他。」）"),
    ], [
        T("（人不多。放燈籠的大多是老人，海面上只漂著幾盞。沒有人知道，他們的悲傷就站在這裡。）"),
    ]),
    T("（認識的人，都來了。）"),
    QUEST("q_lantern", "step", 2),
    SELF("A"),
]
add("harbor", ev("c4_harbor_intro", "燈籠流水", 21, 9, [
    page(harbor_intro, trigger="autorun", cond=C4, priority="below"),
    page([], cond={"selfSwitch": "A"}, priority="below"),
]))
add("harbor", ev("harbor_exit", "回商店街", 23, 9, [page([GO("shotengai", 1, 6, "right")], trigger="touch", priority="below", cond=C4)]))

# 阿梅婆婆（第 3 章章末的事件：第 4 章改成一般對話）
evops.append(extend("harbor", "c3_end", page([
    T("孩子，傘修好了啊。", UME),
    T("燈籠放下去以前，先想好要讓誰回家喔。", UME),
    *TALKED(),
], cond=C4, graphic="char_modern_elder"), page([
    T("婆婆在這裡看著。慢慢來。", UME),
], cond={"switches": ["c4_start"], "selfSwitch": "A"}, graphic="char_modern_elder")))

# 美雪：對「要不要公開」的看法（P8）
add("harbor", ev("miyuki_h", "森下美雪", 5, 5, [
    page([
        IF(s("miyuki_cried"), [
            T("雨宮先生。我做了一盞燈籠給阿樹。……還有一盞，給那天的那通電話。", MIYUKI),
        ], [
            T("雨宮先生。我還是哭不出來。可是我想來看看，燈籠會不會帶走什麼。", MIYUKI),
        ]),
        IF(PUBLIC, [
            T("周防博士的論文，我讀了。原來我哭不出來，是因為我的悲傷在您那裡。", MIYUKI),
            T("……我不知道該謝謝您，還是該跟您要回來。這種事，本來不該讓大家知道的吧。", MIYUKI),
        ], [
            T("您今天好像揹著很重的東西。……不說也沒關係。我也有一句話，揹了很久。", MIYUKI),
        ]),
        *TALKED(),
    ], cond=C4, graphic="char_modern_woman"),
    page([T("（美雪蹲在堤岸邊，用手指在燈籠上寫字。）")], cond={"switches": ["c4_start"], "selfSwitch": "A"}, graphic="char_modern_woman"),
]))
# 福田社長
add("harbor", ev("fukuda_h", "福田社長", 8, 5, [
    page([
        IF(s("fukuda_cried"), [
            T("我做了一盞給小光。", FUKUDA),
            IF(s("crane_fukuda"), [T("那隻紙鶴，我綁在燈籠上了。讓她拿著。哭的時候，手上要有東西拿。", FUKUDA)]),
        ], [
            T("我是來觀摩的。……工作上的觀摩。（他手上，提著一盞沒有寫名字的燈籠。）", FUKUDA),
        ]),
        IF(PUBLIC, [
            T("福壽堂今晚發了號碼牌。想把悲傷要回來的人，請排隊。……這樣比較有秩序。", FUKUDA),
            T("我覺得公開是對的。不知道自己欠了什麼，比欠著更可怕。這是做生意的人的看法。", FUKUDA),
        ], [
            T("我什麼都不知道。可是你的臉，跟十年前我站在會場最後面的臉，很像。", FUKUDA),
            T("一個人扛的東西，別人看不出重量。……我是說，業務上，要找人分攤。", FUKUDA),
        ]),
        *TALKED(),
    ], cond=C4, graphic="char_modern_man"),
    page([T("號碼牌……不對，燈籠要從哪裡放下去來著？", FUKUDA)], cond={"switches": ["c4_start"], "selfSwitch": "A"}, graphic="char_modern_man"),
]))
# 美柑
add("harbor", ev("mikan_h", "美柑", 16, 5, [
    page([
        IF(s("mikan_partner"), [
            T("本店明天搭第一班車去東京！今晚是來……跟大家說掰掰的。", MIKAN),
            T("（她的燈籠上寫著：「媽，我來了」。）"),
        ], [IF(s("mikan_stopped"), [
            T("本店的燈籠，是給玄關那天的我。", MIKAN),
            T("信寄出去了。我媽回信了。她說，她走的時候一點都不難過。可是現在，她每天都在想我。", MIKAN),
            T("……她說她不知道怎麼難過。所以，想見我。", MIKAN),
        ], [
            T("本店今晚賣燈籠！一個三百圓！……您不用，您的燈籠是阿梅婆婆的手工限定款。", MIKAN),
        ])]),
        *TALKED(),
    ], cond=C4, graphic="char_modern_girl"),
    page([T("集點卡最後一點，本店替您蓋了。……今晚的份。", MIKAN)], cond={"switches": ["c4_start"], "selfSwitch": "A"}, graphic="char_modern_girl"),
]))
# 周防博士
add("harbor", ev("suou_h", "周防博士", 20, 5, [
    page([
        IF(PUBLIC, [
            T("我公開了。有人罵我，有人謝我。我一個都回答不了。", SUOU),
            T("我是研究者，只想知道真相。可是知道之後要怎麼做，不是我的研究能回答的。", SUOU),
        ], [
            T("沒有人知道。所以今晚，只有你一個人站在這裡。", SUOU),
            T("我會在旁邊看著。這是我能做的。……老實說，我也不知道哪一個是對的。", SUOU),
        ]),
        T("（她把溫度計收進口袋。今晚，她沒有量任何東西。）"),
        *TALKED(),
    ], cond=C4, graphic="char_long_hair"),
    page([T("你決定吧。我只負責記住。", SUOU)], cond={"switches": ["c4_start"], "selfSwitch": "A"}, graphic="char_long_hair"),
]))
# 魚店大叔
add("harbor", ev("fish_h", "魚店大叔", 11, 7, [
    page([
        T("修傘的！我說過今晚不打分數。……可是我帶了分數本來。", FISH),
        T("十年、三十二本。我想把它燒成燈籠的火。……你說，可以嗎？", FISH),
        CH(
            OPT("可以。", [T("好！那今晚的火，就是十年份的一百分！", FISH)]),
            OPT("留著吧。", [T("……也是。哪天你哭出一百分，我還要記下來。", FISH)]),
        ),
        *TALKED(),
    ], cond=C4, graphic="char_bald_villager"),
    page([T("今晚的海，真安靜啊。", FISH)], cond={"switches": ["c4_start"], "selfSwitch": "A"}, graphic="char_bald_villager"),
]))

# --- 轉：小翔帶著鯨魚來了 ---
whale = [
    T("呃、那個——！", SHO),
    T("（小翔抱著一個藍色的水桶跑過來。桶邊寫著：「鯨魚的家」。裡面是一條很胖的金魚。）"),
    T("阿樹說過，等鯨魚長大，要把牠放回海裡。……牠已經很胖了。", SHO),
    IF(s("miyuki_knows_whale"), [
        T("……我們一起放吧。", MIYUKI),
        T("（美雪蹲下來，和小翔一起扶著水桶。）"),
    ], [
        T("……那條金魚是？", MIYUKI),
        T("（小翔看了晴生一眼。晴生守了約定，什麼都沒說。小翔深吸一口氣。）"),
        T("阿、阿樹的媽媽……對不起。鯨魚是我帶回家的。阿樹去港口，是去找牠……", SHO),
        IF(s("miyuki_cried"), [
            T("（美雪蹲下來，抱住了小翔。她在哭。）"),
            T("……謝謝你。替他養到這麼胖。", MIYUKI),
        ], [
            T("（美雪看著水桶裡的金魚，看了很久很久。）"),
            T("……牠好胖。（她的聲音在抖，可是臉是乾的。）", MIYUKI),
        ]),
        SW("sho_confessed"),
    ]),
    T("（水桶傾斜。一條很胖的金魚滑進了海裡，紅色的尾巴在燈籠的光裡晃了一下，就不見了。）"),
    T("……鯨魚，路上小心。", SHO),
    T("（小翔空了的水桶，好輕。晴生看著它，想起自己扛了十年的東西。）"),
    SW("c4_whale"), QUEST("q_lantern", "step", 3), SELF("A"),
]
add("harbor", ev("sho_whale", "小翔", 13, 7, [
    page(whale, trigger="autorun", cond={"switches": ["c4_start"], "variable": {"id": "c4_talked", "min": 3}}, graphic="char_modern_boy"),
    page([T("呃、那個……鯨魚游走了。牠游得很好。", SHO)], cond={"selfSwitch": "A"}, graphic="char_modern_boy"),
], note="第 4 章的轉：鯨魚回到海裡"))

# --- 合：最後的決定 ---
choose_carry = [
    T("我來扛。", HARUO),
    T("大家已經習慣不痛了。這十年，有人因為不痛活了下來。我不能替他們決定要不要痛。", HARUO),
    T("（他在燈籠上寫下「小夜」，放進海裡。燈籠慢慢漂遠了。）"),
    T("（他在哭。這些眼淚還是大家的。可是現在，他知道每一滴是誰的。）"),
    T("我會記得。每一滴是誰的，我都會記下來。", HARUO),
    WAIT(800), QUEST("q_lantern", "complete"),
    END("end_carry"),
]
choose_return = [
    T("還給大家。", HARUO),
    T("（他撐開小夜的傘。天藍色的傘面，在燈籠的光裡亮了一下。）"),
    T("（有什麼東西，從他的身體裡，一點一點流了出去。流向身後的人，流向整條商店街，流向地圖上每一個箭頭的起點。）"),
    IF(PUBLIC, [
        T("（身後傳來第一聲啜泣。然後是第二聲、第三聲……）"),
        T("（堤岸上的每一個人，在燈籠流水的夜晚，一起哭了。像一場遲了十年的告別式。）"),
    ], [
        T("（身後傳來尖叫。有人跪在地上，有人抱著頭問：「為什麼？」）"),
        T("（他們不知道發生了什麼。十年份的悲傷，一次砸了下來。遠處，福壽堂的電話響了起來。）"),
        T("……對不起。我應該先告訴大家的。", HARUO),
    ]),
    T("（晴生的眼淚停了一下。然後，又掉了下來。）"),
    T("（這一次，他知道。這是他自己的。只屬於她的。）"),
    T("……小夜。", HARUO),
    T("（他在燈籠上寫下她的名字，放進海裡。）"),
    WAIT(800), QUEST("q_lantern", "complete"),
    END("end_return"),
]
choose_together = [
    T("……這些悲傷，我一個人還不完。", HARUO),
    T("可以幫我嗎？一個人一個人，慢慢還。", HARUO),
    IF(s("miyuki_cried"), [T("我來說阿樹的事。說一百次也可以。", MIYUKI)]),
    IF(s("fukuda_cried"), [T("福壽堂的會場，借你。不收錢。……這是業務。", FUKUDA)]),
    IF(s("mikan_stopped"), [T("本店改賣故事！集點卡照樣有！", MIKAN)]),
    T("排班表我來排。這次，我想用溫度計以外的方法。", SUOU),
    T("……那婆婆先說吧。", UME),
    T("（阿梅婆婆在晴生旁邊坐下，看著海。）"),
    T("小夜那孩子啊，以前每天都來買一瓶彈珠汽水。她說，彈珠卡在瓶口的聲音，很像下雨。", UME),
    T("她說她先生很愛哭，看電影也哭，看到落葉也哭。她說，她最喜歡他這一點。", UME),
    T("（晴生的眼淚掉了下來。這一次，他知道。這是他自己的。只屬於她的。）"),
    T("……小夜。", HARUO),
    T("（他在燈籠上寫下她的名字，放進海裡。燈籠旁邊，大家的燈籠一盞一盞跟了上去。）"),
    WAIT(800), QUEST("q_lantern", "complete"),
    END("end_together"),
]
final = [
    T("（晴生走到堤岸的最前面。海面上漂著燈籠，燈塔的光一圈一圈掃過水面。）"),
    IF(PUBLIC, [T("（身後排著長長的人龍。他們都知道，自己的悲傷就在這裡。）")],
       [T("（身後只有幾個人。他們不知道，自己的悲傷就站在這裡。）")]),
    T("（他手上有兩樣東西：阿梅婆婆的燈籠，和小夜的傘。）"),
    VAR("returned", 0, "set"),
    IF(s("miyuki_cried"), [VAR("returned")]),
    IF(s("fukuda_cried"), [VAR("returned")]),
    IF(s("mikan_stopped"), [VAR("returned")]),
    IF(v("returned", "<", 2), [
        T("（一個人一個人，把悲傷還回去？他想過。美雪、福田社長、美柑……能一起扛的人，還不夠。）"),
        T("……我一個人，做不到。", HARUO),
    ]),
    CH(
        OPT("我來扛。", choose_carry),
        OPT("還給大家。", choose_return),
        OPT("一起慢慢還。", choose_together, v("returned", ">=", 2)),
    ),
]
add("harbor", ev("lantern_point", "堤岸的最前面", 12, 4, [
    page([T("（堤岸的最前面。還不是時候……先和來放燈籠的人說說話吧。）")], cond=C4),
    page(final, cond={"switches": ["c4_whale"]}),
], note="第 4 章的合：最後的決定"))

# ---------- 成就 ----------
achv = [
    {"id": "achv_everyone", "title": "燈籠的夜晚", "description": "在燈籠流水的夜晚，和每一個來放燈籠的人說了話。", "hint": "港口上，還有人在等你說話", "condition": v("c4_talked", ">=", 6)},
    {"id": "achv_three", "title": "三個人", "description": "美雪、福田社長、美柑，都哭過了。", "hint": "被找回悲傷的人，可以一起扛", "hidden": True, "condition": ALL(s("miyuki_cried"), s("fukuda_cried"), s("mikan_stopped"))},
]
db += [{"op": "achievement.upsert", "achievement": a} for a in achv]

batches = [db, mapops, evops]
for i, b in enumerate(batches, 1):
    assert len(b) <= 45, (i, len(b))
    with open(os.path.join(OUT, f"ch4-{i}.json"), "w") as f:
        json.dump(b, f, ensure_ascii=False, indent=1)
    print(f"ch4-{i}.json：{len(b)} 筆")
