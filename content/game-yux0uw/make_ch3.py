"""《最後一個會哭的人》第 3 章：產生 Studio 操作（ops），分批寫成 JSON。

已上線的內容只新增、不刪改 ID：前兩章的事件用「加一頁」的方式在第 3 章說不同的話（編號越大的頁越優先）。
第 3 章的條件一律用開關 c3_start（第 3 章開場結束）判斷。
加頁的基底是第 2 章完成時的版本：環境變數 BASE 指定（重跑時才不會重複加頁），預設用目前的 project.json。
"""
import copy, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else HERE
PROJECT = json.load(open(os.environ.get("BASE", os.path.join(HERE, "project.json"))))

# ---------- 小工具（與前兩章相同） ----------
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
def LABEL(n): return {"code": "label", "name": n}
def JUMP(n): return {"code": "jump", "name": n}

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
def door(id, name, x, y, to, tx, ty, d="down", cond=None):
    return ev(id, name, x, y, [page([GO(to, tx, ty, d)], trigger="touch", cond=cond)])
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
SAYO = "小夜"
C3 = {"switches": ["c3_start"]}
BLANK = lambda cond: page([], cond=cond, priority="below")

# 每拿到一份紀錄：三份都到手時，任務日誌提示回傘店
RECORD = lambda: [VAR("c3_records"), IF(v("c3_records", ">=", 3), [QUEST("q_night", "step", 1), T("（三份紀錄都拿到了。回傘店，把它們攤在櫃檯上吧。）")])]
# 醫院裡每找回一段記憶：三段都找回時，提示回病房
MEMORY = lambda: [VAR("c3_memories"), IF(v("c3_memories", ">=", 3), [QUEST("q_night", "step", 3), T("（那一夜的三個片段都回來了。最後一塊，在三〇七號病房。）")])]

# ---------- 資料庫 ----------
db = [
    {"op": "item.upsert", "item": {"id": "score_book", "name": "魚店大叔的分數本", "description": "十年、三十二本。每一天晴生的眼淚幾分，都寫在裡面。最高分的那幾天旁邊，畫著小小的叉。", "iconAssetId": "icon_letter"}},
    {"op": "item.upsert", "item": {"id": "order_book", "name": "美柑的客人紀錄", "description": "美柑的出貨與客人回饋。每一筆都寫著：喝了之後，想起了什麼。", "iconAssetId": "icon_letter"}},
    {"op": "item.upsert", "item": {"id": "obit_book", "name": "福壽堂的訃聞簿", "description": "福壽堂十年份的訃聞。每一頁是一個名字、一個日期。", "iconAssetId": "icon_letter"}},
    {"op": "quest.upsert", "quest": {"id": "q_night", "title": "那一夜", "description": "周防博士在傘店的櫃檯上攤開一張地圖：全國的箭頭都指向潮見町。她不肯說為什麼，只叫晴生自己去找答案。", "steps": [
        {"text": "找出三份紀錄：每天記錄你眼淚的人（魚店）、每天賣你眼淚的人（美柑的店面）、每天送走鎮上的人（福壽堂事務所）"},
        {"text": "三份紀錄都拿到了。回傘店，把它們攤在櫃檯上"},
        {"text": "在市立醫院舊病房大樓三樓找回那一夜：三〇七號病房、走廊的公共電話、樓梯間的窗戶"},
        {"text": "回到三〇七號病房"},
    ]}},
    {"op": "chapter.upsert", "chapter": {"id": "ch3", "title": "第三章　十年前的那一夜", "summary": "他終於知道，自己在替誰哭。",
        "testStart": {"mapId": "kasaya", "x": 4, "y": 4,
            "switches": ["accepted_gladly", "clue_konbu", "clue_whale", "clue_letters", "saw_bucket", "refused_mikan", "fish_100", "funeral_ready", "funeral_done",
                         "told_konbu", "told_whale", "told_letters", "miyuki_knows_whale", "miyuki_cried", "tell_done",
                         "c2_start", "c2_knows", "c2_matsu", "c2_crane", "c2_sheet", "c2_reviews", "mikan_stopped", "c2_miyuki", "c2_tai",
                         "c2_used_matsu", "c2_used_crane", "c2_used_sheet", "fukuda_cried", "crane_return", "c2_memorial_done"],
            "variables": {"clues": 3, "told": 3, "c2_clues": 3, "c2_told": 3},
            "items": {"photo": 1, "letters": 1, "crane": 1},
            "quests": {"q_itsuki": {"status": "completed", "step": 2}, "q_hikari": {"status": "completed", "step": 2}}}}},
    {"op": "ending.upsert", "ending": {"id": "end_ch3", "title": "第三章　十年前的那一夜", "mood": "somber", "nextChapterId": "ch4",
        "text": "燈籠流水，還有兩個禮拜。\n那天晚上，晴生把小夜那把天藍色的折傘攤在工作台上。\n十年了，他第一次想把它修好。",
        "epilogues": [
            {"condition": s("research_public"), "text": "周防博士的論文，會在燈籠流水之前寫好。到時候，鎮上的每個人都會知道自己的悲傷在哪裡。"},
            {"condition": s("research_public", False), "text": "這件事，只有晴生和周防博士知道。燈籠流水那天晚上，他得一個人決定。"},
            {"condition": v("c3_wrong", "==", 0), "text": "周防博士說，她花了十年才拼出來的東西，他在櫃檯前只花了一個下午。"},
            {"condition": s("c3_tried"), "text": "在三〇七號病房，他試過只為小夜哭，可是做不到。他第一次知道，自己想做到。"},
            {"condition": s("c3_waited"), "text": "在三〇七號病房，他沒有試。他想先把那把天藍色的傘修好，再跟她說話。"},
            {"condition": s("c3_lastpage"), "text": "魚店的分數本，多了第三十三本。第一頁寫著：「修傘的，今天沒來。有點寂寞。」"},
        ]}},
]
switches = [
    ("c3_start", "第 3 章開場結束"), ("c3_fish", "拿到魚店大叔的分數本"), ("c3_mikan", "拿到美柑的客人紀錄"), ("c3_obit", "拿到福壽堂的訃聞簿"),
    ("c3_lastpage", "偷看了分數本的最後一頁"), ("c3_deduced", "自己說出了答案"), ("m_bed", "想起病床上的小夜"), ("m_phone", "想起走廊的公共電話"),
    ("m_window", "想起樓梯間的窗戶"), ("c3_tried", "在病房試過只為小夜哭"), ("c3_waited", "在病房說「再等我一下」"), ("research_public", "讓周防博士公開研究"), ("c3_decided", "決定了研究要不要公開"),
]
db += [{"op": "switch.upsert", "switch": {"id": i, "name": n}} for i, n in switches]
db += [{"op": "variable.upsert", "variable": {"id": i, "name": n}} for i, n in [
    ("c3_records", "拿到幾份紀錄"), ("c3_memories", "在醫院找回幾段記憶"), ("c3_wrong", "在櫃檯前說錯的次數")]]

