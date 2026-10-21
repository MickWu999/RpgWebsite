"""《最後一個會哭的人》第 2 章：產生 Studio 操作（ops），分批寫成 JSON。

已上線的內容只新增、不刪改 ID：第 1 章的事件用「加一頁」的方式在第 2 章說不同的話（編號越大的頁越優先）。
第 2 章的條件一律用開關 c2_start（第 2 章開場結束）判斷。
"""
import copy, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else HERE
# 加頁的基底是第 1 章上線時的版本（重跑時才不會重複加頁）：環境變數 BASE 指定，預設用目前的 project.json
PROJECT = json.load(open(os.environ.get("BASE", os.path.join(HERE, "project.json"))))

# ---------- 小工具（與 make_ch1.py 相同） ----------
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
    """在既有事件後面加頁（舊頁保留，玩家存檔不受影响）"""
    e = existing(map_id, event_id)
    e["pages"] += list(pages)
    return {"op": "event.upsert", "mapId": map_id, "event": e}

HARUO, MIYUKI, FUKUDA, MIKAN, UME, IWA, SHO, FISH, SUOU, MATSU = "player", "miyuki", "fukuda", "mikan", "ume", "iwa", "sho", "fish", "suou", "matsu"
C2 = {"switches": ["c2_start"]}

# 第一次知道「客戶」就是福田社長的女兒時的那一下（三條線都可能先發現，只演一次）
def realize(line):
    return IF(s("c2_knows"), [], [
        T(line, HARUO),
        T("（福田社長說的「老客戶」，是他自己。）"),
        SW("c2_knows"),
    ])
# 每找到一件小光的事：任務日誌在第一件之後提示可以去找社長
CLUE = lambda: [VAR("c2_clues"), IF(v("c2_clues", ">=", 1), [QUEST("q_hikari", "step", 1)])]

# ---------- 資料庫 ----------
db = [
    {"op": "actor.upsert", "actor": {"id": MATSU, "name": "阿松", "spriteAssetId": "char_hooded_elder", "voice": {"pitch": "mid", "speed": "slow", "timbre": "buzzy"},
        "profile": "福壽堂做了四十年的接待員，從福田社長的父親那一代就在。說話慢，句尾常加「是吧」。想要：社長有一天能好好休息。知道：小光小時候在接待桌上蓋自己的印章、對著開走的靈車說「路上小心」；小光的告別式上沒有人哭，社長在會場最後面一直數人數。不知道：美柑留著小光的紙鶴。"}},
    {"op": "item.upsert", "item": {"id": "tai", "name": "鯛魚", "description": "魚店大叔說好的「一百分的獎品」。一整尾，用報紙包著，比晴生的手臂還長。", "iconAssetId": "icon_coin"}},
    {"op": "item.upsert", "item": {"id": "crane", "name": "褪色的紙鶴", "description": "小光摺的紙鶴，美柑留了十年。翅膀上有一個用蠟筆寫的「光」。", "iconAssetId": "icon_letter"}},
    {"op": "quest.upsert", "quest": {"id": "q_hikari", "title": "認識小光", "description": "福田社長請晴生在一場法事上哭。故人叫光，六歲。除此之外，社長什麼都不肯說。", "steps": [
        {"text": "打聽「小光」的事：福壽堂的事務所（商店街東邊）、美柑的店面（魚店旁邊，鐵捲門拉一半那間）。小光的告別式也是在福壽堂辦的"},
        {"text": "認識小光一點了。準備好了，就到福壽堂事務所找福田社長"},
        {"text": "讓「客戶」好好地告別"},
    ]}},
    {"op": "chapter.upsert", "chapter": {"id": "ch2", "title": "第二章　每個人都想要他的眼淚", "summary": "告別式之後，鎮上每個人都想要他的眼淚。",
        "testStart": {"mapId": "kasaya", "x": 4, "y": 4,
            "switches": ["accepted_gladly", "clue_konbu", "clue_whale", "clue_letters", "saw_bucket", "refused_mikan", "fish_100", "funeral_ready", "funeral_done",
                         "told_konbu", "told_whale", "told_letters", "miyuki_knows_whale", "miyuki_cried", "tell_done"],
            "variables": {"clues": 3, "told": 3},
            "items": {"photo": 1, "letters": 1},
            "quests": {"q_itsuki": {"status": "completed", "step": 2}}}}},
    {"op": "ending.upsert", "ending": {"id": "end_ch2", "title": "第二章　每個人都想要他的眼淚", "mood": "somber", "nextChapterId": "ch3",
        "text": "回傘店的路上，商店街每一扇窗都還亮著。\n鎮上有二十三戶人家，在等他去哭。\n晴生把手插進口袋。這幾天他開始懷疑：那些眼淚，到底是誰的？",
        "epilogues": [
            {"condition": s("fukuda_cried"), "text": "福壽堂第 1 號業績表的滿意度那一欄，十年來第一次填上了數字。是福田社長自己的筆跡：「100」。"},
            {"condition": ALL(s("fukuda_cried", False), v("c2_told", ">=", 1)), "text": "福田社長沒有哭。可是他說，下個月的二十三場，他想先自己去問問每一位故人的事。"},
            {"condition": v("c2_told", "==", 0), "text": "福壽堂的「專業哭喪方案」延期了。福田社長在白板上寫：「試營運：0」，然後很久都沒有擦掉。"},
            {"condition": s("mikan_partner"), "text": "東京的第一批貨出了。美柑在集點卡背面寫了一行小字：「去東京的車票，還差三十二點。」"},
            {"condition": s("mikan_stopped"), "text": "美柑的店面拉下了鐵捲門，上面貼著一張紙：「本店公休。理由：在哭。」"},
            {"condition": s("c2_miyuki"), "text": "美雪說，她開始敢聽天氣預報了。只是音量會關得小小的。"},
            {"condition": s("crane_return"), "text": "那隻紙鶴要還給美柑。晴生把它夾在修傘的工具箱最上層，怕壓壞了。"},
            {"condition": s("crane_fukuda"), "text": "那隻褪色的紙鶴，現在放在福壽堂角落那個小小的櫃子裡，小光的照片前面。"},
            {"condition": s("c2_sample"), "text": "周防博士的試管裡，裝著晴生的一滴眼淚。她在標籤上寫了一個問號。"},
        ]}},
]
switches = [
    ("c2_start", "第 2 章開場結束"), ("c2_knows", "知道客戶就是福田社長的女兒"), ("c2_matsu", "從阿松那裡聽到小光的事"), ("c2_crane", "從美柑那裡聽到紙鶴的事"),
    ("c2_sheet", "看到第 1 號業績表"), ("c2_reviews", "看過美柑客人的評語"), ("mikan_partner", "答應和美柑合夥"), ("mikan_stopped", "勸美柑收手"),
    ("c2_miyuki", "聽美雪說了最後一通電話"), ("c2_sample", "給了周防博士一滴眼淚"), ("c2_tai", "在法事上供了鯛魚"),
    ("c2_used_matsu", "法事上說了蓋印章的事"), ("c2_used_crane", "法事上拿出紙鶴"), ("c2_used_sheet", "法事上說了第 1 號業績表"),
    ("fukuda_cried", "福田社長哭了"), ("crane_return", "紙鶴要還給美柑"), ("crane_fukuda", "紙鶴留給了福田社長"), ("c2_memorial_done", "小光的法事結束"),
]
db += [{"op": "switch.upsert", "switch": {"id": i, "name": n}} for i, n in switches]
db += [{"op": "variable.upsert", "variable": {"id": "c2_clues", "name": "蒐集到的小光的事"}},
       {"op": "variable.upsert", "variable": {"id": "c2_told", "name": "法事上說了幾件小光的事"}},
       {"op": "variable.upsert", "variable": {"id": "c2_last", "name": "法事上晴生剛說的那件事（社長的擋話回應用）"}}]

