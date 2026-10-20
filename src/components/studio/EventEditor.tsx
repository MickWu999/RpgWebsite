"use client";

import { useState } from "react";
import { ASSET_CATALOG } from "@/game/assets";
import type { GameProject, NPCDefinition, SceneDefinition } from "@/game/schema";
import type { StudioOp } from "@/studio/ops";
import { VariantPages, ConditionEditor } from "./LogicEditors";

/**
 * 事件編輯器（RPG Maker 的事件視窗）：顯示選取格子上的 NPC、調查點、撿取物、出口、地點、玩家起點，
 * 每個事件用本地草稿編輯，按「確定」才送出一筆操作（方便復原）。
 */

const characters = ASSET_CATALOG.filter((a) => a.kind === "character");
type Interactable = NonNullable<SceneDefinition["interactables"]>[number];
type Pickup = NonNullable<SceneDefinition["pickups"]>[number];
type Exit = SceneDefinition["exits"][number];
type Location = NonNullable<SceneDefinition["locations"]>[number];

function uniqueId(prefix: string, taken: string[]) {
  for (let i = 1; ; i++) if (!taken.includes(`${prefix}_${i}`)) return `${prefix}_${i}`;
}

export function allIds(p: GameProject) {
  return [
    ...p.npcs.map((n) => n.id),
    ...p.dialogues.map((d) => d.id),
    ...p.items.map((i) => i.id),
    ...p.quests.map((q) => q.id),
    ...p.scenes.flatMap((s) => [...(s.interactables ?? []).map((o) => o.id), ...(s.pickups ?? []).map((o) => o.id), ...(s.locations ?? []).map((o) => o.id)]),
  ];
}

export default function EventEditor({
  project,
  scene,
  cell,
  dispatch,
  openDialogue,
}: {
  project: GameProject;
  scene: SceneDefinition;
  cell: { x: number; y: number };
  dispatch: (ops: StudioOp[]) => void;
  openDialogue: (nodeId: string) => void;
}) {
  const { x, y } = cell;
  const npc = project.npcs.find((n) => n.sceneId === scene.id && n.position.x === x && n.position.y === y);
  const object = scene.interactables?.find((o) => o.x === x && o.y === y);
  const pickup = scene.pickups?.find((o) => o.x === x && o.y === y);
  const exit = scene.exits.find((o) => o.x === x && o.y === y);
  const location = scene.locations?.find((l) => x >= l.x && x < l.x + (l.width ?? 1) && y >= l.y && y < l.y + (l.height ?? 1));
  const isStart = project.player.startPosition.sceneId === scene.id && project.player.startPosition.x === x && project.player.startPosition.y === y;
  const ids = allIds(project);
  const firstNode = project.dialogues[0]?.id;

  const newDialogue = (prefix: string, speaker: string, text: string): StudioOp[] => {
    const id = uniqueId(prefix, ids);
    return [{ op: "dialogue.upsert", node: { id, speaker, text } }];
  };

  const create = {
    npc: () => {
      const id = uniqueId("npc", ids);
      const [d] = newDialogue(`${id}_hello`, "新角色", "你好，旅人。");
      dispatch([
        d,
        {
          op: "npc.upsert",
          npc: { id, name: "新角色", description: "", sceneId: scene.id, position: { x, y }, spriteAssetId: "char_villager", dialogueNodeId: (d as { node: { id: string } }).node.id, voice: { pitch: "mid", speed: "normal", timbre: "soft" } },
        },
      ]);
    },
    object: () => {
      const id = uniqueId("obj", ids);
      const [d] = newDialogue(`${id}_text`, "調查", "這裡似乎有什麼東西……");
      dispatch([d, { op: "interactable.upsert", sceneId: scene.id, object: { id, name: "調查點", x, y, dialogueNodeId: (d as { node: { id: string } }).node.id } }]);
    },
    pickup: () => project.items[0] && dispatch([{ op: "pickup.upsert", sceneId: scene.id, pickup: { id: uniqueId("pickup", ids), itemId: project.items[0].id, x, y, count: 1 } }]),
    exit: () => {
      const target = project.scenes.find((s) => s.id !== scene.id) ?? scene;
      dispatch([{ op: "exit.upsert", sceneId: scene.id, exit: { x, y, targetSceneId: target.id, targetX: 1, targetY: 1, label: `往${target.name}` } }]);
    },
    location: () => dispatch([{ op: "location.upsert", sceneId: scene.id, location: { id: uniqueId("loc", ids), name: "新地點", x, y, width: 1, height: 1 } }]),
    start: () => dispatch([{ op: "player.update", start: { sceneId: scene.id, x, y } }]),
  };

  const empty = !npc && !object && !pickup && !exit && !location && !isStart;
  return (
    <div className="stack" data-testid="event-editor">
      <div className="row">
        <h3 className="grow" style={{ margin: 0 }}>
          事件（{x}, {y}）
        </h3>
        <span className="badge">{scene.walkable[y]?.[x] ? "可通行" : "不可通行"}</span>
      </div>
      {empty && <div className="small muted">這格沒有事件。在地圖上雙擊，或用下面的按鈕新增：</div>}
      <div className="row" style={{ gap: 6 }}>
        {!npc && !object && (
          <>
            <button className="btn small" onClick={create.npc} data-testid="add-npc">
              ＋ NPC
            </button>
            <button className="btn small" onClick={create.object} data-testid="add-object">
              ＋ 調查點
            </button>
          </>
        )}
        {!pickup && project.items.length > 0 && (
          <button className="btn small" onClick={create.pickup}>
            ＋ 撿取物
          </button>
        )}
        {!exit && (
          <button className="btn small" onClick={create.exit}>
            ＋ 出口
          </button>
        )}
        {!location && (
          <button className="btn small" onClick={create.location}>
            ＋ 地點
          </button>
        )}
        {!isStart && (
          <button className="btn small" onClick={create.start}>
            設為玩家起點
          </button>
        )}
      </div>
      {isStart && <div className="sub small">🔵 玩家起點</div>}
      {npc && <NpcForm key={`npc-${npc.id}-${JSON.stringify(npc)}`} project={project} npc={npc} dispatch={dispatch} openDialogue={openDialogue} />}
      {object && (
        <ObjectForm key={`obj-${object.id}-${JSON.stringify(object)}`} project={project} scene={scene} object={object} dispatch={dispatch} openDialogue={openDialogue} />
      )}
      {pickup && <PickupForm key={`pk-${pickup.id}-${JSON.stringify(pickup)}`} project={project} scene={scene} pickup={pickup} dispatch={dispatch} />}
      {exit && <ExitForm key={`ex-${JSON.stringify(exit)}`} project={project} scene={scene} exit={exit} dispatch={dispatch} />}
      {location && <LocationForm key={`loc-${location.id}-${JSON.stringify(location)}`} scene={scene} location={location} dispatch={dispatch} />}
      {!firstNode && <div className="notice small">專案還沒有任何對話節點。</div>}
    </div>
  );
}