# ---------- 地圖 ----------
maps = {
    "city_hospital": ("市立醫院　舊病房大樓三樓", "melancholy", [
        "bbbbbbbbbbbbbbbbbb",
        "bwwbbbdbbbbbbwwbbb",
        "boooooooooooooooob",
        "boooooooooooooooob",
        "bhhoooooooooooooob",
        "boooooooooooooooob",
        "bbbbbbbbdbbbbbbbbb",
    ]),
    "sayo_room": ("三〇七號病房", "melancholy", [
        "bbbbbbbb",
        "bwwbbwwb",
        "boeoooob",
        "boEoooob",
        "boooohob",
        "bbbbdbbb",
    ]),
    "harbor": ("潮見港", "melancholy", [
        "~~~~~~~~~~~~~~~~~~~~~~~~",
        "~~~~~~~~~~~~~~~~~~~~~~~~",
        "~~~~~~~~~~~~~~~~~~~~~~~~",
        "~~~~~~~~~~~~~~~~~~~~~~~~",
        "________________________",
        "aaaaaaaaaaaaaaaaaaaaaaaa",
        "aanaaaaaaataaaaaaanaaaaa",
        "aaaaaaaaaaaaaaaaaaaaaaaa",
        "rrrrrrrrrrrrrrrrrrrrrrrr",
        "llllllllllllllllllllllll",
        "rrrrrrrrrrrrrrrrrrrrrrrr",
        "bbbbbwwbbbbbbbbbwwbbbbbb",
    ]),
}
mapops = []
for mid, (name, music, rows) in maps.items():
    assert all(len(r) == len(rows[0]) for r in rows), mid
    mapops.append({"op": "map.add", "id": mid, "name": name, "width": len(rows[0]), "height": len(rows), "music": music})
    mapops.append({"op": "map.terrain", "mapId": mid, "rows": rows})