# ---------- 地圖 ----------
maps = {
    "fukujudo_office": ("福壽堂　事務所", "peaceful", [
        "bbbbbbdbbbbb",
        "byyyyooopyyb",
        "boooooooooob",
        "bojjooooojjb",
        "boooooooooob",
        "bohoooooohob",
        "bpoooooooopb",
        "bbbbbdbbbbbb",
    ]),
    "mikan_base": ("美柑的店面", "peaceful", [
        "bbbbbbbbb",
        "byyuuoojb",
        "booooooob",
        "bojjoooob",
        "booooooob",
        "bpoooooyb",
        "bbbbdbbbb",
    ]),
}
mapops = []
for mid, (name, music, rows) in maps.items():
    assert all(len(r) == len(rows[0]) for r in rows), mid
    mapops.append({"op": "map.add", "id": mid, "name": name, "width": len(rows[0]), "height": len(rows), "music": music})
    mapops.append({"op": "map.terrain", "mapId": mid, "rows": rows})
# 商店街：魚店旁邊的空店面（美柑的店面）開一扇鐵門
mapops.append({"op": "map.paint", "mapId": "shotengai", "cells": [{"x": 16, "y": 1, "ch": "d"}]})

# ---------- 事件 ----------
evops = []
def add(map_id, *events):
    for e in events:
        evops.append({"op": "event.upsert", "mapId": map_id, "event": e})

# --- 第 1 章的自動執行事件：第 2 章（以及從第 2 章開始測試時）不再觸發 ---
evops.append(extend("kasaya", "opening", page([], cond={"switches": ["funeral_done"]}, priority="below")))
evops.append(extend("funeral_hall", "funeral", page([], cond=C2, priority="below")))
# 周防博士：第 1 章章末的自動執行讓位；法事結束後是第 2 章的章末
suou_end = page([
    T("（福壽堂的燈一盞一盞熄了。周防博士靠在路燈下，手上的溫度計發著微光。）"),
    IF(s("fukuda_cried"), [
        T("福田社長哭了。我在窗外看見了。", SUOU),
        T("你呢？你剛才，一滴都沒掉吧。", SUOU),
    ], [
        T("法事結束了？……你看起來很累。", SUOU),
    ]),
    IF(s("c2_sample"), [
        T("你給我的那滴眼淚，我量過了。它的溫度，跟你的體溫對不上。", SUOU),
        T("……什麼意思？", HARUO),
    ]),
    IF(s("c2_reviews"), [
        T("……美柑的客人，喝了我的眼淚，想起的都是自己的事。沒有一個人想起我。", HARUO),
        T("（周防博士的筆停了一下，在筆記本上畫了一個箭頭。）"),
        T("是嗎。……那你覺得，那些眼淚裡裝的是什麼？", SUOU),
    ]),
    T("我在找一個地方。", SUOU),
    T("這十年，有很多東西一直往那裡流。", SUOU),
    T("……什麼東西？", HARUO),
    T("下次見面，帶著你自己的答案來。（她把溫度計收進口袋，走進夜裡。）", SUOU),
    {"code": "ending", "endingId": "end_ch2"},
], trigger="autorun", graphic="char_long_hair", cond={"switches": ["c2_memorial_done"]})
suou_base = existing("shotengai", "suou")
suou_base["pages"][0].setdefault("conditions", {})["custom"] = s("c2_start", False)  # 第 1 章章末：第 2 章開始後不再觸發
suou_base["pages"] += [page([], cond=C2, priority="below"), suou_end]
evops.append({"op": "event.upsert", "mapId": "shotengai", "event": suou_base})

