"""《最後一個會哭的人》第 1 章：產生 Studio 操作（ops），分批寫成 JSON。"""
import json, os

OUT = os.path.dirname(os.path.abspath(__file__))

# ---------- 小工具 ----------
def T(text, actor=None, speaker=None):
    c = {"code": "text", "text": text}
    if actor: c["actorId"] = actor
    if speaker: c["speaker"] = speaker
    return c
def SW(*ids, on=True): return {"code": "switch", "ids": list(ids), "value": on}
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
def CH(*opts): return {"code": "choices", "options": [o for o in opts]}
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

def page(cmds, trigger="action", priority="same", graphic=None, cond=None):
    p = {"trigger": trigger, "priority": priority, "commands": cmds}
    if graphic: p["graphic"] = {"assetId": graphic}
    if cond: p["conditions"] = cond
    return p
def ev(id, name, x, y, pages, note=None):
    e = {"id": id, "name": name, "x": x, "y": y, "pages": pages}
    if note: e["note"] = note
    return e
def door(id, name, x, y, to, tx, ty, d="down"):
    return ev(id, name, x, y, [page([GO(to, tx, ty, d)], trigger="touch", priority="same")])
def look(id, name, x, y, lines, graphic=None, priority="same"):
    return ev(id, name, x, y, [page([T(l) for l in lines], graphic=graphic, priority=priority)])

# 第一條線索之後：線索數到 2 時，任務日誌提示可以去福壽堂
CLUE = lambda: [VAR("clues"), IF(v("clues", ">=", 2), [QUEST("q_itsuki", "step", 1)])]

HARUO, MIYUKI, FUKUDA, MIKAN, UME, IWA, SHO, FISH, SUOU = "player", "miyuki", "fukuda", "mikan", "ume", "iwa", "sho", "fish", "suou"

# ---------- 地圖 ----------
maps = {
    "shotengai": ("潮見町商店街", "peaceful", [
        "bbbbbbbbbbbbbbbbbbbbbbbbbb",
        "bwwdwbbwdwwbbwwwwbbwwdwwwb",
        "baaaaaaaaaaaaaaaaaaaaaaaab",
        "bavaaaanaaaamaaaaanaaaaatb",
        "baaaaaaaaaaaaaaaaaaaaaaaab",
        "brrrrrrrrrrrrrrrrrrrrrrrrf",
        "bllllllllllllllllllllllllf",
        "brrrrrrrrrrrrrrrrrrrrrrrrf",
        "baaaaaaaaaaaaaaaaaaaaaaaab",
        "bakaaaakaaaaaaaakaaaakaaab",
        "baaaaaaaaaaaaaaaaaaaaaaaab",
        "bbbbbbbbbbbdbbbbbbbbbbbbbb",
    ]),
    "kasaya": ("雨宮傘店", "melancholy", [
        "bbbbbbbbbb",
        "byyoooopyb",
        "boooooooob",
        "bojjoooohb",
        "boooooooob",
        "boooooooob",
        "bbbbdbbbbb",
    ]),
    "dagashi": ("駄菓子屋", "peaceful", [
        "bbbbbbbbbb",
        "byyyyyyyyb",
        "boooooooob",
        "boooooooob",
        "bpoooooopb",
        "boooooooob",
        "bbbbdbbbbb",
    ]),
    "school_roof": ("學校屋頂", "melancholy", [
        "ffffffffffff",
        "faaaaaaaaaaf",
        "faanaaaaaaaf",
        "faaaaaaaaaaf",
        "faaaaaaataaf",
        "faaaaaaaaaaf",
        "faaaaaaaaaaf",
        "fffffdffffff",
    ]),
    "hill": ("燈塔山丘", "melancholy", [
        "TTTTTTTTTTTTTTTTTTTT",
        "T....RRR.......PP..T",
        "T....HDH.......P...T",
        "T.....=...........*T",
        "T.....=.......X....T",
        "T.....=============T",
        "T=====.............T",
        "T........*....B....T",
        "T..................T",
        "T....B.......*.....T",
        "T..................T",
        "TTTTTTTTTTTTTTTTTTTT",
    ]),
    "keeper_hut": ("看守人小屋", "melancholy", [
        "bbbbbbbbb",
        "byyooooyb",
        "boooooojb",
        "booooooob",
        "booooooob",
        "bpoooooob",
        "bbbbdbbbb",
    ]),
    "funeral_hall": ("福壽堂　告別式會場", "melancholy", [
        "bbbbbbbbbbbbbb",
        "bpoooojjoooopb",
        "boooooooooooob",
        "bohhhhcchhhhob",
        "boooooccooooob",
        "bohhhhcchhhhob",
        "boooooccooooob",
        "boooooccooooob",
        "boooooccooooob",
        "bbbbbbdbbbbbbb",
    ]),
}

