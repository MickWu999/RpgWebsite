/**
 * 內建素材庫（素材映射系統）。
 *
 * 原則：故事決定世界裡發生什麼事，素材庫決定世界看起來是什麼樣子。
 * - 遊戲資料只引用 assetId，不直接引用素材來源網址；更換素材包時只需要改這裡。
 * - AI 只能從這份目錄「挑選」素材 ID（依 tags 判斷用途），不得自行虛構素材或授權。
 * - 每一份素材包都記錄來源、作者、授權條款、可否商用／署名／修改／再散布與下載日期。
 */

export type LicenseRecord = {
  packId: string;
  packName: string;
  sourceUrl: string;
  author: string;
  license: string;
  licenseUrl: string;
  commercialUse: boolean;
  attributionRequired: boolean;
  modificationAllowed: boolean;
  /** 是否允許隨「使用者生成的遊戲」一起散布（平台情境） */
  redistributionWithGeneratedWorks: boolean;
  attributionText: string;
  downloadedAt: string;
  localLicenseFile: string;
};

export const LICENSES: Record<string, LicenseRecord> = {
  "kenney-tiny-town": {
    packId: "kenney-tiny-town",
    packName: "Tiny Town 1.1",
    sourceUrl: "https://kenney.nl/assets/tiny-town",
    author: "Kenney (www.kenney.nl)",
    license: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercialUse: true,
    attributionRequired: false,
    modificationAllowed: true,
    redistributionWithGeneratedWorks: true,
    attributionText: "Tiny Town by Kenney (www.kenney.nl), CC0",
    downloadedAt: "2026-10-20",
    localLicenseFile: "/assets/kenney/tiny-town/License.txt",
  },
  "kenney-tiny-dungeon": {
    packId: "kenney-tiny-dungeon",
    packName: "Tiny Dungeon 1.0",
    sourceUrl: "https://kenney.nl/assets/tiny-dungeon",
    author: "Kenney (www.kenney.nl)",
    license: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercialUse: true,
    attributionRequired: false,
    modificationAllowed: true,
    redistributionWithGeneratedWorks: true,
    attributionText: "Tiny Dungeon by Kenney (www.kenney.nl), CC0",
    downloadedAt: "2026-10-20",
    localLicenseFile: "/assets/kenney/tiny-dungeon/License.txt",
  },
  "kenney-rpg-audio": {
    packId: "kenney-rpg-audio",
    packName: "RPG Audio",
    sourceUrl: "https://kenney.nl/assets/rpg-audio",
    author: "Kenney Vleugels (www.kenney.nl)",
    license: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercialUse: true,
    attributionRequired: false,
    modificationAllowed: true,
    redistributionWithGeneratedWorks: true,
    attributionText: "RPG Audio by Kenney (www.kenney.nl), CC0",
    downloadedAt: "2026-10-20",
    localLicenseFile: "/assets/kenney/audio/rpg-audio/License.txt",
  },
  "kenney-interface-sounds": {
    packId: "kenney-interface-sounds",
    packName: "Interface Sounds 1.0",
    sourceUrl: "https://kenney.nl/assets/interface-sounds",
    author: "Kenney (www.kenney.nl)",
    license: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercialUse: true,
    attributionRequired: false,
    modificationAllowed: true,
    redistributionWithGeneratedWorks: true,
    attributionText: "Interface Sounds by Kenney (www.kenney.nl), CC0",
    downloadedAt: "2026-10-20",
    localLicenseFile: "/assets/kenney/audio/interface-sounds/License.txt",
  },
  "junkala-jrpg-music": {
    packId: "junkala-jrpg-music",
    packName: "JRPG Music Pack #1～#4（Exploration／Towns／Evil／Calm）",
    sourceUrl: "https://opengameart.org/content/jrpg-pack-2-towns",
    author: "Juhani Junkala (SubspaceAudio)",
    license: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercialUse: true,
    attributionRequired: false,
    modificationAllowed: true,
    redistributionWithGeneratedWorks: true,
    attributionText: "Music by Juhani Junkala (SubspaceAudio), CC0",
    downloadedAt: "2026-10-20",
    localLicenseFile: "/assets/music/jrpg-junkala/INFO.txt",
  },
  "kenney-music-jingles": {
    packId: "kenney-music-jingles",
    packName: "Music Jingles",
    sourceUrl: "https://kenney.nl/assets/music-jingles",
    author: "Kenney Vleugels (www.kenney.nl)",
    license: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercialUse: true,
    attributionRequired: false,
    modificationAllowed: true,
    redistributionWithGeneratedWorks: true,
    attributionText: "Music Jingles by Kenney (www.kenney.nl), CC0",
    downloadedAt: "2026-10-20",
    localLicenseFile: "/assets/kenney/audio/music-jingles/License.txt",
  },
};

