"""《午夜的大夜班》試玩原型（約 5 分鐘）：產生 Studio 操作（ops），寫成 JSON。

玩法驗證：時段（十點／十一點／十二點，十二點夜晚重來）＋筆記跨輪保留＋出示物品對質。
"""
import json, os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))

def T(text, actor=None, speaker=None):
    c = {"code": "text", "text": text}
    if actor: c["actorId"] = actor
    if speaker: c["speaker"] = speaker
    return c
def SW(*ids, on=True): return {"code": "switch", "ids": list(ids), "value": on}
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
def TIME(**kw): return {"code": "time", **kw}
def s(i, v=True): return {"type": "switch", "id": i, "value": v}
def v(i, op, val): return {"type": "variable", "id": i, "op": op, "value": val}
def has(i): return {"type": "item", "itemId": i}
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
def look(id, name, x, y, lines, cond=None):
    return ev(id, name, x, y, [page([T(l) for l in lines], cond=cond)])

ZHOU, LIN, YU, KAI = "player", "lin", "yu", "kai"
MAP = "store"
PERIOD = lambda n: v("period", "==", n)
# 「仔細問」要花掉一個時段；問到的事記在筆記（物品），下一輪還在
ASK_COST = TIME(advance=1)

db = [
    {"op": "project.update", "title": "午夜的大夜班", "genre": "modern",
     "description": "每到午夜十二點，這間便利商店的夜晚就會重來一次，只有大夜班店員記得。取貨櫃上那個寄給店長的包裹，每一輪都在十二點前被人拿走。是誰？為什麼？",
     "intro": "晚上十點到早上六點，是小周的大夜班。\n\n他以為今晚也會跟平常一樣無聊。",
     "cover": {"mapId": MAP, "characterAssetIds": ["char_modern_boy", "char_modern_girl"], "tagline": "這個夜晚，已經重來第幾次了？"},
     "release": {"status": "ongoing", "plannedChapters": 3}},
    {"op": "system.update", "clock": {"periods": ["十點", "十一點", "十二點"]}},
]
actors = [
    (ZHOU, "小周", "char_modern_boy", {"pitch": "mid", "speed": "normal", "timbre": "soft"}, "便利商店的大夜班店員，二十歲。懶得跟人打交道，觀察力卻很好。只有他記得每一輪發生的事。"),
    (LIN, "林先生", "char_modern_man", {"pitch": "low", "speed": "fast", "timbre": "bright"}, "每晚十點準時來買一杯熱美式的上班族。講話像在開會，十一點以前一定離開。"),
    (YU, "芷妤", "char_modern_girl", {"pitch": "high", "speed": "normal", "timbre": "soft"}, "坐在窗邊寫作業的高中生，戴著耳機。說自己一直沒離開過座位。秘密：寄給店長的包裹是她用媽媽的名字寄的。店長是她從沒見過的爸爸。"),
    (KAI, "阿凱", "char_modern_worker", {"pitch": "mid", "speed": "fast", "timbre": "buzzy"}, "等滷味等到快十二點的外送員。愛抱怨，什麼都看在眼裡。"),
]
for id, name, sprite, voice, profile in actors:
    db.append({"op": "actor.upsert", "actor": {"id": id, "name": name, "spriteAssetId": sprite, "voice": voice, "profile": profile}})
notes = [
    ("note_receipt", "林先生的發票", "結帳時間 23:12。熱美式一杯。他說拿了發票就走了。"),
    ("note_yu", "芷妤的說法", "「我一直坐在這裡，戴著耳機，沒離開過座位。」"),
    ("note_kai", "阿凱的證詞", "「十一點的時候，那個女生走到取貨櫃那邊，一直盯著一個包裹看。」"),
    ("note_ring", "取貨櫃旁的水痕", "十一點，取貨櫃旁邊的櫃台上有一圈還沒乾的水痕，大小跟芷妤的奶茶杯底一模一樣。"),
]
for id, name, desc in notes:
    db.append({"op": "item.upsert", "item": {"id": id, "name": name, "description": desc, "iconAssetId": "icon_letter"}})