mapops.append({"op": "map.update", "id": "harbor", "view": "wide"})

# ---------- 事件 ----------
evops = []
def add(map_id, *events):
    for e in events:
        evops.append({"op": "event.upsert", "mapId": map_id, "event": e})

# --- 前兩章的自動執行與章節事件：第 3 章（以及從第 3 章開始測試時）不再觸發 ---
evops.append(extend("kasaya", "ch2_opening", BLANK({"switches": ["c2_memorial_done"]})))
evops.append(extend("shotengai", "suou", BLANK(C3)))
evops.append(extend("hill", "suou_hill", BLANK(C3)))
evops.append(extend("funeral_hall", "lectern_drawer", page([T("（講台的抽屜空了。第 1 號業績表，社長拿回去了。）")], cond=C3)))

# --- 開場：周防博士的地圖 ---
opening3 = [
    NOTE("章節標題卡：玩家在第 2 章章末（end_ch2，nextChapterId＝ch3）按「繼續」時，系統會切換到第 3 章、自動顯示標題卡，並把玩家放在這一章的起點（傘店）"),
    T("（七月底。梅雨季結束了。）"),
    IF(s("miyuki_cried"), [T("（收音機播著天氣預報。晴生的眼睛是乾的。）")], [T("（收音機播著天氣預報。晴生的眼角又熱了，他已經懶得擦。）")]),
    T("（周防博士走進來，把一捲很大的紙攤在櫃檯上。是一張日本地圖，畫滿了紅色的箭頭。）"),
    T("（從北海道、從九州、從每一座城市出發的箭頭，全部指向同一個地方：潮見町。）"),
    T("……為什麼都指向這裡？", HARUO),
    T("你自己覺得呢？我說出來，你不會相信。你自己找出來，你就不得不信。", SUOU),
    IF(s("c2_sample"), [T("你給我的那滴眼淚，我又量了一次。還是對不上。", SUOU)]),
    T("去找三本帳：每天記錄你眼淚的人、每天賣你眼淚的人、每天送走鎮上的人。", SUOU),
    QUEST("q_night", "start"),
    SW("c3_start"),
    SELF("A"),
]
add("kasaya", ev("ch3_opening", "第 3 章開場", 5, 3, [
    page(opening3, trigger="autorun", cond={"switches": ["c2_memorial_done"]}, priority="below"),
    page([], cond={"selfSwitch": "A"}, priority="below"),
], note="第 3 章開場：周防博士的地圖"))
evops.append(extend("kasaya", "radio", page([
    T("（收音機在播盂蘭盆節的特集：「今年潮見港的燈籠流水，報名的人數又創新低……」）"),
], cond=C3)))
add("kasaya", ev("suou_map", "櫃檯上的地圖", 3, 3, [page([
    T("（周防博士的地圖。全國的紅色箭頭，全部指向潮見町。角落用鉛筆寫著：「不是消失，是流走了」。）"),
    IF(v("c3_records", "<", 3), [
        T("（三本帳，還缺：）"),
        IF(s("c3_fish", False), [T("（每天記錄他眼淚的人：魚店大叔的分數本。）")]),
        IF(s("c3_mikan", False), [T("（每天賣他眼淚的人：美柑的客人紀錄。店面在魚店旁邊。）")]),
        IF(s("c3_obit", False), [T("（每天送走鎮上的人：福壽堂的訃聞簿。商店街東邊的事務所。）")]),
    ]),
], cond=C3)]))

# --- 櫃檯前：晴生自己拼出答案（中段翻轉） ---
def wrong(line):
    return [VAR("c3_wrong"), T(line, HARUO)]