function Actions({ onOk, onDelete }: { onOk: () => void; onDelete: () => void }) {
  return (
    <div className="row">
      <button className="btn small primary" onClick={onOk}>
        確定
      </button>
      <button className="btn small danger" onClick={onDelete}>
        刪除
      </button>
    </div>
  );
}

function NpcForm({ project, npc, dispatch, openDialogue }: { project: GameProject; npc: NPCDefinition; dispatch: (ops: StudioOp[]) => void; openDialogue: (id: string) => void }) {
  const [d, setD] = useState(npc);
  const voice = d.voice ?? { pitch: "mid", speed: "normal", timbre: "soft" };
  return (
    <div className="sub stack" style={{ gap: 8 }}>
      <strong>👤 NPC</strong>
      <label className="field">
        名稱
        <input type="text" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </label>
      <label className="field">
        描述
        <textarea rows={2} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </label>
      <div className="small muted">角色圖</div>
      <div className="sprite-picker">
        {characters.map((a) => (
          <button
            key={a.id}
            className={`sprite-option${d.spriteAssetId === a.id ? " active" : ""}`}
            title={a.name}
            onClick={() => setD({ ...d, spriteAssetId: a.id })}
            style={{ backgroundImage: `url(${a.src})`, backgroundPosition: `-${(a.frame! % 12) * 32}px -${Math.floor(a.frame! / 12) * 32}px`, backgroundSize: "384px auto" }}
          />
        ))}
      </div>
      <div className="logic-row small">
        聲音：
        <select value={voice.pitch} onChange={(e) => setD({ ...d, voice: { ...voice, pitch: e.target.value as typeof voice.pitch } })}>
          <option value="low">低音</option>
          <option value="mid">中音</option>
          <option value="high">高音</option>
        </select>
        <select value={voice.speed} onChange={(e) => setD({ ...d, voice: { ...voice, speed: e.target.value as typeof voice.speed } })}>
          <option value="slow">慢</option>
          <option value="normal">普通</option>
          <option value="fast">快</option>
        </select>
        <select value={voice.timbre} onChange={(e) => setD({ ...d, voice: { ...voice, timbre: e.target.value as typeof voice.timbre } })}>
          <option value="soft">柔和</option>
          <option value="bright">明亮</option>
          <option value="buzzy">粗糙</option>
        </select>
      </div>
      <div className="small muted">事件頁（對話入口）</div>
      <VariantPages project={project} base={d.dialogueNodeId} variants={d.dialogueVariants ?? []} onChange={(base, variants) => setD({ ...d, dialogueNodeId: base, dialogueVariants: variants })} />
      <button className="btn small" onClick={() => openDialogue(d.dialogueNodeId)}>
        編輯預設對話 →
      </button>
      <Actions onOk={() => dispatch([{ op: "npc.upsert", npc: d }])} onDelete={() => dispatch([{ op: "npc.remove", id: npc.id }])} />
    </div>
  );
}