export const TOWN_SHEET = "/assets/kenney/tiny-town/tilemap_packed.png";
export const DUNGEON_SHEET = "/assets/kenney/tiny-dungeon/tilemap_packed.png";
export const SHEET_FRAME_SIZE = 16;

/** 地形字元 → 圖塊。`overlay` 的圖塊有透明背景，會疊在草地上繪製。 */
/** examine：面對該地形按確認、而且沒有特別設計的調查點時，顯示的預設回應（減少「按了沒反應」的迷失感） */
export type TerrainDef = { name: string; frame: number; walkable: boolean; overlay?: boolean; examine?: string };

export const TERRAIN: Record<string, TerrainDef> = {
  ".": { name: "草地", frame: 0, walkable: true },
  ",": { name: "雜草地", frame: 1, walkable: true },
  "*": { name: "花叢", frame: 2, walkable: true },
  "=": { name: "泥土路", frame: 25, walkable: true },
  C: { name: "石板廣場", frame: 43, walkable: true },
  M: { name: "蘑菇", frame: 29, walkable: true, overlay: true },
  T: { name: "闊葉樹", frame: 16, walkable: false, overlay: true, examine: "茂密的樹木擋住了去路。" },
  P: { name: "針葉樹", frame: 28, walkable: false, overlay: true, examine: "高大的針葉樹，樹皮上結著霜。" },
  Y: { name: "秋天的樹", frame: 15, walkable: false, overlay: true, examine: "葉子轉紅的樹，風一吹就沙沙作響。" },
  B: { name: "灌木", frame: 5, walkable: false, overlay: true, examine: "一叢灌木，枝葉很密，過不去。" },
  F: { name: "木圍籬", frame: 81, walkable: false, overlay: true, examine: "木頭圍籬，看起來有人細心照顧。" },
  R: { name: "紅屋頂", frame: 53, walkable: false, examine: "紅色的屋頂。" },
  G: { name: "灰屋頂", frame: 49, walkable: false, examine: "灰色的屋頂，石板上長了青苔。" },
  H: { name: "木屋牆", frame: 72, walkable: false, examine: "木造的牆壁。" },
  D: { name: "木門", frame: 85, walkable: false, examine: "門關著，裡面靜悄悄的。" },
  S: { name: "石牆", frame: 76, walkable: false, examine: "堅固的石牆。" },
  W: { name: "水井", frame: 104, walkable: false, overlay: true, examine: "一口古井，井水清澈見底。" },
  X: { name: "告示牌", frame: 83, walkable: false, overlay: true, examine: "告示牌上的字被風雨磨得模糊不清。" },
};

export const TERRAIN_BASE_FRAME = 0;

export type CatalogAsset = {
  id: string;
  kind: "tileset" | "character" | "icon";
  name: string;
  tags: string[];
  src: string;
  frame?: number;
  frameSize?: number;
  packId: keyof typeof LICENSES;
};

const character = (id: string, frame: number, name: string, tags: string[]): CatalogAsset => ({
  id,
  kind: "character",
  name,
  tags,
  src: DUNGEON_SHEET,
  frame,
  frameSize: SHEET_FRAME_SIZE,
  packId: "kenney-tiny-dungeon",
});

const icon = (id: string, src: string, frame: number, name: string, tags: string[], packId: CatalogAsset["packId"]): CatalogAsset => ({
  id,
  kind: "icon",
  name,
  tags,
  src,
  frame,
  frameSize: SHEET_FRAME_SIZE,
  packId,
});