db = []
db.append({"op": "project.update",
    "title": "最後一個會哭的人",
    "genre": "modern",
    "description": "十年前的一個梅雨夜，全世界的人同時失去了流淚的能力，只有潮見町修傘的雨宮晴生還會哭，而且動不動就哭。一位母親請他在兒子的告別式上替她哭一次，可是他根本不認識那個孩子。",
    "intro": "十年前的一個梅雨夜，全世界的人同時失去了流淚的能力。悲傷沒有完全消失，只是變得很遠、很鈍，像隔著一層毛玻璃。\n\n大家照常生活，甚至過得更順。政府把那一夜稱為「晴天日」，每年六月放一天假。\n\n只有一個人，還會哭。",
    "cover": {"mapId": "shotengai", "characterAssetIds": ["char_modern_worker", "char_modern_woman"], "tagline": "替不認識的人，哭一次。"},
    "release": {"status": "ongoing", "plannedChapters": 4},
})
actors = [
    (HARUO, "雨宮晴生", "char_modern_worker", {"pitch": "mid", "speed": "slow", "timbre": "soft"}, "35 歲，商店街「雨宮傘店」的修傘師傅。全世界唯一還會哭的人，動不動就哭，自己也說不出在難過什麼。想要被當成普通人。客氣、句子短，常常話說到一半就停下來擦眼淚。秘密：十年前妻子小夜過世那一夜的後半段，他記不清楚。"),
    (MIYUKI, "森下美雪", "char_modern_woman", {"pitch": "mid", "speed": "normal", "timbre": "soft"}, "阿樹的母親。很有禮貌，語氣平到有點可怕。想在兒子的告別式上哭出來，證明自己愛他。秘密（第 2 章）：阿樹出事那天，她在電話裡罵了他。不知道鯨魚還活著。"),
    (FUKUDA, "福田社長", "char_modern_man", {"pitch": "low", "speed": "fast", "timbre": "bright"}, "葬儀社「福壽堂」社長福田壽三郎。生意人口吻，滿口數字與業績。想高薪聘晴生當專業哭喪人。秘密（第 2 章）：十年前女兒過世，那場告別式是他辦的第一場。"),
    (MIKAN, "美柑", "char_modern_girl", {"pitch": "high", "speed": "fast", "timbre": "bright"}, "16 歲高中生，偷偷把晴生擦過眼淚的面紙泡成「淚水」賣給有錢人。熱情的店員腔，「本店」「集點」「限量」。秘密（第 2 章）：存錢是為了去東京找離家的母親。"),
    (UME, "阿梅婆婆", "char_modern_elder", {"pitch": "mid", "speed": "slow", "timbre": "soft"}, "駄菓子屋的老闆娘。慢、溫柔，愛叫人「孩子」。知道阿樹每天來買醋昆布的真正原因：她的聲音像阿樹過世的外婆。"),
    (IWA, "老岩", "char_villager", {"pitch": "low", "speed": "slow", "timbre": "buzzy"}, "燈塔看守人。粗聲，一句話不超過十個字。阿樹每週寫信問他「燈塔會不會寂寞」，他一封都沒回，因為不知道怎麼回答，但每一封都留著。"),
    (SHO, "小翔", "char_modern_boy", {"pitch": "high", "speed": "normal", "timbre": "soft"}, "阿樹的同學。支支吾吾，常說「呃、那個」。看到屋頂的水桶曬得發燙，偷偷把金魚「鯨魚」帶回家。知道阿樹是去港口找鯨魚才出事的，一直不敢說。"),
    (FISH, "魚店大叔", "char_bald_villager", {"pitch": "low", "speed": "fast", "timbre": "buzzy"}, "商店街魚店的老闆，大嗓門，每天幫晴生的眼淚打分數，像在叫賣。"),
    (SUOU, "周防博士", "char_long_hair", {"pitch": "mid", "speed": "normal", "timbre": "bright"}, "國立情緒研究所的研究員。用溫度計量別人的難過。正在研究「悲傷去了哪裡」，懷疑答案就是晴生（第 3 章揭露）。"),
]
for id, name, sprite, voice, profile in actors:
    db.append({"op": "actor.upsert", "actor": {"id": id, "name": name, "spriteAssetId": sprite, "voice": voice, "profile": profile}})