# --- 開場：三坪的傘店，擠進三個想要他眼淚的人 ---
opening2 = [
    NOTE("章節標題卡：玩家在第 1 章章末（end_ch1，nextChapterId＝ch2）按「繼續」時，系統會切換到第 2 章、自動顯示標題卡，並把玩家放在這一章的起點（傘店）。這裡不再放「章節」指令，避免標題卡出現兩次"),
    T("（阿樹的告別式過了三天。早上的雨宮傘店。）"),
    T("（收音機：「……今天的潮見町，晴時多雲，午後偶爾有短暫陣雨。」）"),
    IF(s("miyuki_cried"), [
        T("（晴生放下手上的傘骨，等著。眼淚沒有來。）"),
        T("……沒有哭。", HARUO),
        T("（這三個月來，這段天氣預報第一次沒有讓他掉眼淚。他也不知道為什麼。）"),
        T("今天……零分？！修傘的，你沒哭？！十年來第一次零分啊！", speaker="門外的大嗓門"),
    ], [
        T("（晴生的眼角又熱了起來。他用袖子按了按。）"),
        T("……又來了。", HARUO),
        T("今天六十分！比上次少十分，退步啦！", speaker="門外的大嗓門"),
    ]),
    IF(s("fish_100"), [
        T("（魚店大叔扛著一個報紙包進來，「咚」一聲放在櫃檯上。）"),
        T("答應你的鯛魚！一百分的獎品！", FISH),
        ITEM("tai"),
        T("……這麼大一尾，我一個人吃不完。", HARUO),
        T("那就分給想分的人啊！魚是要大家一起吃的！", FISH),
    ]),
    T("（門鈴響了。福田社長抱著一本厚厚的預約簿衝進來。）"),
    T("雨宮先生！不得了了！告別式之後，電話一直響！", FUKUDA),
    T("二十三戶人家，指名要「會讓人哭出來的那位先生」！檔期排到下個月了！", FUKUDA),
    T("（門鈴又響了。美柑從社長的手臂底下鑽進來。）"),
    IF(s("sold_tissue"), [T("讓一讓讓一讓～供應商大人，本店有重大提案！", MIKAN)], [T("讓一讓讓一讓～本店說過不會放棄的！今天有重大提案！", MIKAN)]),
    T("東京的客人下了大單。本店想跟您「合夥」！", MIKAN),
    T("（門鈴第三次響了。撐黑傘的周防博士站在門口，手上拿著溫度計。）"),
    T("我只要一滴。", SUOU),
    T("……什麼？", HARUO),
    T("你的眼淚。一滴就好，我拿去量溫度。", SUOU),
    T("（三坪大的傘店，擠了三個想要他眼淚的人。）"),
    T("……我的店，只有三坪。", HARUO),
    T("先說正事！這個禮拜六有一場「試營運」，專業哭喪方案的第一場。", FUKUDA),
    T("客戶是……一位老客戶。一場法事。", FUKUDA),
    T("故人的資料呢？", HARUO),
    T("名字叫「光」。六歲。就這樣。客戶說，你上次不是自己去問的嗎？", FUKUDA),
    CH(
        OPT("……好。我先認識她。", [
            T("……好。光，六歲。我先去認識她。", HARUO),
            T("業務上拜託了！滿意度要九成以上！", FUKUDA),
        ]),
        OPT("我不是專業的哭喪人。", [
            T("社長，我不是專業的哭喪人。上次哭的是森下太太，不是我。", HARUO),
            T("試營運的客戶指定要你。這是業務。", FUKUDA),
            T("（福田社長把預約簿闔起來，深深地鞠了一個躬。晴生第一次看到他不談業績。）"),
            T("……我先去認識她。哭不哭得出來，我不知道。", HARUO),
        ]),
    ),
    T("本店的提案等您有空再談！店面在魚店旁邊，鐵捲門拉一半那間！", MIKAN),
    T("我會在燈塔山丘。想通了再來找我。", SUOU),
    T("（三個人一走，傘店突然變得好大。）"),
    QUEST("q_hikari", "start"),
    SW("c2_start"),
    SELF("A"),
]
add("kasaya", ev("ch2_opening", "第 2 章開場", 4, 3, [
    page(opening2, trigger="autorun", cond={"switches": ["funeral_done"]}, priority="below"),
    page([], cond={"selfSwitch": "A"}, priority="below"),
], note="第 2 章開場：三個想要他眼淚的人"))
evops.append(extend("kasaya", "radio", page([
    T("（收音機在播晨間新聞：「晴天日十週年，全國的離婚率、自殺率都是歷史新低。」）"),
    IF(s("miyuki_cried"), [T("（他關掉收音機。這幾天，天氣預報不再讓他流淚了。是哪裡變了？）")], [T("（他關掉收音機。天氣預報還是讓他流淚。）")]),
], cond=C2)))