export const ASSET_CATALOG: CatalogAsset[] = [
  {
    id: "tileset_tiny_town",
    kind: "tileset",
    name: "Tiny Town 地形圖塊",
    tags: ["village", "forest", "outdoor", "fantasy"],
    src: TOWN_SHEET,
    frameSize: SHEET_FRAME_SIZE,
    packId: "kenney-tiny-town",
  },
  character("char_hero", 97, "年輕騎士", ["player", "hero", "knight", "adventurer"]),
  character("char_knight", 96, "全罩騎士", ["guard", "soldier", "knight"]),
  character("char_wizard", 84, "紫袍法師", ["elder", "wizard", "mage", "sage"]),
  character("char_villager", 85, "村民", ["villager", "commoner", "merchant"]),
  character("char_bald_villager", 86, "光頭村民", ["villager", "blacksmith", "worker"]),
  character("char_viking", 87, "戰士", ["warrior", "viking", "fighter"]),
  character("char_youth", 88, "少年", ["villager", "youth", "child"]),
  character("char_squire", 98, "侍從", ["squire", "apprentice", "guard"]),
  character("char_long_hair", 99, "長髮旅人", ["villager", "healer", "noble", "elder"]),
  character("char_hooded_elder", 100, "兜帽長者", ["elder", "hermit", "priest"]),
  character("char_monk", 111, "修士", ["monk", "priest", "mysterious"]),
  character("char_ranger", 112, "遊俠", ["ranger", "hunter", "forester", "scout"]),
  character("char_cyclops", 109, "獨眼巨人", ["monster", "giant"]),
  character("char_slime", 108, "史萊姆", ["monster", "slime", "creature"]),
  character("char_ghost", 121, "幽靈", ["ghost", "spirit", "mysterious"]),
  icon("icon_coin", TOWN_SHEET, 93, "金色寶物", ["treasure", "coin", "relic", "light"], "kenney-tiny-town"),
  icon("icon_key", TOWN_SHEET, 117, "鑰匙", ["key", "unlock"], "kenney-tiny-town"),
  icon("icon_bow", TOWN_SHEET, 118, "弓", ["weapon", "bow"], "kenney-tiny-town"),
  icon("icon_sword", DUNGEON_SHEET, 104, "劍", ["weapon", "sword"], "kenney-tiny-dungeon"),
  icon("icon_shield", DUNGEON_SHEET, 102, "盾", ["armor", "shield"], "kenney-tiny-dungeon"),
  icon("icon_potion_red", DUNGEON_SHEET, 115, "紅色藥水", ["potion", "healing"], "kenney-tiny-dungeon"),
  icon("icon_potion_blue", DUNGEON_SHEET, 116, "藍色藥水", ["potion", "magic", "light"], "kenney-tiny-dungeon"),
  icon("icon_staff", DUNGEON_SHEET, 130, "法杖", ["staff", "magic", "relic"], "kenney-tiny-dungeon"),
  icon("icon_chest", DUNGEON_SHEET, 89, "寶箱", ["chest", "treasure", "container"], "kenney-tiny-dungeon"),
];

export const DEFAULT_PLAYER_SPRITE = "char_hero";
export const DEFAULT_NPC_SPRITE = "char_villager";
export const DEFAULT_ITEM_ICON = "icon_coin";

export function findCatalogAsset(id: string): CatalogAsset | undefined {
  return ASSET_CATALOG.find((a) => a.id === id);
}

/** 由素材庫產生 GameProject 用的 manifest 條目（含授權紀錄），避免資料中出現虛構授權 */
export function manifestEntry(id: string) {
  const asset = findCatalogAsset(id);
  if (!asset) throw new Error(`素材庫中沒有 ${id}`);
  const lic = LICENSES[asset.packId];
  return {
    id: asset.id,
    kind: asset.kind,
    src: asset.src,
    ...(asset.frame !== undefined ? { frame: asset.frame } : {}),
    ...(asset.frameSize !== undefined ? { frameSize: asset.frameSize } : {}),
    license: lic.license,
    author: lic.author,
    sourceUrl: lic.sourceUrl,
    attribution: lic.attributionText,
  };
}