deduce = [
    T("（晴生把三本帳攤在櫃檯上。周防博士靠在門邊，沒有說話。）"),
    LABEL("q1"),
    T("分數本上打了叉的日子：十一月三日、三月九日、六月十日。訃聞簿翻到同一天——", HARUO),
    CH(
        OPT("佐藤爺爺、郵局的田中太太、森下樹。", [
            T("（三天，三個名字。一天都沒有對不上。）"),
        ]),
        OPT("福田光、佐藤爺爺、森下樹。", [*wrong("……不對。小光是十年前的六月，分數本那時候才剛開始。三月九日，是郵局的田中太太。"), JUMP("q1")]),
        OPT("那幾天，訃聞簿上沒有人。", [*wrong("……不對。我再翻一次。十一月三日，佐藤松吉，八十八歲。"), JUMP("q1")]),
    ),
    LABEL("q2"),
    T("可是四月二十日，也打了叉，九十二分。訃聞簿上，那天沒有人走。那一天是……", HARUO),
    CH(
        OPT("大叔記錯了。", [*wrong("……大叔三十二本一天都沒漏。他還寫了：「鎮上明明什麼事都沒有」。"), JUMP("q2")]),
        OPT("我感冒的日子。", [*wrong("……感冒會打噴嚏，不會哭到九十二分。"), JUMP("q2")]),
        OPT("新聞說遠方發生大火的日子。", [
            T("（分數本的那一頁，大叔的小字：「電視說，很遠的城市發生了大火。修傘的哭到打烊。」）"),
            T("鎮上沒有人走。走掉的，是很遠的地方、我一個都不認識的人。", HARUO),
        ]),
    ),
    LABEL("q3"),
    T("所以，我的眼淚裡，裝的是……", HARUO),
    CH(
        OPT("鎮上的人的悲傷。", [*wrong("……不對。四月二十日的大火，在很遠的城市。美柑的客人在東京、在九州，他們喝了，想起的也都是自己的事。"), JUMP("q3")]),
        OPT("我自己的悲傷。", [*wrong("……如果是我的，我為什麼十年來，一直說不出自己在難過什麼？"), JUMP("q3")]),
        OPT("全世界的悲傷。", [T("……全世界的悲傷。東京的、九州的、很遠的城市的。", HARUO)]),
    ),
    T("有人走掉的那天，我就會哭。我不是特別。我只是……大家的悲傷流過來的地方。", HARUO),
    T("……你自己說出來了。", SUOU),
    T("……天氣預報。以前聽到只是眼睛發酸。三個月前開始，一播就停不下來。", HARUO),
    T("那天早上也是。天氣預報一播我就哭了，森下太太剛好走進店裡。", HARUO),
    IF(s("c2_miyuki"), [T("阿樹出事那天，她在電話裡罵了他。那時候收音機正在播天氣預報。", HARUO)],
       [T("她說過，那段天氣預報，她最近都不敢聽。", HARUO)]),
    T("那滴眼淚是她的。告別式上我說了阿樹的事，她哭了，我的胸口就變輕了。悲傷回到了它的主人那裡。", HARUO),
    T("……說出一個人的故事，悲傷就會回家。這是我的溫度計量不出來的那一半。", SUOU),
    T("……可是，為什麼是我？", HARUO),
    T("那一夜，你在哪裡？", SUOU),
    T("……市立醫院。（那一夜的後半段，十年來都是一片白。）", HARUO),
    T("舊病房大樓還在，下個月就要拆了。我借到了鑰匙。", SUOU),
    SW("c3_deduced"),
    QUEST("q_night", "step", 2),
    SELF("A"),
    GO("city_hospital", 8, 5, "up"),
]
add("kasaya", ev("deduce", "櫃檯", 2, 4, [
    page(deduce, trigger="autorun", cond={"switches": ["c3_start"], "variable": {"id": "c3_records", "min": 3}}, priority="below"),
    page([], cond={"selfSwitch": "A"}, priority="below"),
], note="第 3 章的轉：晴生自己拼出答案"))

# --- 三份紀錄 ---
# 1. 魚店大叔的分數本
evops.append(extend("shotengai", "fish", page([
    T("分數本？十年、三十二本，一天都沒漏！拿去！", FISH),
    ITEM("score_book"),
    T("（第一頁：「晴天日的隔天。修傘的在店門口哭，九十八分。他說不知道為什麼。」）"),
    T("（打了叉的日子：十一月三日，九十分。三月九日，八十八分。四月二十日，九十二分。六月十日，九十五分。）"),
    T("那些叉啊……那幾天，整條商店街都怪怪的。四月那次最怪，鎮上明明什麼事都沒有，電視倒是一直在播很遠的地方的大火。", FISH),
    T("……最後一頁你別看！", FISH),
    CH(
        OPT("翻到最後一頁。", [
            IF(s("miyuki_cried"), [T("（「修傘的今天零分。他沒哭。……老實說，有點寂寞。」）")],
               [T("（「修傘的今天六十分。他好像知道自己在為誰哭了。我也想知道。」）")]),
            T("就叫你別看了啦！！", FISH),
            SW("c3_lastpage"),
        ]),
        OPT("不看。", [T("……謝謝。", HARUO), T("哼，算你有良心！", FISH)]),
    ),
    SW("c3_fish"), *RECORD(), SELF("B"),
], cond=C3, graphic="char_bald_villager"), page([
    T("分數本拿去看，要還喔！三十二本是我的命！", FISH),
], cond={"switches": ["c3_fish"]}, graphic="char_bald_villager")))