# --- 商店街 ---
evops.append(extend("shotengai", "fukuda", page([
    T("（福田社長在福壽堂門口講電話：「是，是，下個月的檔期……」他看到晴生，摀住話筒。）"),
    IF(v("c2_clues", ">=", 1), [
        T("資料蒐集好了？晚上事務所見。客戶很守時。", FUKUDA),
    ], [
        T("試營運的資料，蒐集得如何？……什麼都別問我。客戶說了，你自己去問。", FUKUDA),
    ]),
], cond=C2, graphic="char_modern_man"), page([
    T("（福壽堂的門口沒有人。預約簿放在門邊的椅子上，第一頁被劃掉了一行。）"),
], cond={"switches": ["c2_memorial_done"]})))
evops.append(extend("shotengai", "fish", page([
    IF(has("tai"), [
        T("鯛魚吃了沒？那可是一百分的鯛魚！要分給想分的人！", FISH),
    ], [
        T("修傘的！我最近發現一件怪事。", FISH),
        T("我打了十年的分數，分數最高的那幾天，好像都是鎮上有人走掉的日子。……算了，我在說什麼。", FISH),
    ]),
], cond=C2, graphic="char_bald_villager")))
evops.append(extend("shotengai", "mikan", page([], cond=C2)))  # 第 2 章美柑在店面裡
evops.append(extend("shotengai", "bench2", page([
    T("（長椅上的老先生還在。他說他昨天突然想起了太太的名字，然後一整天都不想說話。）"),
], cond=C2)))
add("shotengai", ev("to_mikan", "鐵捲門拉一半的店面", 16, 1, [
    page([T("（空店面的鐵捲門拉下了一半。門縫裡傳出哼歌的聲音。）")]),
    page([GO("mikan_base", 4, 5, "up")], trigger="touch", cond=C2),
]))
evops.append(extend("shotengai", "funeral_door", page([GO("fukujudo_office", 5, 6, "up")], trigger="touch", cond=C2)))

# --- 福壽堂事務所 ---
matsu_tells = [
    T("小光是社長的女兒，是吧。那時候這間店還是社長的爸爸在做。", MATSU),
    T("那孩子最喜歡坐在這張接待桌上，在訪客簿蓋她自己的印章：一個圓圓的「光」。", MATSU),
    T("靈車開走的時候，她會跑到門口揮手，說「路上小心」。她以為大家只是回家去了，是吧。", MATSU),
    realize("……社長的女兒。"),
    T("晴天日之後兩個禮拜，她發了高燒。她的告別式，是社長自己辦的第一場。", MATSU),
    T("會場坐滿了，沒有一個人哭。社長站在最後面，一直在數人數。他那天開始做業績表，是吧。", MATSU),
    SW("c2_matsu"), *CLUE(),
]
add("fukujudo_office",
    door("office_exit", "出口", 5, 7, "shotengai", 21, 2),
    door("office_to_hall", "往告別式會場", 6, 0, "funeral_hall", 6, 8, "up"),
    ev("matsu", "阿松", 2, 2, [
        page([
            T("福壽堂，您好。……啊，是告別式那天的修傘先生，是吧。社長出去了。", MATSU),
            T("我想問「光」的事。社長說，這次的故人叫光，六歲。", HARUO),
            T("（阿松停下手上的筆。）"),
            T("……社長交代過，那個名字，誰都不准提。", MATSU),
            CH(
                OPT("我想讓「客戶」好好地告別。", [
                    T("社長把我找來，卻什麼都不肯說。我想，他其實是想讓誰好好地告別。", HARUO),
                    T("（阿松看了他很久，嘆了一口氣。）"),
                    T("……您跟社長說是我說的，也沒關係，是吧。", MATSU),
                    *matsu_tells,
                ]),
                OPT("那我改天再來。", [
                    T("好，是吧。……您要是已經知道一點那孩子的事，再來找我。", MATSU),
                    T("（阿松的視線，往通往告別式會場的那扇門飄了一下。）"),
                    SELF("B"),
                ]),
            ),
        ], graphic="char_hooded_elder"),
        page([
            T("您又來了，是吧。", MATSU),
            IF(ANY(s("c2_crane"), s("c2_sheet")), [
                IF(s("c2_crane"), [T("（晴生說了美柑留著的那隻紙鶴。阿松摀住了嘴。）"), T("……那孩子，連紙鶴都送出去了啊。", MATSU)],
                   [T("（晴生說了講台抽屜裡的第 1 號業績表。阿松閉上眼睛。）"), T("……原來社長把它收在那裡。", MATSU)]),
                *matsu_tells,
            ], [
                CH(
                    OPT("我想讓「客戶」好好地告別。", [
                        T("（阿松看了他很久，嘆了一口氣。）"),
                        *matsu_tells,
                    ]),
                    OPT("改天再來。", [T("好，是吧。", MATSU)]),
                ),
            ]),
        ], cond={"selfSwitch": "B"}, graphic="char_hooded_elder"),
        page([
            IF(s("c2_memorial_done"), [
                IF(s("fukuda_cried"), [T("社長今天早上，把訪客簿翻到第一頁看了很久。那個「光」的印章，是吧。", MATSU)],
                   [T("社長今天很早就來了。坐在接待桌上，什麼都沒做，是吧。", MATSU)]),
            ], [
                T("小光的印章，還收在這個抽屜裡。社長不知道，是吧。", MATSU),
            ]),
        ], cond={"switches": ["c2_matsu"]}, graphic="char_hooded_elder"),
    ]),
    look("office_desk", "社長的辦公桌", 9, 3, ["（辦公桌上貼著一張手寫的表：「本月滿意度　92%」。旁邊用紅筆圈起來：「目標 100%」。）", "（桌角放著一杯水。不是給客人的，杯子上畫著一隻兔子。）"]),
    look("binders", "業績表的檔案夾", 2, 1, ["（一整排檔案夾，書背寫著「業績表」。編號從第 2 號開始。）", "（第 1 號不在這裡。）"]),
    look("small_shelf", "小小的櫃子", 10, 1, ["（角落一個小小的櫃子，門關著。上面放著一杯新換的水，和一顆彈珠糖。）"]),
)