db += [
    {"op": "item.upsert", "item": {"id": "photo", "name": "阿樹的照片", "description": "森下美雪給的照片。十二歲的阿樹缺了一顆門牙，笑得很用力。", "iconAssetId": "icon_letter"}},
    {"op": "item.upsert", "item": {"id": "konbu", "name": "醋昆布", "description": "駄菓子屋一根十圓的醋昆布。阿樹每天放學都買一根。", "iconAssetId": "icon_plant"}},
    {"op": "item.upsert", "item": {"id": "letters", "name": "寫給燈塔的信", "description": "阿樹每週寄給燈塔看守人的信，一共十一封。每一封都問同一件事：燈塔會不會寂寞？", "iconAssetId": "icon_letter"}},
    {"op": "quest.upsert", "quest": {"id": "q_itsuki", "title": "認識阿樹", "description": "森下美雪請晴生在告別式上替她的兒子阿樹哭一次。可是晴生不認識阿樹。", "steps": [
        {"text": "在鎮上打聽阿樹的事：駄菓子屋、學校屋頂（商店街南邊的校門）、燈塔山丘（商店街往東）"},
        {"text": "認識阿樹一點了。準備好了，就到商店街東邊的福壽堂找福田社長"},
        {"text": "在阿樹的告別式上，說出他的故事"},
    ]}},
    {"op": "ending.upsert", "ending": {"id": "end_ch1", "title": "第一章　替人哭的人", "mood": "somber", "nextChapterId": "ch2",
        "text": "告別式結束了。商店街的雨還在下。\n晴生撐著自己修好的傘走回店裡，一路上沒有掉一滴眼淚。這是十年來第一次。\n周防博士的那句話，一直在他耳邊轉：那位母親的眼淚，不是你的吧？",
        "epilogues": [
            {"condition": s("accepted_gladly"), "text": "那天在傘店，他說了「我盡力」。他後來才知道，盡力的不是他，是那些願意把阿樹的事說給他聽的人。"},
            {"condition": s("accepted_gladly", False), "text": "那天在傘店，他說他沒辦法替不認識的人哭。他說對了。他沒有哭，是那位母親自己哭了。"},
            {"condition": s("promise_sho"), "text": "他守住了和小翔的約定。屋頂上那條叫「鯨魚」的金魚，還養在小翔家的臉盆裡。"},
            {"condition": s("miyuki_knows_whale"), "text": "美雪知道了鯨魚還活著。她說，等盂蘭盆節，想去看看那條金魚。"},
            {"condition": s("miyuki_cried"), "text": "那天晚上，美雪在電話裡跟晴生說：她哭了一整晚。她說，十年來第一次覺得，自己是阿樹的媽媽。"},
            {"condition": s("sold_tissue"), "text": "美柑的網拍上，多了一款新商品：「限量・告別式當天的淚水」。"},
            {"condition": s("refused_mikan"), "text": "美柑在傘店門口貼了一張紙條：「本店不會放棄的！」"},
        ]}},
    {"op": "ending.remove", "id": "end_placeholder"},
    {"op": "chapter.upsert", "chapter": {"id": "ch1", "title": "第一章　替人哭的人", "summary": "一位母親請他在兒子的告別式上哭一次。", "testStart": {"mapId": "kasaya", "x": 4, "y": 4}}},
]
for name, sid in [("接受委託時說了「我盡力」", "accepted_gladly"), ("知道阿樹買醋昆布的真正原因", "clue_konbu"), ("知道鯨魚還活著", "clue_whale"), ("拿到寫給燈塔的信", "clue_letters"),
                  ("看過屋頂的空水桶", "saw_bucket"), ("答應小翔保密", "promise_sho"), ("把面紙賣給美柑", "sold_tissue"), ("拒絕美柑", "refused_mikan"), ("魚店大叔打了一百分", "fish_100"),
                  ("告別式準備好了", "funeral_ready"), ("告別式結束", "funeral_done"), ("告別式上說了醋昆布", "told_konbu"), ("告別式上說了鯨魚", "told_whale"), ("告別式上說了信", "told_letters"), ("美雪知道鯨魚還活著", "miyuki_knows_whale"), ("美雪在告別式上哭了", "miyuki_cried"), ("告別式上選了「就這些了」", "tell_done"), ("陪阿梅婆婆坐了一下", "sat_with_ume")]:
    db.append({"op": "switch.upsert", "switch": {"id": sid, "name": name}})
db.append({"op": "variable.upsert", "variable": {"id": "clues", "name": "蒐集到的阿樹的小事"}})
db.append({"op": "variable.upsert", "variable": {"id": "told", "name": "告別式上說了幾件事"}})

mapops = []
for mid, (name, music, rows) in maps.items():
    mapops.append({"op": "map.add", "id": mid, "name": name, "width": len(rows[0]), "height": len(rows), "music": music})
    mapops.append({"op": "map.terrain", "mapId": mid, "rows": rows})
mapops.append({"op": "system.update", "start": {"mapId": "kasaya", "x": 4, "y": 4, "direction": "up"}, "playerActorId": HARUO})
mapops.append({"op": "map.remove", "id": "start"})

# ---------- 事件 ----------
E = {m: [] for m in maps}