/** 從地形字元推導 walkable 陣列 */
export function walkableFromTerrain(terrain: string[]): boolean[][] {
  return terrain.map((row) => [...row].map((ch) => TERRAIN[ch]?.walkable ?? false));
}

// ---------- 音效 ----------

const AUDIO = "/assets/kenney/audio";

/**
 * 遊戲事件音效（由 runtime 依事件播放，AI 不需要指定）。
 * 注意：jingle 與背景音樂的情緒分類是依曲名推測，尚未經人耳確認。
 * 原始 Ogg 檔已轉為 MP3（iPhone Safari 對 Ogg 支援不穩定），CC0 允許修改。
 */
export const SOUNDS = {
  footstep: [0, 1, 2, 3, 4].map((i) => `${AUDIO}/rpg-audio/footstep0${i}.mp3`),
  door: `${AUDIO}/rpg-audio/doorOpen_1.mp3`,
  pickup: `${AUDIO}/rpg-audio/handleCoins.mp3`,
  questStart: `${AUDIO}/rpg-audio/bookFlip1.mp3`,
  dialogueOpen: `${AUDIO}/interface-sounds/open_001.mp3`,
  dialogueClose: `${AUDIO}/interface-sounds/close_001.mp3`,
  select: `${AUDIO}/interface-sounds/select_001.mp3`,
  objective: `${AUDIO}/interface-sounds/confirmation_001.mp3`,
  bump: `${AUDIO}/interface-sounds/drop_001.mp3`,
  questComplete: `${AUDIO}/music-jingles/jingles_PIZZI00.mp3`,
  levelUp: `${AUDIO}/music-jingles/jingles_PIZZI03.mp3`,
} as const;

export const ENDING_MOODS = ["triumphant", "bittersweet", "somber", "mysterious"] as const;
export type EndingMood = (typeof ENDING_MOODS)[number];
export const ENDING_JINGLES: Record<EndingMood, string> = {
  triumphant: `${AUDIO}/music-jingles/jingles_NES00.mp3`,
  bittersweet: `${AUDIO}/music-jingles/jingles_STEEL05.mp3`,
  somber: `${AUDIO}/music-jingles/jingles_SAX07.mp3`,
  mysterious: `${AUDIO}/music-jingles/jingles_NES09.mp3`,
};

/** 腳步聲依地形材質調整音高與音量（素材包沒有分材質，屬於近似效果） */
export const FOOTSTEP_SURFACE: Record<string, { rate: number; volume: number }> = {
  ".": { rate: 0.8, volume: 0.25 },
  ",": { rate: 0.8, volume: 0.25 },
  "*": { rate: 0.85, volume: 0.25 },
  M: { rate: 0.8, volume: 0.25 },
  "=": { rate: 1, volume: 0.35 },
  C: { rate: 1.25, volume: 0.4 },
};

/** 背景音樂：AI 依場景氣氛選情緒標籤，runtime 對應到曲目並循環播放 */
export const MUSIC_MOODS = ["peaceful", "lively", "adventure", "mysterious", "tense", "melancholy"] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];
const MUSIC_DIR = "/assets/music/jrpg-junkala";
export const MUSIC: Record<MusicMood, { src: string; title: string }> = {
  peaceful: { src: `${MUSIC_DIR}/peaceful_home_town.mp3`, title: "Town1 - Home Town" },
  lively: { src: `${MUSIC_DIR}/lively_bazaar.mp3`, title: "Town4 - Bazaar" },
  adventure: { src: `${MUSIC_DIR}/adventure_grasslands.mp3`, title: "Exploration1 - Grasslands" },
  mysterious: { src: `${MUSIC_DIR}/mysterious_whispers.mp3`, title: "Evil5 - Whispers From Beyond" },
  tense: { src: `${MUSIC_DIR}/tense_ancient_evil.mp3`, title: "Evil1 - Ancient Evil Awakens" },
  melancholy: { src: `${MUSIC_DIR}/melancholy_place_i_call_home.mp3`, title: "Calm1 - A Place I Call Home" },
};
export const DEFAULT_MUSIC: MusicMood = "adventure";