# 福田社長（晚上，事務所）：法事
def use_matsu():
    return [SW("c2_used_matsu"), VAR("c2_told"), VAR("c2_last", 1, "set"),
        T("她會坐在接待桌上，在訪客簿蓋自己的印章，一個圓圓的「光」。", HARUO),
        T("靈車開走的時候，她會跑到門口揮手，說「路上小心」。", HARUO),
        T("……阿松這個大嘴巴。", FUKUDA),
        T("（社長的聲音，在「嘴巴」那兩個字上破了。）")]
def use_crane():
    return [SW("c2_used_crane"), VAR("c2_told"), VAR("c2_last", 2, "set"),
        T("（晴生從口袋拿出那隻褪色的紙鶴，放進福田社長的手心。）"),
        T("美柑的媽媽離家那天，小光塞了這隻紙鶴給她。她說：「哭的時候，手上要有東西拿。」", HARUO),
        T("翅膀上的這個字，是她寫的。", HARUO),
        T("（福田社長的手指，停在那個歪歪的「光」上面。）")]
def use_sheet():
    return [SW("c2_used_sheet"), VAR("c2_told"), VAR("c2_last", 3, "set"),
        T("講台的抽屜裡，有第 1 號業績表。參加人數 31，哭泣人數 0。滿意度那一欄，是空白的。", HARUO),
        T("背面是一張蠟筆畫。一個光頭的大人，旁邊寫著「爸爸的工作　加油」。", HARUO),
        T("……那一張，我填不下去。", FUKUDA),
        T("所以我做了一千兩百張別的。每一張都填得滿滿的。", FUKUDA)]
# 社長的擋話會回應晴生上一句說了什麼（c2_last：1＝印章、2＝紙鶴、3＝業績表、0＝沒說）
RETORT = {
    1: "……印章是公司的財產。業務上的事，不用提。",
    2: "紙鶴……我們這行不收紙鶴。供品要先登記。",
    3: "那一張是作廢的。作廢的業績表，不算數。",
}
def rebut(fukuda_line, first=False):
    """社長擋一句，晴生可以拿出一件還沒說的小事（每件只能用一次）"""
    line = [T(fukuda_line, FUKUDA)] if first else [
        IF(v("c2_last", "==", 1), [T(RETORT[1], FUKUDA)], [IF(v("c2_last", "==", 2), [T(RETORT[2], FUKUDA)], [IF(v("c2_last", "==", 3), [T(RETORT[3], FUKUDA)], [T(fukuda_line, FUKUDA)])])]),
    ]
    return [
        *line,
        VAR("c2_last", 0, "set"),
        CH(
            OPT("說她蓋印章、揮手的事", use_matsu(), ALL(s("c2_matsu"), s("c2_used_matsu", False))),
            OPT("拿出紙鶴", use_crane(), ALL(s("c2_crane"), has("crane"), s("c2_used_crane", False))),
            OPT("說第 1 號業績表", use_sheet(), ALL(s("c2_sheet"), s("c2_used_sheet", False))),
            OPT("……", [T("……", HARUO)]),
        ),
    ]
