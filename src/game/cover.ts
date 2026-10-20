import type { GameProject } from "./schema";

/**
 * 封面資料：從 GameProject 抽出畫封面需要的最少資訊（背景地圖地形、主視覺角色）。
 * 遊戲庫目錄（/games/index.json）直接內嵌這份資料，卡片不必先下載整款遊戲。
 */
export type CoverData = {
  title: string;
  tagline?: string;
  terrain: string[] | null;
  tilesetSrc: string | null;
  colors: { floor: string; wall: string } | null;
  characters: Array<{ src: string; frame: number; frameSize: number }>;
};

export function coverDataOf(project: GameProject): CoverData {
  const asset = (id?: string) => project.assetManifest.assets.find((a) => a.id === id);
  const map = project.maps.find((m) => m.id === project.cover?.mapId) ?? project.maps.find((m) => m.id === project.system.start.mapId) ?? project.maps[0];
  const player = project.actors.find((a) => a.id === project.system.playerActorId);
  const ids = project.cover?.characterAssetIds?.length
    ? project.cover.characterAssetIds
    : [player?.spriteAssetId, ...project.actors.filter((a) => a !== player).map((a) => a.spriteAssetId)].filter((x): x is string => Boolean(x)).slice(0, 3);
  return {
    title: project.title,
    tagline: project.cover?.tagline,
    terrain: map.terrain,
    tilesetSrc: asset(map.tilesetId)?.src ?? null,
    colors: null,
    characters: ids
      .map((id) => asset(id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a && a.frame !== undefined))
      .map((a) => ({ src: a.src, frame: a.frame!, frameSize: a.frameSize ?? 16 })),
  };
}