# 2. 美柑的客人紀錄（依第 2 章的選擇）
MIKAN_GIVE = lambda: [ITEM("order_book"), SW("c3_mikan"), *RECORD()]
mikan_c3 = [
    IF(s("mikan_partner"), [
        T("白金會員！一千瓶全賣光了！可是客人寫信來問了一件怪事。", MIKAN),
        T("（「喝了一口，想起了我的女兒。可是我女兒的事，怎麼會在您的眼淚裡？」）"),
        T("客人紀錄？不行不行，那是本店的商業機密！……除非您拿得出比本店更厲害的帳。", MIKAN),
        CH(
            OPT("拿出魚店大叔的分數本。", [
                T("（晴生翻開分數本，指著打了叉的日子。美柑湊過來，把自己的出貨單攤在旁邊。）"),
                T("……本店賣得最好的那幾天，跟大叔的叉，是同一天？好啦，給您。本店也想知道為什麼。", MIKAN),
                *MIKAN_GIVE(),
            ], has("score_book")),
            OPT("說小光的紙鶴。", [
                T("妳借我的那隻紙鶴，社長哭的時候，就握在手上。", HARUO),
                T("……看在小光的份上。給您。不准外流喔。", MIKAN),
                *MIKAN_GIVE(),
            ], s("c2_crane")),
            OPT("改天再來。", [T("本店隨時歡迎！帶著厲害的帳來！", MIKAN)]),
        ),
        IF(s("c3_mikan"), [T("錢存夠了。盂蘭盆節之後，本店就去東京。", MIKAN)]),
    ], [IF(s("mikan_stopped"), [
        T("……本店，還在公休。", MIKAN),
        T("這些是以前的客人紀錄。我看了一整晚，每一個人想起的，都是自己的事。您拿去吧。", MIKAN),
        T("……我寫了一封信給我媽。還沒寄。", MIKAN),
        *MIKAN_GIVE(),
    ], [
        T("本店小本經營中！今天也有三個客人！", MIKAN),
        T("客人紀錄？要那個做什麼……好啦，給您。每一筆都寫著，客人喝了之後想起了什麼。", MIKAN),
        *MIKAN_GIVE(),
    ])]),
    IF(s("c3_mikan"), [IF(ALL(s("crane_return"), has("crane")), [
        T("對了，這個還妳。", HARUO),
        T("（美柑接過紙鶴，放回餅乾鐵盒裡，蓋上蓋子之前，看了很久。）"),
        T("……歡迎回家。", MIKAN),
        ITEM("crane", -1),
    ], [IF(s("crane_fukuda"), [
        T("那隻紙鶴，我留給社長了。", HARUO),
        T("……那就送給社長吧。本店免費贈送。開店以來第一次。", MIKAN),
    ])])]),
]
evops.append(extend("mikan_base", "mikan_boss",
    page(mikan_c3, cond=C3, graphic="char_modern_girl"),
    page([
        IF(s("mikan_partner"), [T("東京的車票，本店已經買好了！……是單程票，因為不知道要待多久。", MIKAN)],
           [T("……盂蘭盆節那天，本店想去港口。放一盞燈籠給……算了，到時候再說。", MIKAN)]),
    ], cond={"switches": ["c3_mikan"]}, graphic="char_modern_girl")))