memorial = [
    T("（晚上。事務所只剩辦公桌上的一盞燈。）"),
    T("試營運，開始吧。我是客戶的代理人。故人，光，六歲。請您哭。", FUKUDA),
    T("我不哭。我說說她的事。", HARUO),
    IF(has("tai"), [
        T("……還有，這個。魚店的鯛魚，一百分的獎品。", HARUO),
        T("供品？你帶一整尾鯛魚來法事？", FUKUDA),
        T("（社長瞪著鯛魚看了很久，嘴角動了一下。）"),
        T("……那孩子，最愛吃魚了。尤其是眼睛。很怪吧。", FUKUDA),
        ITEM("tai", -1), SW("c2_tai"),
    ]),
    *rebut("先說好，滿意度要九成以上。這是業務。", first=True),
    *rebut("故人的資料，我們這行不需要。哭就好。"),
    T("……時間差不多了。", FUKUDA),
    *rebut("結束吧。"),
    IF(v("c2_told", ">=", 2), [
        T("（福田社長沒有說話。辦公桌上的業績表，多了一個小小的圓點。）"),
        T("……欸？", FUKUDA),
        T("（又一個。他低頭看著自己的手背，像是第一次看到雨。）"),
        T("十年了。我辦了一千兩百場告別式，每一場都在數，有沒有人哭。", FUKUDA),
        T("原來我一直在等的……是這個啊。", FUKUDA),
        T("（社長站起來，打開角落那個小小的櫃子。裡面是一張照片：綁著歪掉的雙馬尾的女孩，額頭上蓋了一個紅紅的「光」。）"),
        T("小光。爸爸……爸爸今天，哭了。", FUKUDA),
        SW("fukuda_cried"),
        T("（晴生的眼睛是乾的。他看著社長，胸口某個地方，又輕了一點。）"),
    ], [IF(v("c2_told", "==", 1), [
        T("（福田社長沉默了很久，然後把業績表翻過來，蓋住。）"),
        T("……謝謝。我好像，想起一點她的聲音了。", FUKUDA),
        T("可是眼淚……還是沒有來。是我的問題，不是你的。", FUKUDA),
    ], [
        T("試營運……失敗。", FUKUDA),
        T("（社長笑了一聲，很乾的笑。）"),
        T("果然。這世界上，沒有人能讓我哭。", FUKUDA),
        T("……對不起。", HARUO),
        T("不，是我的錯。我連她的一件事都沒有告訴你。我自己，也快想不起來了。", FUKUDA),
    ])]),
    IF(has("crane"), [
        T("（紙鶴還在社長的手心裡。美柑說過，要還的。）"),
        CH(
            OPT("拿回來，還給美柑。", [
                T("……這隻紙鶴，是美柑借我的。我得還給她。", HARUO),
                T("（社長把紙鶴放回晴生手上，動作很慢，像在交接一份很重要的文件。）"),
                T("替我跟那孩子說聲謝謝。……十年了，原來還有人留著。", FUKUDA),
                SW("crane_return"),
            ]),
            OPT("留給社長。", [
                T("留著吧。美柑那邊，我去跟她說。", HARUO),
                T("（社長把紙鶴放在小光的照片前面。）……哭的時候，手上要有東西拿，是吧。", FUKUDA),
                ITEM("crane", -1), SW("crane_fukuda"),
            ]),
        ),
    ]),
    WAIT(600),
    QUEST("q_hikari", "complete"),
    SW("c2_memorial_done"),
    GO("shotengai", 21, 2, "down"),
]
add("fukujudo_office", ev("fukuda_office", "福田社長", 10, 2, [
    page([
        T("（福田社長坐在辦公桌後面，桌上攤著一張空白的業績表。）"),
        IF(v("c2_clues", "<", 2), [T("只問到一件事啊……要不要再去問問？……我是說，客戶不急。", FUKUDA)]),
        CH(
            OPT("開始吧。", [QUEST("q_hikari", "step", 2), *memorial]),
            OPT("我再去問問。", [T("好。……慢慢來。", FUKUDA)]),
        ),
    ], cond={"switches": ["c2_start"], "variable": {"id": "c2_clues", "min": 1}}, graphic="char_modern_man"),
    page([], cond={"switches": ["c2_memorial_done"]}),
], note="第 2 章的合：小光的法事"))

# --- 告別式會場：講台的抽屜 ---
add("funeral_hall", ev("lectern_drawer", "講台", 7, 1, [
    page([
        T("（告別式會場空著。講台的抽屜卡住了，用力一拉——）"),
        T("（裡面有一個發黃的檔案夾，書背寫著：「業績表　第 1 號」。）"),
        T("（日期是十年前的六月，晴天日的兩個禮拜後。故人：福田光，六歲。參加人數：31。哭泣人數：0。滿意度：空白。）"),
        realize("福田……光。"),
        T("（背面是一張蠟筆畫。一個光頭的大人，旁邊寫著歪歪的字：「爸爸的工作　加油」。）"),
        T("（晴生想起來，上次社長遞給他的那張紙，也是業績表的背面。）"),
        SW("c2_sheet"), *CLUE(), SELF("A"),
    ], cond=C2),
    page([T("（第 1 號業績表放回了抽屜。滿意度那一欄，還是空白的。）")], cond={"selfSwitch": "A"}),
]))