function ObjectForm({
  project,
  scene,
  object,
  dispatch,
  openDialogue,
}: {
  project: GameProject;
  scene: SceneDefinition;
  object: Interactable;
  dispatch: (ops: StudioOp[]) => void;
  openDialogue: (id: string) => void;
}) {
  const [d, setD] = useState(object);
  return (
    <div className="sub stack" style={{ gap: 8 }}>
      <strong>❗ 調查點</strong>
      <label className="field">
        名稱（顯示在訊息視窗）
        <input type="text" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </label>
      <div className="small muted">事件頁（依條件改變回應，例如有鑰匙時開門）</div>
      <VariantPages project={project} base={d.dialogueNodeId} variants={d.dialogueVariants ?? []} onChange={(base, variants) => setD({ ...d, dialogueNodeId: base, dialogueVariants: variants })} />
      <button className="btn small" onClick={() => openDialogue(d.dialogueNodeId)}>
        編輯預設對話 →
      </button>
      <Actions onOk={() => dispatch([{ op: "interactable.upsert", sceneId: scene.id, object: d }])} onDelete={() => dispatch([{ op: "interactable.remove", sceneId: scene.id, id: object.id }])} />
    </div>
  );
}

function PickupForm({ project, scene, pickup, dispatch }: { project: GameProject; scene: SceneDefinition; pickup: Pickup; dispatch: (ops: StudioOp[]) => void }) {
  const [d, setD] = useState(pickup);
  return (
    <div className="sub stack" style={{ gap: 8 }}>
      <strong>✨ 撿取物</strong>
      <div className="row small">
        物品
        <select value={d.itemId} onChange={(e) => setD({ ...d, itemId: e.target.value })}>
          {project.items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        數量
        <input type="number" min={1} value={d.count ?? 1} onChange={(e) => setD({ ...d, count: Number(e.target.value) || 1 })} style={{ width: 70 }} />
      </div>
      <label className="small">
        <input type="checkbox" checked={Boolean(d.condition)} onChange={(e) => setD({ ...d, condition: e.target.checked ? { type: "flag_equals", flag: "flag", value: true } : undefined })} />{" "}
        只在條件成立時出現
      </label>
      {d.condition && <ConditionEditor project={project} value={d.condition} onChange={(condition) => setD({ ...d, condition })} />}
      <Actions onOk={() => dispatch([{ op: "pickup.upsert", sceneId: scene.id, pickup: d }])} onDelete={() => dispatch([{ op: "pickup.remove", sceneId: scene.id, id: pickup.id }])} />
    </div>
  );
}

function ExitForm({ project, scene, exit, dispatch }: { project: GameProject; scene: SceneDefinition; exit: Exit; dispatch: (ops: StudioOp[]) => void }) {
  const [d, setD] = useState(exit);
  return (
    <div className="sub stack" style={{ gap: 8 }}>
      <strong>⇄ 出口（場所移動）</strong>
      <div className="row small">
        目標地圖
        <select value={d.targetSceneId} onChange={(e) => setD({ ...d, targetSceneId: e.target.value })}>
          {project.scenes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="row small">
        目標座標 X
        <input type="number" min={0} value={d.targetX} onChange={(e) => setD({ ...d, targetX: Number(e.target.value) })} style={{ width: 70 }} />Y
        <input type="number" min={0} value={d.targetY} onChange={(e) => setD({ ...d, targetY: Number(e.target.value) })} style={{ width: 70 }} />
      </div>
      <label className="field">
        標示文字
        <input type="text" value={d.label ?? ""} onChange={(e) => setD({ ...d, label: e.target.value || undefined })} />
      </label>
      <Actions onOk={() => dispatch([{ op: "exit.upsert", sceneId: scene.id, exit: d }])} onDelete={() => dispatch([{ op: "exit.remove", sceneId: scene.id, x: exit.x, y: exit.y }])} />
    </div>
  );
}

function LocationForm({ scene, location, dispatch }: { scene: SceneDefinition; location: Location; dispatch: (ops: StudioOp[]) => void }) {
  const [d, setD] = useState(location);
  return (
    <div className="sub stack" style={{ gap: 8 }}>
      <strong>📍 地點（任務「抵達地點」用）</strong>
      <label className="field">
        名稱
        <input type="text" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </label>
      <div className="row small">
        寬
        <input type="number" min={1} value={d.width ?? 1} onChange={(e) => setD({ ...d, width: Number(e.target.value) || 1 })} style={{ width: 70 }} />高
        <input type="number" min={1} value={d.height ?? 1} onChange={(e) => setD({ ...d, height: Number(e.target.value) || 1 })} style={{ width: 70 }} />
      </div>
      <Actions onOk={() => dispatch([{ op: "location.upsert", sceneId: scene.id, location: d }])} onDelete={() => dispatch([{ op: "location.remove", sceneId: scene.id, id: location.id }])} />
    </div>
  );
}