# 傘店：開場
E["kasaya"] += [
    ev("opening", "森下美雪", 4, 2, [
        page([
            {"code": "chapter", "chapterId": "ch1"},
            T("（收音機：「……明天的潮見町，上午多雲，午後有雷陣雨。出門記得帶傘。」）"),
            T("……"),
            T("（晴生修到一半的傘骨，被一滴水打溼了。他抬手摸了一下臉。）"),
            T("又來了。我到底在難過什麼……", HARUO),
            T("今天七十分！哭得有氣無力啊，修傘的！", speaker="門外的大嗓門"),
            T("（門鈴響了。一位穿著深色套裝的女人收起傘，站在門口，很有禮貌地鞠了一個躬。）"),
            T("（收音機又重播了一次天氣預報。女人看了收音機一眼，很快地轉開視線。）"),
            T("……這段天氣預報，我最近都不敢聽。失禮了。您就是雨宮先生吧，我姓森下。一週後，是我兒子的告別式。", MIYUKI),
            T("（她把一個厚厚的信封放在櫃檯上。）這是我全部的存款。請您在告別式上，替他哭一次。", MIYUKI),
            T("我不哭的話，大家會覺得那孩子……好像白活了。我自己哭不出來。這十年，誰都哭不出來。", MIYUKI),
            CH(
                OPT("……我盡力。", [SW("accepted_gladly"), T("……我會盡力。只是，我其實不太會控制眼淚。", HARUO), T("謝謝您。真的，謝謝。", MIYUKI)]),
                OPT("我沒辦法替不認識的人哭。", [T("對不起。我會哭，但我沒辦法對著不認識的人哭。那樣……好像在騙他。", HARUO), T("……我明白。", MIYUKI), T("（她沒有把信封收回去。）", )]),
            ),
            T("那至少，認識他一下好嗎？他叫阿樹，森下樹，十二歲。三個月前在港口……溺水了。", MIYUKI),
            ITEM("photo"),
            T("（美雪留下一張照片。照片裡的男孩缺了一顆門牙，笑得很用力。）"),
            T("……阿樹。好。那我先認識他。他每天去哪裡、喜歡什麼，我去鎮上問問看。", HARUO),
            T("他放學常去駄菓子屋，也常常一個人上學校的屋頂。對了，他每個禮拜都寫信給燈塔的看守人。我不知道他寫了什麼。", MIYUKI),
            QUEST("q_itsuki", "start"),
            T("（美雪鞠了一個躬，撐著傘走進雨裡。）"),
            SELF("A"),
        ], trigger="autorun", graphic="char_modern_woman"),
        page([], cond={"selfSwitch": "A"}, priority="below"),
    ], note="開場：美雪的委託"),
    look("radio", "收音機", 7, 1, ["（老舊的收音機。播完天氣預報，正在播一首很慢的歌。）", "（晴生每次聽到天氣預報，眼睛就會發酸。他也不知道為什麼。）"], priority="same"),
    look("broken_umbrella", "修到一半的傘", 2, 3, ["（一把天藍色的折傘，傘骨斷了兩根。傘柄上貼著小小的名牌：小夜。）", "（這是十年前的傘。他一直修，一直沒修好。）"]),
    door("kasaya_door", "店門", 4, 6, "shotengai", 3, 2),
]