db += [
    {"op": "quest.upsert", "quest": {"id": "q_letter", "title": "取貨櫃上的包裹", "description": "店長交代：取貨櫃上那個寄給他的包裹很重要，他早上自己來拿。", "steps": [
        {"text": "找出十二點前拿走包裹的人。「仔細問」會花掉一個時段（十點 → 十一點 → 十二點），先想好要問誰"},
        {"text": "夜晚又重來了。上一輪問到的事都在筆記裡（選單的「物品」），這一輪先問還沒問的人"},
        {"text": "有人說了謊。找到證據，跟那個人對質"},
    ]}},
    {"op": "ending.upsert", "ending": {"id": "end_hand", "title": "她自己交給他", "mood": "bittersweet",
        "text": "時鐘走過了十二點。這一次，夜晚沒有重來。\n早上七點，店長走進來的時候，芷妤已經在門口等著了。她手上抱著那個包裹。\n（試玩版到這裡結束）",
        "epilogues": [{"condition": v("loop", "<=", 1), "text": "這個夜晚只重來了一次。小周有點得意，又有點可惜。"},
                      {"condition": v("loop", ">=", 2), "text": f"這個夜晚重來了好幾次。小周把每一輪的筆記，都留在了收銀機旁邊。"}]}},
    {"op": "ending.upsert", "ending": {"id": "end_back", "title": "放回取貨櫃", "mood": "mysterious",
        "text": "時鐘走過了十二點。這一次，夜晚沒有重來。\n包裹回到了取貨櫃上。早上店長來取件的時候，看著寄件人的名字看了很久，然後問小周：「昨晚，有誰來過嗎？」\n（試玩版到這裡結束）",
        "epilogues": [{"condition": v("loop", "<=", 1), "text": "這個夜晚只重來了一次。"},
                      {"condition": v("loop", ">=", 2), "text": "這個夜晚重來了好幾次。小周決定，什麼都不說。"}]}},
    {"op": "ending.remove", "id": "end_placeholder"},
    {"op": "variable.upsert", "variable": {"id": "loop", "name": "夜晚重來了幾次"}},
]
for sid, name in [("k_lin", "仔細問過林先生"), ("k_yu", "仔細問過芷妤"), ("k_kai", "仔細問過阿凱"), ("k_ring", "看到櫃檯上的水痕"), ("solved", "芷妤說出真相")]:
    db.append({"op": "switch.upsert", "switch": {"id": sid, "name": name}})

rows = [
    "bbbbbbbbbbbbbb",
    "biiiiiiiQssssb",
    "bssssssssssssb",
    "bsgzAssgzAsssb",
    "bsssssssssssAb",
    "bsAzgssAgzJJKb",
    "bssssssssssssb",
    "bVVsssssssssib",
    "bwwwwNNwwwwwwb",
]
assert all(len(r) == 14 for r in rows)
mapops = [
    {"op": "map.add", "id": MAP, "name": "便利商店（大夜班）", "width": 14, "height": 9, "music": "mysterious"},
    {"op": "map.terrain", "mapId": MAP, "rows": rows},
    {"op": "system.update", "start": {"mapId": MAP, "x": 11, "y": 4, "direction": "left"}, "playerActorId": ZHOU},
    {"op": "map.remove", "id": "start"},
    {"op": "chapter.upsert", "chapter": {"id": "ch1", "title": "第一夜（試玩版）", "summary": "取貨櫃上的包裹，每一輪都在十二點前被拿走。", "testStart": {"mapId": MAP, "x": 11, "y": 4}}},
]

