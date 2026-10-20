import type { AssetDefinition } from "@/game/schema";

const SHEET_COLUMNS = 12;

/** 從 spritesheet 裁出角色圖當作訊息視窗頭像（RPG Maker 的 face graphic） */
export default function Portrait({ asset, size = 72 }: { asset?: AssetDefinition; size?: number }) {
  if (!asset || asset.frame === undefined) return null;
  const frameSize = asset.frameSize ?? 16;
  const scale = size / frameSize;
  const col = asset.frame % SHEET_COLUMNS;
  const row = Math.floor(asset.frame / SHEET_COLUMNS);
  return (
    <div
      className="portrait"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${asset.src})`,
        backgroundPosition: `-${col * size}px -${row * size}px`,
        backgroundSize: `${SHEET_COLUMNS * frameSize * scale}px auto`,
      }}
    />
  );
}