# 商店街
E["shotengai"] += [
    door("to_kasaya", "雨宮傘店", 3, 1, "kasaya", 4, 5, "up"),
    door("to_dagashi", "駄菓子屋", 8, 1, "dagashi", 4, 5, "up"),
    door("to_school", "潮見高中・校門", 11, 11, "school_roof", 5, 6, "up"),
    ev("to_hill", "往燈塔山丘", 24, 6, [page([GO("hill", 2, 6, "right")], trigger="touch", priority="below")]),
    ev("funeral_door", "福壽堂", 21, 1, [
        page([T("（福壽堂的大門貼著一張紙：「森下家告別式　準備中」。）"), T("（門口的福田社長，正在看一張密密麻麻的表格。）")]),
        page([GO("funeral_hall", 6, 8, "up")], cond={"switches": ["funeral_ready"]}, trigger="touch"),
    ]),
    ev("fukuda", "福田社長", 20, 2, [
        page([
            T("哎呀，這不是雨宮先生嗎！鎮上唯一會哭的人！", FUKUDA),
            T("您知道嗎？沒有人哭的告別式，家屬的滿意度只有三成。有人哭，可以拉到九成。", FUKUDA),
            T("所以，來我們福壽堂當專業的哭喪人吧！月薪，這個數。（他比了一個手勢。）", FUKUDA),
            T("……我先把森下太太的事做好。", HARUO),
            IF(v("clues", ">=", 1), [
                T("對對對，森下家。告別式隨時可以開始，就等您了。怎麼樣，資料蒐集得如何？", FUKUDA),
                IF(v("clues", "<", 2), [T("只知道一件事啊……這樣夠嗎？要不要再去鎮上問問？", FUKUDA)]),
                CH(
                    OPT("開始吧。", [T("好！業績表準備好了！", FUKUDA), SW("funeral_ready"), QUEST("q_itsuki", "step", 2), GO("funeral_hall", 6, 8, "up")]),
                    OPT("我再去問問。", [T("好好好，慢慢來。不過別太慢喔，下個月的檔期都滿了。", FUKUDA)]),
                ),
            ], [
                T("森下家的告別式，就等您了。不過——您連那孩子喜歡吃什麼都不知道吧？", FUKUDA),
                T("先去鎮上問問。駄菓子屋、學校、燈塔，那孩子常去的地方，我都寫在這張表上了。（他遞過來一張業績表的背面。）", FUKUDA),
            ]),
        ], graphic="char_modern_man"),
        page([T("剛才那場，滿意度……我不知道怎麼填。（福田社長盯著業績表，表格的一角被水滴暈開了。）", FUKUDA)], cond={"switches": ["funeral_done"]}, graphic="char_modern_man"),
    ]),
    ev("fish", "魚店大叔", 14, 2, [
        page([
            T("喲，修傘的！今天的眼淚，七十分！", FISH),
            T("我每天幫你打分數，打了十年了！滿分還沒出現過啊！", FISH),
            T("……那是我又不是故意哭的。", HARUO),
            T("就是不故意才好看嘛！哪天哭出一百分，我送你一尾鯛魚！", FISH),
        ], graphic="char_bald_villager"),
        page([
            T("喲，修傘的！你的臉……怎麼了？", FISH),
            T("……阿梅婆婆說，阿樹每天去買醋昆布，是因為她的聲音很像阿樹的外婆。", HARUO),
            T("（說著說著，晴生的眼淚就掉下來了。這一次，他知道自己在難過什麼。）"),
            T("……", FISH),
            T("一、一百分！！一百分啦！！鯛魚，鯛魚給你！不對，今天的鯛魚賣完了！明天給你！", FISH),
            SW("fish_100"),
            SELF("A"),
        ], cond={"switches": ["clue_konbu"]}, graphic="char_bald_villager"),
        page([T("一百分的眼淚，我這輩子會記得的！鯛魚明天給你！", FISH)], cond={"selfSwitch": "A"}, graphic="char_bald_villager"),
    ]),
    ev("mikan", "美柑", 6, 4, [
        page([
            T("歡迎光臨～！啊，不對，是供應商大人！", MIKAN),
            T("我是美柑，高一。本店專賣「淚水」，喝一口，就能想起悲傷的感覺喔！東京的有錢人超愛的！", MIKAN),
            T("……淚水？", HARUO),
            T("就是您擦過眼淚的面紙，泡一泡、濾一濾、裝瓶！（她拿出一個貼著可愛貼紙的小玻璃瓶。）限量，還有集點卡！", MIKAN),
            T("所以～今天的面紙，可以賣給本店嗎？一包五千圓！", MIKAN),
            CH(
                OPT("……給妳。", [SW("sold_tissue"), T("（晴生把口袋裡的面紙交給她。美柑像捧著寶物一樣收進保鮮盒。）"), T("感謝惠顧！集點卡送您一張！", MIKAN)]),
                OPT("眼淚不是拿來賣的。", [SW("refused_mikan"), T("我的眼淚不是商品。", HARUO), T("……哼。本店不會放棄的！", MIKAN)]),
            ),
            SELF("A"),
        ], graphic="char_modern_girl"),
        page([
            IF(s("sold_tissue"), [
                T("供應商大人！上次那包面紙，已經做成三瓶「梅雨限定款」了！", MIKAN),
                T("集點卡集滿十點，可以換一瓶「晴生先生打噴嚏時的淚水」喔。……騙你的，那個還在研發。", MIKAN),
            ], [
                T("本店不會放棄的！我已經在研究，從傘店門口的雨水裡過濾您的眼淚了！", MIKAN),
                T("……那只是雨水。", HARUO),
                T("限量版的雨水！", MIKAN),
            ]),
        ], cond={"selfSwitch": "A"}, graphic="char_modern_girl"),
    ]),
    look("vending", "自動販賣機", 2, 3, ["（自動販賣機最上排是一排「晴天日紀念罐」。十年了，還在賣。）"]),
    look("postbox", "郵筒", 12, 3, ["（紅色的郵筒。阿樹的信，大概就是從這裡寄出去的。）"]),
    look("bench1", "長椅", 7, 3, ["（長椅上有人留下一份報紙：「晴天日十週年，全國自殺率創新低」。）", "（下面一行小字：「但也沒有人去掃墓了」。）"]),
    look("bench2", "長椅", 18, 3, ["（一位老先生坐在長椅上，看著雨發呆。他說他忘了今天要去哪裡。）"]),
    look("trash", "垃圾桶", 24, 3, ["（垃圾桶裡有一個被丟掉的小玻璃瓶，標籤上寫著「淚水・試用品」。）"]),
]