again = IF(v("loop", ">=", 1), [T("（這句話，小周已經聽過了。一字不差。）")])
events = [
    ev("opening", "開場", 1, 2, [
        page([
            {"code": "chapter", "chapterId": "ch1"},
            TIME(period=2),
            T("（晚上十一點五十九分。雨下個不停。）"),
            T("（櫃台後面的取貨櫃上，有一個「店到店」的包裹。收件人：店長。店長下午交代過：「那個包裹很重要，我早上自己來拿。」）"),
            T("（十二點。店裡的燈閃了一下——）"),
            T("（再看過去的時候，取貨櫃上的包裹不見了。取件紀錄上，沒有任何人領過。）"),
            T("……不會吧。我一直在店裡啊。", ZHOU),
            T("（時鐘的指針開始倒轉。自動門「叮咚」一聲——）"),
            TIME(period=0),
            T("（晚上十點。林先生走進來：「一杯熱美式。……今天也下雨啊。」）"),
            T("……又是十點？剛剛那是夢嗎？", ZHOU),
            T("（口袋裡，剛才寫到一半的交班筆記還在。最後一行的時間是 23:59。）"),
            T("不是夢。十二點以前，有人會拿走那個包裹。這一次，我要知道是誰。", ZHOU),
            T("（店裡現在有三個客人：買咖啡的林先生、等外送的阿凱、坐在窗邊寫作業的芷妤。）"),
            T("（「聊兩句」不花時間；「仔細問」會花掉一個時段。有人十一點就會離開。十二點一到，夜晚會再重來一次，但筆記會留著。）"),
            QUEST("q_letter", "start"),
            {"code": "selfSwitch", "key": "A", "value": True},
        ], trigger="autorun", priority="below"),
        page([], cond={"selfSwitch": "A"}, priority="below"),
    ]),
    # 十二點：包裹不見，夜晚重來（筆記與開關保留，時間回到十點）
    ev("midnight", "十二點", 1, 7, [
        page([
            T("（十二點。店裡的燈閃了一下。）"),
            T("（取貨櫃上的包裹，不見了。）"),
            IF(v("loop", "==", 0), [
                T("……又被拿走了。我還沒問完。", ZHOU),
                T("（時鐘倒轉，自動門叮咚——）"),
                QUEST("q_letter", "step", 1),
            ], [T("（又來了。時鐘倒轉，自動門叮咚。）")]),
            VAR("loop"),
            TIME(period=0),
            GO(MAP, 11, 4, "left"),
            T("（晚上十點。林先生走進來：「一杯熱美式。……今天也下雨啊。」）"),
            IF(v("loop", "==", 1), [T("筆記還在。上一輪問到的事，都寫在上面。這一輪，先問還沒問的人。", ZHOU)]),
        ], trigger="autorun", priority="below", cond={"variable": {"id": "period", "min": 2}}),
    ], note="夜晚重來"),
    look("letter", "取貨櫃", 12, 4, ["（取貨櫃上排著明天要取的包裹。最邊邊那個，收件人寫著「店長」，寄件人是「林淑芬」。）", "（寄件單上的字很工整，像是練習過很多次。）"]),
    ev("ring", "櫃檯", 11, 5, [
        page([T("（櫃檯擦得很乾淨。）")]),
        page([
            T("（取貨櫃旁邊的櫃台上，有一圈還沒乾的水痕。大小……跟窗邊那杯奶茶的杯底一樣。）"),
            IF(s("k_ring", False), [T("（小周把它記進筆記：十一點，取貨櫃旁的水痕。）"), ITEM("note_ring"), SW("k_ring")]),
        ], cond={"variable": {"id": "period", "min": 1}}),
    ]),
    look("coffee", "咖啡機", 8, 1, ["（咖啡機。林先生每晚十點的熱美式，都是從這裡出來的。）"]),
    look("shelf", "貨架", 2, 3, ["（泡麵、零食、雨傘。今晚雨傘賣得特別好。）"]),
    ev("door", "自動門", 5, 8, [page([T("（外面下著大雨。大夜班不能離開店裡。）")], trigger="touch")]),
    ev("door2", "自動門", 6, 8, [page([T("（自動門「叮咚」一聲開了，又關上。外面下著大雨。）")], trigger="touch")]),
    # 林先生：只在十點
    ev("lin", "林先生", 8, 2, [
        page([
            T("（林先生端著熱美式，看著手機上的行事曆。）"),
            CH(
                OPT("聊兩句。", [T("下雨天，客戶都不想開會。我也不想。", LIN), again]),
                OPT("仔細問他（花掉一個時段）", [
                    T("取貨櫃？我沒注意。我十一點十分結帳，拿了發票就走了。你看。", LIN),
                    T("（他把發票遞過來。23:12，熱美式一杯。）"),
                    ITEM("note_receipt"), SW("k_lin"), ASK_COST,
                ], s("k_lin", False)),
                OPT("（已經問過了）", [T("（發票在筆記裡：23:12。）")], s("k_lin")),
            ),
        ], graphic="char_modern_man", cond={"custom": PERIOD(0)}),
        page([], cond={"variable": {"id": "period", "min": 1}}),
    ]),
    # 阿凱：十點、十一點都在
    ev("kai", "阿凱", 7, 7, [
        page([
            T("滷味還沒好喔？我已經等二十分鐘了欸。", KAI),
            CH(
                OPT("聊兩句。", [T("下雨天單特別多，可是店家都做特別慢。你說這公平嗎？", KAI), again]),
                OPT("仔細問他（花掉一個時段）", [
                    T("你說取貨櫃？喔，十一點的時候，那個戴耳機的女生走到那邊，一直盯著一個包裹看。", KAI),
                    T("你那時候在後面補貨吧。我還想說她要取件，結果又走回去了。", KAI),
                    ITEM("note_kai"), SW("k_kai"), ASK_COST,
                ], s("k_kai", False)),
                OPT("（已經問過了）", [T("（阿凱的證詞在筆記裡：十一點，她盯著取貨櫃上的包裹。）")], s("k_kai")),
            ),
        ], graphic="char_modern_worker"),
    ]),
    # 芷妤：說謊的人。拿出證詞或水痕對質
    ev("yu", "芷妤", 3, 7, [
        page([
            T("（芷妤坐在靠窗的位子，戴著耳機寫作業。窗台上放著一杯喝了一半的奶茶。）"),
            CH(
                OPT("聊兩句。", [T("……我在寫作業。", YU), again]),
                OPT("仔細問她（花掉一個時段）", [
                    T("我一直坐在這裡。戴著耳機，什麼都沒聽到。我沒離開過座位。", YU),
                    ITEM("note_yu"), SW("k_yu"), ASK_COST,
                ], s("k_yu", False)),
                OPT("妳說謊。", [
                    T("……證據呢？", YU),
                    {"code": "present", "options": [
                        {"itemId": "note_kai", "commands": [T("阿凱看到妳十一點走到取貨櫃，一直盯著寄給店長的那個包裹。", ZHOU), SW("solved")]},
                        {"itemId": "note_ring", "commands": [T("十一點，取貨櫃旁邊有一圈水痕。跟妳那杯奶茶的杯底一樣大。", ZHOU), SW("solved")]},
                    ], "otherwise": [T("……那又怎樣？那跟我有什麼關係。", YU), T("（芷妤把耳機戴回去。拿錯東西了。）")],
                     "cancel": [T("沒證據就別亂說。", YU)]},
                    IF(s("solved"), [
                        T("（芷妤拿下耳機，沉默了很久。）"),
                        T("……那個包裹是我寄的。寄件人寫我媽的名字。", YU),
                        T("店長是我爸。我只見過他的照片。裡面是一封信，還有我小時候的照片。我想知道，他收到「她」寄的東西，會不會來找我們。", YU),
                        T("寄出去我就後悔了。可是取件要證件，我領不出來。所以只好趁你去後面補貨的時候……", YU),
                        QUEST("q_letter", "complete"),
                        CH(
                            OPT("包裹還給妳。妳自己交給他。", [
                                T("……我自己交給他？", YU),
                                T("嗯。用妳自己的名字。", ZHOU),
                                {"code": "ending", "endingId": "end_hand"},
                            ]),
                            OPT("放回取貨櫃。讓店長自己決定。", [
                                T("……好。（她把包裹放回取貨櫃，手在發抖。）", YU),
                                {"code": "ending", "endingId": "end_back"},
                            ]),
                        ),
                    ]),
                ]),
            ),
        ], graphic="char_modern_girl"),
    ]),
]
evops = [{"op": "event.upsert", "mapId": MAP, "event": e} for e in events]

for i, b in enumerate([db, mapops, evops], 1):
    with open(os.path.join(OUT, f"proto-{i}.json"), "w") as f:
        json.dump(b, f, ensure_ascii=False, indent=1)
    print(f"proto-{i}.json：{len(b)} 筆")