# 3. 福壽堂的訃聞簿：社長把它鎖進了抽屜。兩種解法：拿分數本給阿松看（她有備用鑰匙），或去跟社長要
OBIT_GET = lambda: [
    ITEM("obit_book"),
    T("（訃聞簿，十年份。十一月三日：佐藤松吉，八十八歲。三月九日：郵局的田中太太。六月十日：森下樹，十二歲。）"),
    T("（十年前的六月那一頁，只有一行：福田光，六歲。這本簿子，翻起來比想像中重。）"),
    SW("c3_obit"), *RECORD(),
]
evops.append(extend("fukujudo_office", "matsu", page([
    IF(s("c3_obit"), [T("訃聞簿，看完了要還，是吧。下個月還要寫。", MATSU)], [
        T("訃聞簿？……社長前幾天把它收進辦公桌的抽屜，上了鎖，是吧。", MATSU),
        IF(has("score_book"), [
            CH(
                OPT("給阿松看分數本。", [
                    T("（晴生翻開魚店大叔的分數本，指著那些打了叉的日子。）"),
                    T("……十一月三日，三月九日。這幾天的訃聞，都是我寫的，是吧。", MATSU),
                    T("（阿松從圍裙口袋裡拿出一把小鑰匙。）備用的。社長不知道，是吧。", MATSU),
                    *OBIT_GET(),
                ]),
                OPT("我去跟社長要。", [T("社長在裡面，是吧。他這幾天，話很少。", MATSU)]),
            ),
        ], [
            T("要的話，去跟社長說吧。……或者，您拿得出什麼讓我非開不可的東西，是吧。", MATSU),
        ]),
    ]),
], cond=C3, graphic="char_hooded_elder")))
evops.append(extend("fukujudo_office", "fukuda_office", page([
    IF(s("fukuda_cried"), [
        T("專業哭喪方案，我取消了。現在每一場，我都先去聽家屬說故人的事。", FUKUDA),
        T("你猜怎麼樣？二十三場裡，有三家人自己哭出來了。……我的業績表，不知道怎麼填了。", FUKUDA),
    ], [
        T("二十三場，我一場一場在辦。還是沒有人哭。", FUKUDA),
        T("……可是我開始會問家屬，故人生前喜歡什麼。以前從來不問的。", FUKUDA),
    ]),
    IF(s("c3_obit", False), [
        T("……訃聞簿？", FUKUDA),
        IF(s("fukuda_cried"), [
            T("（社長打開抽屜的鎖。）拿去。小光那一頁，你翻到就知道了。我收起來，是怕自己一直去翻。", FUKUDA),
        ], [
            T("訃聞簿是公司的機密。……（他看著晴生很久，嘆了一口氣，打開抽屜。）業務上，借你一天。", FUKUDA),
        ]),
        *OBIT_GET(),
    ]),
], cond=C3, graphic="char_modern_man")))

# --- 其他人（不必走，但都記得前面的事） ---
evops.append(extend("dagashi", "miyuki2", page([
    IF(s("c2_miyuki"), [
        T("雨宮先生。盂蘭盆節，我想放一盞燈籠。十年來第一次。", MIYUKI),
        T("……放給阿樹。也放給那天的那通電話。", MIYUKI),
    ], [
        T("雨宮先生。……有件事，我一直沒有跟任何人說。", MIYUKI),
        T("阿樹出事那天下午，他打電話給我，說要去港口。收音機正在播天氣預報。", MIYUKI),
        T("我說：「下雨天去什麼港口，隨便你，不要再打來了。」那是我跟他說的最後一句話。", MIYUKI),
        SW("c2_miyuki"),
    ]),
], cond=C3, graphic="char_modern_woman")))
evops.append(extend("dagashi", "ume", page([
    T("孩子，要不要燈籠紙？盂蘭盆節快到了。", UME),
    T("這十年，來買燈籠紙的人越來越少囉。今年倒是多了幾個。", UME),
], cond=C3, graphic="char_modern_elder")))
evops.append(extend("school_roof", "sho", page([
    T("呃、那個……盂蘭盆節那天，我想把鯨魚放回海裡。", SHO),
    T("阿樹說過，等牠長大，要放回海裡。牠……已經很胖了。", SHO),
], cond=C3, graphic="char_modern_boy")))
evops.append(extend("keeper_hut", "iwa", page([
    IF(s("clue_letters"), [T("……寫了一行。", IWA), T("（信紙上，「阿樹」的下面多了一行字，被用力劃掉了。）")],
       [T("……盂蘭盆節。", IWA), T("燈塔那晚，會亮整夜。", IWA)]),
], cond=C3, graphic="char_villager")))
evops.append(extend("shotengai", "fukuda", page([
    T("（福壽堂門口貼著一張新的紙：「故人的故事，歡迎來說」。是社長的字。）"),
], cond=C3)))