# 駄菓子屋
E["dagashi"] += [
    door("dagashi_door", "店門", 4, 6, "shotengai", 8, 2),
    ev("ume", "阿梅婆婆", 4, 2, [
        page([
            T("歡迎啊，孩子。要買點什麼嗎？", UME),
            T("我想問問森下樹……阿樹的事。", HARUO),
            T("阿樹啊……那孩子每天放學都來，買一根十圓的醋昆布。三個月了，那個位置一直空著。", UME),
            CH(
                OPT("我也買一根。", [ITEM("konbu"), T("（晴生把十圓放在櫃檯上。阿梅婆婆把醋昆布包進一張舊報紙裡。）"), T("呵呵，跟那孩子一樣，付錢的時候都不看我。", UME)]),
                OPT("他很喜歡醋昆布嗎？", [SW("sat_with_ume"), T("喜歡？呵呵……孩子，你多陪我坐一下，我再告訴你。", UME)]),
            ),
            SELF("A"),
        ], graphic="char_modern_elder"),
        page([
            IF({"type": "any", "conditions": [has("konbu"), s("sat_with_ume")]}, [
                IF(has("konbu"), [T("（晴生咬了一口醋昆布，酸得皺起眉頭。阿梅婆婆笑了。）")], [T("（晴生在店門口的小板凳坐下，陪婆婆聽了一會兒雨。）")]),
                T("那孩子啊，其實不喜歡醋昆布。每次都皺著眉頭吃完。", UME),
                T("他說，他只是想跟我說話。因為我說話的聲音，很像他過世的外婆。", UME),
                T("他每天買一根，就能聽我說一句「路上小心喔」。", UME),
                T("（晴生低頭看著手裡的醋昆布。酸味好像一路酸到眼睛裡。）"),
                SW("clue_konbu"),
                *CLUE(),
                SELF("B"),
            ], [
                T("要不要坐一下？邊吃邊聽，比較好說。", UME),
                CH(
                    OPT("買一根，坐一下。", [ITEM("konbu"), T("（晴生把十圓放在櫃檯上。）"), T("好，孩子，你坐。再跟我說一次話吧。", UME)]),
                    OPT("陪婆婆坐一下。", [SW("sat_with_ume"), T("好，孩子，你坐。再跟我說一次話吧。", UME)]),
                    OPT("下次再來。", [T("好，路上小心喔。", UME)]),
                ),
            ]),
        ], cond={"selfSwitch": "A"}, graphic="char_modern_elder"),
        page([
            T("路上小心喔，孩子。", UME),
            T("（不知道為什麼，這句話讓晴生的腳步慢了一下。）"),
        ], cond={"selfSwitch": "B"}, graphic="char_modern_elder"),
    ]),
    look("shelf", "零食架", 2, 1, ["（一排排十圓、二十圓的零食。最左邊的醋昆布，少了一格的位置被留著。）"]),
    look("shelf2", "零食架", 7, 1, ["（彈珠汽水、仙貝、小抽獎機。抽獎機的大獎，十年來都沒人抽中。）"]),
]

# 學校屋頂
E["school_roof"] += [
    door("roof_door", "樓梯口", 5, 7, "shotengai", 11, 10),
    ev("bucket", "藍色水桶", 8, 3, [
        page([
            T("（一個藍色的水桶，裡面只剩一點水，曬得發燙。）"),
            T("（桶邊用麥克筆寫著：「鯨魚的家」。旁邊畫了一條很胖的魚。）"),
            T("鯨魚……是金魚的名字嗎？", HARUO),
            SW("saw_bucket"),
        ], graphic="icon_can"),
    ]),
    ev("sho", "小翔", 3, 4, [
        page([
            T("呃、那個……你是誰？這裡是學生才能來的……", SHO),
            T("我在打聽阿樹的事。我是商店街修傘的。", HARUO),
            T("……阿樹喔。他、他很喜歡那隻金魚。他說等鯨魚長大，要把牠放回海裡。", SHO),
            T("呃、那個……我要回去了。", SHO),
        ], graphic="char_modern_boy"),
        page([
            T("……你、你看到水桶了喔。", SHO),
            T("鯨魚是不是……不見了？", HARUO),
            T("呃、那個……", SHO),
            T("阿樹不見的三天前，屋頂好熱，水桶的水都燙了。我怕鯨魚死掉，就、就偷偷把牠帶回家了。", SHO),
            T("我想說隔天再跟他講……結果他以為鯨魚被誰放回海裡了。他說要去港口看看牠游得好不好。", SHO),
            T("……然後，他就沒有回來。", SHO),
            T("（小翔的肩膀在抖，可是他的臉是乾的。他不會哭。這個世界的人都不會。）"),
            T("拜、拜託你。不要跟阿樹的媽媽說。她會恨我的……", SHO),
            CH(
                OPT("我不會說。", [SW("promise_sho"), T("……我答應你。", HARUO), T("（小翔用力點了點頭。）鯨魚現在養在我家的臉盆裡。牠很好。", SHO)]),
                OPT("這件事，她有權知道。", [T("對不起，我沒辦法答應。阿樹的媽媽有權知道，他是為了什麼去港口的。", HARUO), T("……", SHO), T("……嗯。如果是你說的話……可能比較好。鯨魚，牠很好。我會好好養牠。", SHO)]),
            ),
            SW("clue_whale"),
            *CLUE(),
            SELF("A"),
        ], cond={"switches": ["saw_bucket"]}, graphic="char_modern_boy"),
        page([
            IF(s("promise_sho"), [T("呃、那個……謝謝你沒說。鯨魚今天吃了好多飼料。", SHO)], [T("呃、那個……你要跟她說的時候，可以跟我說一聲嗎？我想在旁邊。", SHO)]),
        ], cond={"selfSwitch": "A"}, graphic="char_modern_boy"),
    ]),
    look("bench_roof", "長椅", 3, 2, ["（長椅的扶手上，用原子筆刻著很小的字：「鯨魚，等你長大」。）"]),
    look("view", "鐵絲網", 10, 1, ["（從屋頂看得見港口。灰色的海，灰色的天，分不出哪裡是分界。）"], priority="below"),
]