# --- 美柑的店面 ---
mikan_tells = [
    T("小光？……福壽堂的小光？", MIKAN),
    T("我們幼稚園同一班。她很怪，整天在摺紙鶴。", MIKAN),
    realize("……福壽堂的小光。"),
    T("（美柑從架子上拿下一個餅乾鐵盒，打開。裡面是一隻褪色的紙鶴。）"),
    T("我媽離家的那天，小光塞給我的。她說：「哭的時候，手上要有東西拿。」", MIKAN),
    T("可是那天，大家已經都不會哭了。我拿著它，在玄關站了一整個晚上。", MIKAN),
    T("（她把紙鶴放在晴生手上。）借您。社長的……法事要用的話。要還喔！", MIKAN),
    ITEM("crane"), SW("c2_crane"), *CLUE(),
]
mikan_reviews = [
    T("對了對了，給您看本店的客人評價，五顆星喔！（她把筆電轉過來。）", MIKAN),
    T("（螢幕上一排評價：「喝了之後，想起我爸在醫院握著我的手。」「想起了十年前死掉的狗，小黑。」）"),
    T("（「想起了自己的婚禮。不知道為什麼，很想跟前妻說對不起。」）"),
    T("……他們想起的，都是自己的事。", HARUO),
    T("對呀！所以評價才這麼好！", MIKAN),
    T("（沒有一個人想起晴生的事。一件都沒有。那這些眼淚裡裝的，到底是誰的悲傷？）"),
    SW("c2_reviews"),
    T("合夥的事，下次再談！本店先去進貨！……進面紙。", MIKAN),
    SELF("A"),
]
mikan_deal = [
    T("您來了！那來談正事！", MIKAN),
    T("東京有一家公司，想跟本店簽約，每個月一千瓶。只要您每天固定哭三次，本店負責收面紙，分您七成！", MIKAN),
    T("……妳為什麼這麼想賺錢？", HARUO),
    T("本店要去東京展店！……騙你的。", MIKAN),
    T("（美柑把鐵盒蓋上，聲音小了一點。）"),
    T("我想去東京找我媽。我想問她，走的時候，有沒有一點點難過。", MIKAN),
    T("所以，合夥的事？", MIKAN),
    CH(
        OPT("……我幫妳。", [
            T("每天三次，我盡量。只要妳去見她。", HARUO),
            T("成交！！集點卡升級成白金卡！", MIKAN),
            T("（她跳起來，又很快坐下。）……謝謝。真的。", MIKAN),
            T("（晴生知道，從明天起，他的眼淚會被裝進一千個玻璃瓶，送到全國的陌生人手上。）"),
            SW("mikan_partner"),
        ]),
        OPT("收手吧。", [
            T("妳想問妳媽媽難不難過。……那妳自己呢？", HARUO),
            T("妳在玄關站了一整個晚上的那天，手上拿著紙鶴的那天，妳難不難過？", HARUO),
            T("我？我又不會——", MIKAN),
            T("（美柑停住了。她摸了一下自己的臉，指尖是溼的。）"),
            T("……欸？這是……什麼？", MIKAN),
            T("好痛。原來……好痛喔。", MIKAN),
            T("（她哭了很久。晴生站在旁邊，眼睛是乾的。）"),
            T("……本店今天，公休。東京的事，本店會再想想。", MIKAN),
            SW("mikan_stopped"),
        ]),
    ),
    SELF("B"),
]
add("mikan_base",
    door("base_exit", "鐵捲門", 4, 6, "shotengai", 16, 2),
    ev("mikan_boss", "美柑", 5, 2, [
        page([
            T("歡迎光臨本店的「總部」！", MIKAN),
            IF(s("refused_mikan"), [T("雖然您拒絕過本店，本店還是很有禮貌的！", MIKAN)]),
            T("我在找一個叫「光」的孩子的事。六歲，十年前過世的。", HARUO),
            *mikan_tells,
            *mikan_reviews,
        ], graphic="char_modern_girl"),
        page(mikan_deal, cond={"selfSwitch": "A"}, graphic="char_modern_girl"),
        page([
            IF(s("mikan_stopped"), [
                T("……本店公休中。（她的眼睛腫腫的，抱著那個空了的鐵盒。）", MIKAN),
                T("我昨天晚上一直在想我媽的臉。原來我記得那麼清楚。", MIKAN),
            ], [
                T("白金會員您好！第一批貨，下禮拜出！", MIKAN),
                T("……我媽的地址，我已經查到了。在東京的練馬。", MIKAN),
            ]),
        ], cond={"selfSwitch": "B"}, graphic="char_modern_girl"),
    ]),
    look("bottles", "玻璃瓶", 2, 3, ["（一排貼著可愛貼紙的小玻璃瓶：「淚水・梅雨限定」「淚水・告別式當天」。）", "（瓶底沉著一點點白色的面紙纖維。）"]),
    look("filter", "流理臺", 3, 1, ["（流理臺上架著咖啡濾杯。美柑的「工廠」，原來就是一個咖啡濾杯。）"]),
    look("points", "集點卡", 7, 5, ["（牆上貼著一張放大的集點卡：「集滿十點，送『晴生先生打噴嚏時的淚水』（研發中）」。）"]),
)