# --- 醫院 ---
hosp_intro = [
    T("（舊病房大樓的三樓。電燈只亮了一半，走廊盡頭有一台綠色的公共電話。）"),
    T("我在這裡等。你慢慢來。", SUOU),
    T("（三〇七號病房、走廊的公共電話、樓梯間的窗戶。那一夜，他去過這三個地方。）"),
    SELF("A"),
]
add("city_hospital",
    ev("hosp_intro", "舊病房大樓", 8, 4, [
        page(hosp_intro, trigger="autorun", cond={"switches": ["c3_deduced"]}, priority="below"),
        page([], cond={"selfSwitch": "A"}, priority="below"),
    ]),
    door("to_room307", "三〇七號病房", 6, 1, "sayo_room", 4, 4, "up"),
    ev("hosp_exit", "電梯", 8, 6, [page([T("（電梯口貼著「停止使用」。周防博士說，看完了再一起走樓梯下去。）")], trigger="touch")]),
    ev("suou_hosp", "周防博士", 10, 5, [page([
        IF(v("c3_memories", ">=", 3), [T("最後一塊在病房裡吧。去吧。", SUOU)], [
            T("慢慢來。這裡下個月就要拆了，可是今天，時間是你的。", SUOU),
            IF(s("m_bed", False), [T("三〇七號病房，就在那扇門後面。", SUOU)]),
            IF(s("m_phone", False), [T("走廊盡頭那台公共電話，十年前還能打。", SUOU)]),
            IF(s("m_window", False), [T("樓梯間的窗戶，看得見整座城。", SUOU)]),
        ]),
    ], graphic="char_long_hair")]),
    ev("payphone", "公共電話", 17, 3, [
        page([
            T("（綠色的公共電話。話筒上積了一層灰。）"),
            T("（十年前，他就是在這裡打電話給小夜的媽媽。凌晨兩點十五分。）"),
            T("媽……小夜她……", HARUO),
            T("（電話那頭沉默了很久，然後是一個很平的聲音。）"),
            T("……是嗎。我知道了。", speaker="小夜的媽媽"),
            T("（她沒有哭。那一刻，全世界的人都沒有哭。只有他，在這台電話前面，哭到站不住。）"),
            SW("m_phone"), *MEMORY(), SELF("A"),
        ]),
        page([T("（話筒掛回去了。那個很平的聲音，還在耳朵裡。）")], cond={"selfSwitch": "A"}),
    ]),
    ev("stair_window", "樓梯間的窗戶", 14, 1, [
        page([
            T("（樓梯間的窗戶。十年前的那一夜，外面下著很大的梅雨。）"),
            T("（他記得自己站在這裡，把額頭靠在玻璃上。然後——雨停了。）"),
            T("（不是慢慢變小。是一瞬間，整座城市的雨，同時停了。）"),
            T("（隔天早上是大晴天。後來，大家把那一天叫做「晴天日」。）"),
            T("（窗外的雨停了。可是他的雨，一直沒有停。）"),
            SW("m_window"), *MEMORY(), SELF("A"),
        ]),
        page([T("（窗外是七月的晴天。看得見港口。）")], cond={"selfSwitch": "A"}),
    ]),
    look("hosp_chairs", "候診椅", 1, 4, ["（一排褪色的候診椅。那一夜，小夜的媽媽沒有來。椅子一直是空的。）"]),
)
minute = [
    T("（凌晨兩點十三分。小夜的手鬆開的那一刻，他哭了。那一分鐘的眼淚，是他自己的。）"),
    T("（兩點十四分。有什麼東西從四面八方湧進來：不認識的老人的臉、一隻沒有回家的狗、一通沒有接到的電話……）"),
    T("（全世界的悲傷，流向了那一刻正在痛哭的人。他自己的那一分鐘，就這樣被淹沒了。）"),
    T("……小夜。", HARUO),
    CH(
        OPT("只為小夜哭。", [
            T("（他閉上眼睛。湧上來的，卻是佐藤爺爺的孫子、郵局太太的先生、遠方大火裡的陌生人……）"),
            T("……我找不到她。", HARUO),
            SW("c3_tried"),
        ]),
        OPT("……現在還不行。", [
            T("（他沒有試。他怕一試，就會發現自己做不到。）"),
            T("……對不起。再等我一下。", HARUO),
            SW("c3_waited"),
        ]),
    ),
    T("（周防博士站在門口。）……你找到了。", SUOU),
    T("我的研究可以寫成論文。公開的話，鎮上的人會知道自己的悲傷在哪裡，要不要拿回去，他們自己決定。", SUOU),
    T("可是你會變成一座水庫。福壽堂、美柑、東京的研究所，所有人都會來排隊。", SUOU),
    T("不公開的話，你可以繼續當一個修傘的。可是最後要不要還，只有你一個人決定。……你來選。", SUOU),
    CH(
        OPT("公開吧。", [
            T("大家的悲傷，應該讓大家自己決定。就算之後，我得天天排隊給人哭。", HARUO),
            T("……好。我會寫得很小心。", SUOU),
            SW("research_public"),
        ]),
        OPT("不要公開。", [
            T("……我不想變成水庫。也不想讓鎮上的人，一覺醒來發現自己欠了十年的眼淚。", HARUO),
            T("好。那這件事，只有我們兩個知道。", SUOU),
        ]),
    ),
    SW("c3_decided"),
    QUEST("q_night", "complete"),
    SELF("A"),
    WAIT(600),
    GO("harbor", 12, 6, "up"),
]
add("sayo_room",
    door("room_exit", "門", 4, 5, "city_hospital", 6, 2),
    ev("sayo_bed", "病床", 2, 2, [
        page([
            T("（三〇七號病房。床單是新的，窗簾是舊的。）"),
            T("（晴生在床邊坐下。手放到床沿的那一瞬間，他想起來了。）"),
            T("（十年前的這張床上，小夜瘦得只剩下一雙眼睛。她握著他的手，問了一句很普通的話。）"),
            T("……傘，修好了沒？", speaker=SAYO),
            T("（她那把天藍色的折傘，傘骨斷了兩根。他說：「明天就修好。」）"),
            T("你每次都這樣說。", speaker=SAYO),
            T("（她笑了一下。那是她說的，最後一句話。）"),
            T("……我到現在，還沒修好。", HARUO),
            SW("m_bed"), *MEMORY(), SELF("A"),
        ]),
        page([T("（床單是新的。可是他記得，十年前床單上有一小塊被眼淚弄溼的痕跡。是他的。）")], cond={"selfSwitch": "A"}),
    ]),
    ev("the_minute", "那一分鐘", 4, 3, [
        page(minute, trigger="autorun", cond={"switches": ["c3_deduced"], "variable": {"id": "c3_memories", "min": 3}}, priority="below"),
        page([], cond={"selfSwitch": "A"}, priority="below"),
    ], note="第 3 章的合：小夜過世的那一分鐘"),
    look("room_window", "窗戶", 5, 1, ["（窗外看得見港口。阿樹三個月前，就是在那裡。）"]),
)