# 燈塔山丘
E["hill"] += [
    ev("to_town", "回商店街", 1, 6, [page([GO("shotengai", 23, 6, "left")], trigger="touch", priority="below")]),
    door("hut_door", "看守人小屋", 6, 2, "keeper_hut", 4, 5, "up"),
    look("sign", "步道告示牌", 14, 4, ["（「往燈塔步道　1.2 公里」。燈塔在海岬的另一頭，從這裡只看得到一點白色的頂。）", "（告示牌底下塞著一張濕掉的紙條，是小孩的字：「燈塔，你好」。）"]),
    look("flowers", "野花", 18, 3, ["（雨把野花打得低低的。有人在花旁邊放了一顆彈珠汽水的彈珠。）"], priority="below"),
]
E["keeper_hut"] += [
    door("hut_exit", "門", 4, 6, "hill", 6, 3),
    ev("iwa", "老岩", 4, 2, [
        page([
            T("……誰。", IWA),
            T("我是商店街修傘的。想問森下樹，阿樹的事。", HARUO),
            IF(ALL(has("photo"), v("clues", ">=", 1)), [
                T("（晴生拿出阿樹的照片。老岩瞇著眼看了很久。）"),
                T("……說說他的事。", IWA),
                CH(
                    OPT("他每天去駄菓子屋買醋昆布，其實是想聽阿梅婆婆說話。", [T("……阿梅的聲音。是很像。", IWA)], s("clue_konbu")),
                    OPT("他在屋頂養了一條金魚，叫「鯨魚」。", [T("……鯨魚。像他會取的名字。", IWA)], s("clue_whale")),
                ),
                T("（老岩沉默了很久。）"),
                T("……等著。", IWA),
                T("（老岩從抽屜裡拿出一疊信，用橡皮筋綁著。十一封。）"),
                T("那孩子寫的。每週一封。", IWA),
                T("每封都問：燈塔會不會寂寞。", IWA),
                T("我一封都沒回。……不知道怎麼回。", IWA),
                T("拿去。給他媽媽。", IWA),
                ITEM("letters"),
                SW("clue_letters"),
                *CLUE(),
            ], [
                T("那孩子的事，問別人去。", IWA),
                T("（老岩轉過身去。也許要先在鎮上問問，阿樹是怎樣的孩子，再來找他。）"),
            ]),
        ], graphic="char_villager"),
        page([
            T("……燈塔會不會寂寞。", IWA),
            T("我看了四十年燈塔。到現在，還是不知道。", IWA),
        ], cond={"switches": ["clue_letters"]}, graphic="char_villager"),
    ]),
    look("logbook", "值班日誌", 7, 2, ["（燈塔的值班日誌。每一頁的最後一行，都寫著同一句：「今日無事」。）"]),
    look("hut_shelf", "櫃子", 2, 1, ["（櫃子上擺著一個燈塔的模型，做得很細。燈罩的地方，被摸得特別亮。）"]),
]

# 福壽堂：招牌場景
told_konbu = [SW("told_konbu"), VAR("told"),
    T("阿樹每天放學，會在駄菓子屋買一根十圓的醋昆布。", HARUO),
    T("他其實不喜歡醋昆布。他只是想跟阿梅婆婆說話，因為婆婆說話的聲音，很像他過世的外婆。", HARUO),
    T("（台下有人抬起頭。第一排的阿梅婆婆，用手帕按住了嘴。）")]
told_whale = [SW("told_whale"), VAR("told"),
    T("他在學校屋頂養了一條金魚，名字叫「鯨魚」。他說，等鯨魚長大，就要把牠放回海裡。", HARUO),
    T("他溺水的那天，是去港口找鯨魚。他以為有人把鯨魚放回海裡了，他想去看牠游得好不好。", HARUO),
    IF(s("promise_sho"), [
        T("（晴生看見最後一排的小翔。他想說「鯨魚還活著」，可是他答應過了。他把那句話吞了回去。）"),
    ], [
        T("……鯨魚還活著。小翔把牠帶回家了，牠很好。阿樹找的那條魚，現在好好地游著。", HARUO),
        T("（最後一排的小翔站了起來，又坐下。第一排的美雪轉過頭，看了他很久。）"),
        SW("miyuki_knows_whale"),
    ])]
told_letters = [SW("told_letters"), VAR("told"),
    T("他每個禮拜寫一封信給燈塔的看守人，問燈塔會不會寂寞。", HARUO),
    T("看守人一封都沒有回，因為他不知道怎麼回答。但是每一封，他都留著。一共十一封。", HARUO),
    T("（晴生把那疊信放在遺照前。）")]