# --- 駄菓子屋：美雪的最後一通電話（不必走，但第 3 章會用到） ---
add("dagashi", ev("miyuki2", "森下美雪", 6, 3, [
    page([
        IF(s("miyuki_cried"), [
            T("雨宮先生。……告別式之後，我每天都在哭。", MIYUKI),
            T("洗碗的時候、看到他的鞋子的時候。原來眼淚是這麼不方便的東西。", MIYUKI),
        ], [
            T("雨宮先生。告別式那天，謝謝您。……我還是哭不出來。", MIYUKI),
        ]),
        T("我來買醋昆布，供在那孩子的照片前面。", MIYUKI),
        T("……有件事，我沒有跟任何人說過。", MIYUKI),
        T("那天下午，阿樹打電話給我。收音機正在播天氣預報，說午後有雷陣雨。", MIYUKI),
        T("他說要去港口一下。我在上班，很忙，就說：「下雨天去什麼港口，隨便你，不要再打來了。」", MIYUKI),
        T("然後我就掛了電話。那是我跟他說的，最後一句話。", MIYUKI),
        IF(s("miyuki_knows_whale"), [
            T("他去找的那條金魚，還活著。小翔帶來給我看了。……牠好胖。", MIYUKI),
        ], [IF(s("promise_sho"), [
            T("（晴生想起屋頂上的小翔。他什麼都沒有說。）"),
        ])]),
        CH(
            OPT("那不是您的錯。", [
                T("那不是您的錯。", HARUO),
                T("大家都這麼說。……可是那句話，是我說的。", MIYUKI),
            ]),
            OPT("您一直帶著那句話。", [
                T("……您一直帶著那句話。", HARUO),
                T("嗯。每次聽到天氣預報，就會想起來。所以我不敢聽。", MIYUKI),
            ]),
        ),
        IF(s("miyuki_cried"), [
            T("（美雪又哭了。晴生站在旁邊，眼睛是乾的。以前聽到天氣預報就會掉的那些眼淚，到哪裡去了？）"),
        ], [
            T("（美雪的臉是乾的。晴生的眼角，卻熱了起來。）"),
        ]),
        SW("c2_miyuki"), SELF("A"),
    ], cond=C2, graphic="char_modern_woman"),
    page([T("（美雪對著醋昆布的架子，雙手合十。）"), T("路上小心喔，阿樹。……婆婆都是這樣說的吧。", MIYUKI)], cond={"selfSwitch": "A"}, graphic="char_modern_woman"),
]))
evops.append(extend("dagashi", "ume", page([
    T("孩子，你今天臉色不錯。", UME),
    T("阿樹的媽媽，這幾天每天都來。買一根醋昆布，什麼都不說就走。路上小心喔，我說。", UME),
], cond=C2, graphic="char_modern_elder")))

# --- 學校屋頂：小翔 ---
evops.append(extend("school_roof", "sho", page([
    IF(s("miyuki_knows_whale"), [
        T("呃、那個……你在告別式上說了鯨魚的事。我那時候站起來了，又坐下。", SHO),
        T("阿樹的媽媽後來來我家看鯨魚。她看了好久，只說了一句：「牠好胖。」", SHO),
    ], [IF(s("promise_sho"), [
        T("呃、那個……鯨魚很好。謝謝你沒說。", SHO),
        T("盂蘭盆節的時候，我在想要不要……呃，算了。", SHO),
    ], [
        T("呃、那個……鯨魚很好。", SHO),
    ])]),
], cond=C2, graphic="char_modern_boy")))

# --- 燈塔山丘：周防博士（可以給她一滴眼淚） ---
add("hill", ev("suou_hill", "周防博士", 12, 7, [
    page([
        T("（周防博士蹲在步道旁，把溫度計插進草地裡。）"),
        T("鎮上每個人的難過，我都量過了。全部都是三十二度，像隔著一層玻璃。", SUOU),
        T("只有你不一樣。所以，一滴就好。", SUOU),
        CH(
            OPT("……給妳。", [
                T("（晴生用指尖接住剛好掉下來的一滴，滴進她的試管。）"),
                T("謝謝。我量好會告訴你。", SUOU),
                SW("c2_sample"),
            ]),
            OPT("我的眼淚不是實驗品。", [
                T("我的眼淚不是實驗品。", HARUO),
                T("嗯，我知道。……那我等你。等你自己想知道的時候。", SUOU),
            ]),
        ),
        T("最近，你哭的時候，知道自己在難過什麼嗎？", SUOU),
        T("……這幾天，有時候知道。", HARUO),
        T("有時候知道。……很好的答案。", SUOU),
        SELF("A"),
    ], cond=C2, graphic="char_long_hair"),
    page([T("（周防博士在筆記本上畫了一張潮見町的地圖，上面有很多箭頭。她看到晴生，把筆記本闔上了。）")], cond={"selfSwitch": "A"}, graphic="char_long_hair"),
]))

# --- 看守人小屋：老岩在寫回信 ---
evops.append(extend("keeper_hut", "iwa", page([
    IF(s("clue_letters"), [
        T("（老岩坐在桌前，面前攤著一張信紙。上面只寫了兩個字：「阿樹」。）"),
        T("……在寫回信。", IWA),
        T("寫不出來。", IWA),
    ], [
        T("……那孩子的信。還在抽屜裡。", IWA),
        T("十一封。", IWA),
    ]),
], cond=C2, graphic="char_villager")))

# ---------- 成就 ----------
achv = [
    {"id": "achv_hikari", "title": "小光的三件事", "description": "在法事上，把小光的三件事都說了出來。", "hint": "小光的事，還有人知道", "condition": v("c2_told", ">=", 3)},
    {"id": "achv_tai", "title": "法事的鯛魚", "description": "把一百分的鯛魚供在小光的法事上。", "hint": "上一章的那個約定，魚店大叔記得", "hidden": True, "condition": s("c2_tai")},
    {"id": "achv_partner", "title": "白金會員", "description": "和美柑合夥做生意。", "hint": "美柑的提案，你可以答應", "condition": s("mikan_partner")},
    {"id": "achv_closed", "title": "本店今日公休", "description": "勸美柑收手，她第一次為媽媽哭了。", "hint": "美柑的提案，你可以拒絕", "condition": s("mikan_stopped")},
]
db += [{"op": "achievement.upsert", "achievement": a} for a in achv]

batches = [db, mapops, evops]
for i, b in enumerate(batches, 1):
    assert len(b) <= 45, (i, len(b))
    with open(os.path.join(OUT, f"ch2-{i}.json"), "w") as f:
        json.dump(b, f, ensure_ascii=False, indent=1)
    print(f"ch2-{i}.json：{len(b)} 筆")