# --- 港口：章末 ---
harbor_end = [
    T("（從醫院出來，太陽已經下山了。晴生一個人走到港口。三個月前，阿樹就是在這裡。）"),
    T("（倉庫的牆上貼著海報：「燈籠流水　八月十五日　潮見港」。）"),
    T("孩子，你也來看海啊。（阿梅婆婆提著一袋燈籠紙，慢慢走過來。）", UME),
    T("燈籠流水那天晚上，回不了家的東西，都會回家喔。……今年，你也放一盞吧。", UME),
    T("……放給誰？", HARUO),
    T("給你想讓它回家的。", UME),
    IF(s("research_public"), [T("（周防博士的論文，會在燈籠流水之前寫好。到時候，鎮上每個人都會知道。）")],
       [T("（這件事，只有他和周防博士知道。到了那天晚上，他得一個人決定。）")]),
    T("（海很平靜。燈塔的光，一圈一圈掃過水面。）"),
    {"code": "ending", "endingId": "end_ch3"},
]
add("harbor",
    ev("c3_end", "阿梅婆婆", 13, 6, [
        page(harbor_end, trigger="autorun", cond={"switches": ["c3_decided"]}, graphic="char_modern_elder"),
    ], note="第 3 章章末：燈籠流水的海報"),
    look("poster", "海報", 6, 11, ["（「燈籠流水　八月十五日　晚上七點　潮見港」。海報的一角被風吹得翹起來了。）"]),
)

# ---------- 成就 ----------
achv = [
    {"id": "achv_deduce", "title": "一個下午", "description": "在傘店的櫃檯前，一次都沒有說錯，就拼出了答案。", "hint": "三本帳攤在一起，答案就在那裡", "condition": ALL(s("c3_deduced"), v("c3_wrong", "==", 0))},
    {"id": "achv_lastpage", "title": "分數本的最後一頁", "description": "偷看了魚店大叔分數本的最後一頁。", "hint": "大叔叫你別看的那一頁", "hidden": True, "condition": s("c3_lastpage")},
]
db += [{"op": "achievement.upsert", "achievement": a} for a in achv]

batches = [db, mapops, evops]
for i, b in enumerate(batches, 1):
    assert len(b) <= 45, (i, len(b))
    with open(os.path.join(OUT, f"ch3-{i}.json"), "w") as f:
        json.dump(b, f, ensure_ascii=False, indent=1)
    print(f"ch3-{i}.json：{len(b)} 筆")