E["funeral_hall"] += [
    ev("funeral", "阿樹的告別式", 6, 1, [
        page([
            T("（福壽堂的會場很安靜。三十張折疊椅坐了一半，沒有人哭，有人在偷看手機。）"),
            T("（福田社長站在角落，手上拿著業績表，對晴生比了一個「開始」的手勢。）"),
            T("（晴生走到遺照前。照片裡的阿樹缺了一顆門牙，笑得很用力。）"),
            T("……"),
            T("（他站了很久。眼淚沒有來。）"),
            T("（台下開始竊竊私語。第一排的森下美雪，雙手放在膝蓋上，一動也不動。）"),
            T("……我不認識阿樹。所以這一週，我去問了他的事。", HARUO),
            LABEL("tell"),
            CH(
                OPT("說醋昆布的事", told_konbu, ALL(s("clue_konbu"), s("told_konbu", False))),
                OPT("說鯨魚的事", told_whale, ALL(s("clue_whale"), s("told_whale", False))),
                OPT("說寫給燈塔的信", told_letters, ALL(s("clue_letters"), s("told_letters", False))),
                OPT("……就這些了。", [SW("tell_done")]),
            ),
            # 還沒選「就這些了」，而且還有知道但沒說的事，才回到選單（不會困住玩家）
            IF(ALL(s("tell_done", False), {"type": "any", "conditions": [ALL(s("clue_konbu"), s("told_konbu", False)), ALL(s("clue_whale"), s("told_whale", False)), ALL(s("clue_letters"), s("told_letters", False))]}), [JUMP("tell")]),
            IF(v("told", ">=", 2), [
                T("（晴生說完了。他沒有哭。）"),
                T("（第一排傳來一個很小的聲音，像是有東西碎掉了。）"),
                T("（森下美雪的肩膀在抖。她用手摀住嘴，眼淚一顆一顆掉在膝蓋上。她自己好像也嚇了一跳，低頭看著手背上的水，看了很久。）"),
                T("……原來，是這種感覺。", MIYUKI),
                SW("miyuki_cried"),
                T("（會場裡沒有人說話。福田社長的業績表，掉在地上。）"),
            ], [IF(v("told", "==", 1), [
                T("（晴生說完了。他沒有哭。）"),
                T("（森下美雪的眼眶紅了，可是眼淚沒有掉下來。她深深地吸了一口氣。）"),
                T("……謝謝您。那孩子的事，我好像多知道了一件。", MIYUKI),
            ], [
                T("……"),
                T("……對不起。", HARUO),
                T("（晴生只說得出這一句。台下有人的手機螢幕亮了一下。）"),
                T("（福田社長在業績表上，寫下一個 0。）"),
                T("（森下美雪站起來，向晴生鞠了一個躬，什麼都沒有說。）"),
            ])]),
            IF(v("told", ">=", 1), [T("（晴生覺得胸口某個地方，輕了一點。好像有什麼東西，回到了它原本的主人那裡。）")], [T("（晴生的胸口，還是一樣重。）")]),
            WAIT(600),
            QUEST("q_itsuki", "complete"),
            SW("funeral_done"),
            SELF("A"),
            GO("shotengai", 21, 2, "down"),
        ], trigger="autorun", priority="below", graphic="icon_candle"),
        page([], cond={"selfSwitch": "A"}, priority="below"),
    ], note="招牌場景：阿樹的告別式"),
    door("hall_door", "出口", 6, 9, "shotengai", 21, 2),
]

# 章末：周防博士
E["shotengai"].append(ev("suou", "周防博士", 22, 3, [
    page([
        T("（走出福壽堂，雨還在下。門口站著一個撐黑傘的女人，正在看一支溫度計。）"),
        T("雨宮晴生先生？我是國立情緒研究所的周防。", SUOU),
        T("剛剛那場告別式，我在後面看了。", SUOU),
        T("……那位母親的眼淚——不是你的吧？", SUOU),
        T("……什麼意思？", HARUO),
        T("下次再說。我會在鎮上待一陣子。（她把溫度計收進口袋，走進雨裡。）", SUOU),
        {"code": "ending", "endingId": "end_ch1"},
    ], trigger="autorun", priority="same", graphic="char_long_hair", cond={"switches": ["funeral_done"]}),
]))

# 成就
achv = [
    {"id": "achv_all", "title": "阿樹的全部", "description": "在告別式上，把三件小事都說了出來。", "hint": "在告別式上，你還可以說更多", "condition": v("told", ">=", 3)},
    {"id": "achv_whale", "title": "鯨魚還活著", "description": "知道了屋頂水桶空掉的原因。", "hint": "屋頂上的水桶，為什麼空了？", "condition": s("clue_whale")},
    {"id": "achv_notforsale", "title": "眼淚不是商品", "description": "拒絕了美柑的收購。", "hint": "有人想買你擦過眼淚的面紙", "condition": s("refused_mikan")},
    {"id": "achv_100", "title": "滿分的眼淚", "description": "讓魚店大叔打出了一百分。", "hint": "魚店大叔今天會打幾分？知道一件難過的事之後再去看看", "condition": s("fish_100")},
]
db += [{"op": "achievement.upsert", "achievement": a} for a in achv]

evops = []
for m, evs in E.items():
    for e in evs:
        evops.append({"op": "event.upsert", "mapId": m, "event": e})

batches = [db, mapops, evops]
for i, b in enumerate(batches, 1):
    with open(os.path.join(OUT, f"ch1-{i}.json"), "w") as f:
        json.dump(b, f, ensure_ascii=False, indent=1)
    print(f"ch1-{i}.json：{len(b)} 筆")
