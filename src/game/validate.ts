import { findCatalogAsset, TERRAIN } from "./assets";
import {
  SCHEMA_VERSION,
  gameProjectSchema,
  type GameCondition,
  type GameEffect,
  type GameProject,
  type SceneDefinition,
} from "./schema";

/**
 * GameProject 驗證：先做 schema 驗證，再做引用、地圖、任務依賴、對話圖與結局可達性等邏輯驗證（SPEC §6.1、§8.1）。
 * 驗證結果由程式產生，AI 修復流程也只使用這裡回傳的錯誤。
 */

export type ValidationIssue = { path: string; message: string };
export type ValidationReport = {
  isValid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};
export type ValidationResult = ValidationReport & { project?: GameProject };

export const MAX_PROJECT_BYTES = 512 * 1024;

export function validateProject(input: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { isValid: false, errors: [{ path: "", message: "GameProject 必須是 JSON 物件" }], warnings: [] };
  }
  const version = (input as Record<string, unknown>).schemaVersion;
  if (version !== SCHEMA_VERSION) {
    return {
      isValid: false,
      errors: [
        {
          path: "schemaVersion",
          message: `不支援的 schemaVersion「${String(version)}」，目前只接受 ${SCHEMA_VERSION}（尚無 migration 流程）`,
        },
      ],
      warnings: [],
    };
  }
  if (JSON.stringify(input).length > MAX_PROJECT_BYTES) {
    return { isValid: false, errors: [{ path: "", message: `專案資料超過 ${MAX_PROJECT_BYTES / 1024} KB 上限` }], warnings: [] };
  }

  const parsed = gameProjectSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ path: issue.path.join("."), message: translateZodMessage(issue.message, issue.code) });
    }
    return { isValid: false, errors: errors.slice(0, 50), warnings: [] };
  }

  const report = validateLogic(parsed.data);
  return { ...report, project: report.isValid ? parsed.data : undefined };
}

function translateZodMessage(message: string, code: string) {
  if (code === "invalid_type") return `型別錯誤：${message}`;
  if (code === "unrecognized_keys") return `不允許的欄位：${message}`;
  if (code === "invalid_union") return `不支援的 effect／condition 或格式錯誤：${message}`;
  return message;
}

// ---------- 邏輯驗證 ----------

function walkConditions(condition: GameCondition | undefined, visit: (c: GameCondition, negated: boolean) => void, negated = false) {
  if (!condition) return;
  visit(condition, negated);
  if (condition.type === "all" || condition.type === "any") condition.conditions.forEach((c) => walkConditions(c, visit, negated));
  if (condition.type === "not") walkConditions(condition.condition, visit, !negated);
}

export function validateLogic(project: GameProject): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const warn = (path: string, message: string) => warnings.push({ path, message });

  // --- ID 唯一性 ---
  const uniq = (label: string, path: string, ids: string[]) => {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (seen.has(id)) err(`${path}[${i}]`, `${label} ID「${id}」重複`);
      seen.add(id);
    });
    return seen;
  };
  const sceneIds = uniq("場景", "scenes", project.scenes.map((s) => s.id));
  const npcIds = uniq("NPC", "npcs", project.npcs.map((n) => n.id));
  const nodeIds = uniq("對話節點", "dialogues", project.dialogues.map((d) => d.id));
  const questIds = uniq("任務", "quests", project.quests.map((q) => q.id));
  const itemIds = uniq("物品", "items", project.items.map((i) => i.id));
  uniq("結局", "endings", project.endings.map((e) => e.id));
  uniq("素材", "assetManifest.assets", project.assetManifest.assets.map((a) => a.id));
  const choiceIds = uniq("對話選項", "dialogues.choices", project.dialogues.flatMap((d) => (d.choices ?? []).map((c) => c.id)));
  const locationIds = uniq("地點", "scenes.locations", project.scenes.flatMap((s) => (s.locations ?? []).map((l) => l.id)));
  uniq("撿取物", "scenes.pickups", project.scenes.flatMap((s) => (s.pickups ?? []).map((p) => p.id)));
  project.quests.forEach((q, qi) => uniq("任務目標", `quests[${qi}].objectives`, q.objectives.map((o) => o.id)));

  const sceneById = new Map(project.scenes.map((s) => [s.id, s]));
  const inBounds = (scene: SceneDefinition, x: number, y: number) => x >= 0 && y >= 0 && x < scene.width && y < scene.height;
  const walkableAt = (scene: SceneDefinition, x: number, y: number) => inBounds(scene, x, y) && scene.walkable[y]?.[x] === true;

  // --- 條件與效果的引用 ---
  const checkCondition = (path: string, condition: GameCondition | undefined) =>
    walkConditions(condition, (c) => {
      if ((c.type === "quest_completed" || c.type === "quest_active") && !questIds.has(c.questId)) err(path, `條件引用了不存在的任務「${c.questId}」`);
      if (c.type === "has_item" && !itemIds.has(c.itemId)) err(path, `條件引用了不存在的物品「${c.itemId}」`);
    });
  const checkEffects = (path: string, effects: GameEffect[] | undefined) =>
    (effects ?? []).forEach((e, i) => {
      if ((e.type === "give_item" || e.type === "remove_item") && !itemIds.has(e.itemId)) err(`${path}[${i}]`, `效果引用了不存在的物品「${e.itemId}」`);
      if (e.type === "complete_quest" && !questIds.has(e.questId)) err(`${path}[${i}]`, `效果引用了不存在的任務「${e.questId}」`);
    });
  const checkAsset = (path: string, id: string | undefined, kind?: string) => {
    if (!id) return;
    const asset = project.assetManifest.assets.find((a) => a.id === id);
    if (!asset) err(path, `引用了素材清單中不存在的素材「${id}」`);
    else if (kind && asset.kind !== kind) err(path, `素材「${id}」的類型是 ${asset.kind}，此處需要 ${kind}`);
  };

  // --- 素材：必須來自內建素材庫，避免虛構素材或授權 ---
  project.assetManifest.assets.forEach((asset, i) => {
    const known = findCatalogAsset(asset.id);
    if (!known) err(`assetManifest.assets[${i}]`, `素材「${asset.id}」不在內建素材庫中（不可引用未登錄或未確認授權的素材）`);
    else if (known.src !== asset.src || known.frame !== asset.frame) err(`assetManifest.assets[${i}]`, `素材「${asset.id}」的路徑或圖塊編號與素材庫不一致`);
  });

  // --- 玩家 ---
  if (!sceneIds.has(project.startSceneId)) err("startSceneId", `起始場景「${project.startSceneId}」不存在`);
  const start = project.player.startPosition;
  const startScene = sceneById.get(start.sceneId);
  if (!startScene) err("player.startPosition.sceneId", `玩家起始場景「${start.sceneId}」不存在`);
  else if (!walkableAt(startScene, start.x, start.y)) err("player.startPosition", "玩家起始位置超出地圖或位於不可行走區域");
  if (start.sceneId !== project.startSceneId) warn("player.startPosition.sceneId", "玩家起始場景與 startSceneId 不同，將以玩家起始場景為準");
  project.player.inventoryItemIds.forEach((id, i) => {
    if (!itemIds.has(id)) err(`player.inventoryItemIds[${i}]`, `初始物品「${id}」不存在`);
  });
  checkAsset("player.spriteAssetId", project.player.spriteAssetId, "character");

  // --- 場景 ---
  project.scenes.forEach((scene, si) => {
    const p = `scenes[${si}]`;
    if (scene.walkable.length !== scene.height || scene.walkable.some((row) => row.length !== scene.width)) {
      err(`${p}.walkable`, `walkable 陣列尺寸必須是 ${scene.height} 列 × ${scene.width} 欄`);
    }
    if (scene.terrain) {
      if (scene.terrain.length !== scene.height || scene.terrain.some((row) => [...row].length !== scene.width)) {
        err(`${p}.terrain`, `terrain 尺寸必須是 ${scene.height} 列 × ${scene.width} 字元`);
      } else {
        scene.terrain.forEach((row, y) =>
          [...row].forEach((ch, x) => {
            const def = TERRAIN[ch];
            if (!def) err(`${p}.terrain[${y}]`, `未知的地形字元「${ch}」（位置 ${x},${y}）`);
            else if (def.walkable !== scene.walkable[y]?.[x]) warn(`${p}.terrain[${y}]`, `位置 ${x},${y} 的地形「${def.name}」與 walkable 設定不一致`);
          }),
        );
      }
    }
    checkAsset(`${p}.tilesetId`, scene.tilesetId, "tileset");
    checkAsset(`${p}.backgroundAssetId`, scene.backgroundAssetId, "background");
    scene.exits.forEach((exit, ei) => {
      const ep = `${p}.exits[${ei}]`;
      if (!walkableAt(scene, exit.x, exit.y)) err(ep, "出口位置超出地圖或位於不可行走區域");
      const target = sceneById.get(exit.targetSceneId);
      if (!target) err(ep, `出口目標場景「${exit.targetSceneId}」不存在`);
      else if (!walkableAt(target, exit.targetX, exit.targetY)) err(ep, "出口目標位置超出地圖或位於不可行走區域");
    });
    scene.npcIds.forEach((id, ni) => {
      const npc = project.npcs.find((n) => n.id === id);
      if (!npc) err(`${p}.npcIds[${ni}]`, `場景引用了不存在的 NPC「${id}」`);
      else if (npc.sceneId !== scene.id) err(`${p}.npcIds[${ni}]`, `NPC「${id}」的 sceneId 是「${npc.sceneId}」，與此場景不符`);
    });
    (scene.locations ?? []).forEach((loc, li) => {
      if (!inBounds(scene, loc.x, loc.y) || !inBounds(scene, loc.x + (loc.width ?? 1) - 1, loc.y + (loc.height ?? 1) - 1)) {
        err(`${p}.locations[${li}]`, `地點「${loc.id}」超出地圖`);
      }
    });
    (scene.pickups ?? []).forEach((pk, pi) => {
      if (!walkableAt(scene, pk.x, pk.y)) err(`${p}.pickups[${pi}]`, `撿取物「${pk.id}」超出地圖或位於不可行走區域`);
      if (!itemIds.has(pk.itemId)) err(`${p}.pickups[${pi}]`, `撿取物引用了不存在的物品「${pk.itemId}」`);
      checkCondition(`${p}.pickups[${pi}].condition`, pk.condition);
    });
  });

  // --- NPC ---
  project.npcs.forEach((npc, ni) => {
    const p = `npcs[${ni}]`;
    const scene = sceneById.get(npc.sceneId);
    if (!scene) err(`${p}.sceneId`, `NPC「${npc.name}」所在場景「${npc.sceneId}」不存在`);
    else {
      if (!inBounds(scene, npc.position.x, npc.position.y)) err(`${p}.position`, `NPC「${npc.name}」位置超出地圖`);
      else if (!walkableAt(scene, npc.position.x, npc.position.y)) warn(`${p}.position`, `NPC「${npc.name}」站在不可行走的地形上`);
      if (!scene.npcIds.includes(npc.id)) warn(`${p}.sceneId`, `場景「${scene.id}」的 npcIds 沒有列出 NPC「${npc.id}」`);
    }
    if (!nodeIds.has(npc.dialogueNodeId)) err(`${p}.dialogueNodeId`, `NPC「${npc.name}」的對話節點「${npc.dialogueNodeId}」不存在`);
    (npc.dialogueVariants ?? []).forEach((v, vi) => {
      if (!nodeIds.has(v.dialogueNodeId)) err(`${p}.dialogueVariants[${vi}]`, `對話分支節點「${v.dialogueNodeId}」不存在`);
      checkCondition(`${p}.dialogueVariants[${vi}].condition`, v.condition);
    });
    (npc.questIds ?? []).forEach((id, qi) => {
      if (!questIds.has(id)) err(`${p}.questIds[${qi}]`, `NPC 引用了不存在的任務「${id}」`);
    });
    checkAsset(`${p}.spriteAssetId`, npc.spriteAssetId, "character");
  });
  const occupied = new Set(project.npcs.map((n) => `${n.sceneId}:${n.position.x},${n.position.y}`));
  if (occupied.size !== project.npcs.length) warn("npcs", "有多個 NPC 站在同一格");
  if (occupied.has(`${start.sceneId}:${start.x},${start.y}`)) err("player.startPosition", "玩家起始位置與 NPC 重疊");

  // --- 對話 ---
  const referencedNodes = new Set<string>();
  project.npcs.forEach((n) => {
    referencedNodes.add(n.dialogueNodeId);
    n.dialogueVariants?.forEach((v) => referencedNodes.add(v.dialogueNodeId));
  });
  project.dialogues.forEach((node, di) => {
    (node.choices ?? []).forEach((choice, ci) => {
      const p = `dialogues[${di}].choices[${ci}]`;
      if (choice.nextNodeId) {
        referencedNodes.add(choice.nextNodeId);
        if (!nodeIds.has(choice.nextNodeId)) err(`${p}.nextNodeId`, `對話選項指向不存在的節點「${choice.nextNodeId}」`);
      }
      checkEffects(`${p}.effects`, choice.effects);
      checkCondition(`${p}.condition`, choice.condition);
    });
  });
  project.dialogues.forEach((node, di) => {
    if (!referencedNodes.has(node.id)) warn(`dialogues[${di}]`, `對話節點「${node.id}」沒有任何 NPC 或選項會進入`);
  });

  // --- 任務 ---
  project.quests.forEach((quest, qi) => {
    const p = `quests[${qi}]`;
    checkCondition(`${p}.startCondition`, quest.startCondition);
    checkEffects(`${p}.rewards`, quest.rewards);
    quest.objectives.forEach((o, oi) => {
      const op = `${p}.objectives[${oi}]`;
      const ok =
        (o.type === "talk_to_npc" && npcIds.has(o.targetId)) ||
        (o.type === "collect_item" && itemIds.has(o.targetId)) ||
        (o.type === "reach_location" && locationIds.has(o.targetId)) ||
        (o.type === "make_choice" && choiceIds.has(o.targetId));
      if (!ok) err(op, `任務目標「${o.description}」指向不存在的${{ talk_to_npc: " NPC", collect_item: "物品", reach_location: "地點", make_choice: "對話選項" }[o.type]}「${o.targetId}」`);
    });
  });

  // 任務依賴循環：A 的開始條件需要 B，B 又需要 A
  const deps = new Map<string, string[]>();
  project.quests.forEach((q) => {
    const list: string[] = [];
    walkConditions(q.startCondition, (c, negated) => {
      if (!negated && (c.type === "quest_completed" || c.type === "quest_active")) list.push(c.questId);
    });
    deps.set(q.id, list);
  });
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      err("quests", `任務依賴形成循環：${[...trail, id].join(" → ")}，任務將無法解鎖`);
      return;
    }
    visiting.add(id);
    (deps.get(id) ?? []).forEach((d) => visit(d, [...trail, id]));
    visiting.delete(id);
    done.add(id);
  };
  project.quests.forEach((q) => visit(q.id, []));

  // --- 結局 ---
  project.endings.forEach((e, ei) => checkCondition(`endings[${ei}].condition`, e.condition));

  // 引用錯誤會讓後續分析失準，先回報
  if (errors.length > 0) return { isValid: false, errors, warnings };

  checkReachability(project, err);
  checkObtainability(project, err, warn);
  return { isValid: errors.length === 0, errors, warnings };
}

/** 從玩家起點出發，跨出口做 BFS，確認 NPC、撿取物與任務地點都走得到 */
function checkReachability(project: GameProject, err: (path: string, message: string) => void) {
  const sceneById = new Map(project.scenes.map((s) => [s.id, s]));
  const blocked = new Set(project.npcs.map((n) => `${n.sceneId}:${n.position.x},${n.position.y}`));
  const reached = new Set<string>();
  const start = project.player.startPosition;
  const queue: Array<[string, number, number]> = [[start.sceneId, start.x, start.y]];
  reached.add(`${start.sceneId}:${start.x},${start.y}`);
  while (queue.length > 0) {
    const [sid, x, y] = queue.shift()!;
    const scene = sceneById.get(sid)!;
    const next: Array<[string, number, number]> = [];
    const exit = scene.exits.find((e) => e.x === x && e.y === y);
    if (exit) next.push([exit.targetSceneId, exit.targetX, exit.targetY]);
    else
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (scene.walkable[ny]?.[nx] === true && !blocked.has(`${sid}:${nx},${ny}`)) next.push([sid, nx, ny]);
      }
    for (const n of next) {
      const key = `${n[0]}:${n[1]},${n[2]}`;
      if (!reached.has(key)) {
        reached.add(key);
        queue.push(n);
      }
    }
  }
  const isReached = (sid: string, x: number, y: number) => reached.has(`${sid}:${x},${y}`);

  project.npcs.forEach((npc, i) => {
    const near = [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => (dx || dy) && isReached(npc.sceneId, npc.position.x + dx, npc.position.y + dy)));
    if (!near) err(`npcs[${i}]`, `從玩家起點走不到 NPC「${npc.name}」旁邊，無法對話`);
  });
  project.scenes.forEach((scene, si) => {
    (scene.pickups ?? []).forEach((pk, pi) => {
      if (!isReached(scene.id, pk.x, pk.y)) err(`scenes[${si}].pickups[${pi}]`, `從玩家起點走不到撿取物「${pk.id}」`);
    });
    (scene.locations ?? []).forEach((loc, li) => {
      let ok = false;
      for (let dy = 0; dy < (loc.height ?? 1) && !ok; dy++)
        for (let dx = 0; dx < (loc.width ?? 1) && !ok; dx++) ok = isReached(scene.id, loc.x + dx, loc.y + dy);
      if (!ok) err(`scenes[${si}].locations[${li}]`, `從玩家起點走不到地點「${loc.name}」`);
    });
  });
}

/**
 * 靜態可達性：條件需要的旗標值、物品與任務完成，必須在資料中有對應的取得來源。
 * 這是保守的必要條件檢查，不保證所有分支組合都能走到。
 */
function checkObtainability(
  project: GameProject,
  err: (path: string, message: string) => void,
  warn: (path: string, message: string) => void,
) {
  const flagValues = new Set<string>();
  const obtainableItems = new Set<string>(project.player.inventoryItemIds);
  const completable = new Set<string>();
  const allEffects: GameEffect[] = [
    ...project.dialogues.flatMap((d) => (d.choices ?? []).flatMap((c) => c.effects ?? [])),
    ...project.quests.flatMap((q) => q.rewards ?? []),
  ];
  for (const e of allEffects) {
    if (e.type === "set_flag") flagValues.add(`${e.flag}=${JSON.stringify(e.value)}`);
    if (e.type === "give_item") obtainableItems.add(e.itemId);
    if (e.type === "complete_quest") completable.add(e.questId);
  }
  project.scenes.forEach((s) => (s.pickups ?? []).forEach((p) => obtainableItems.add(p.itemId)));
  project.quests.forEach((q) => completable.add(q.id));

  const unmet = (condition: GameCondition | undefined): string[] => {
    const problems: string[] = [];
    walkConditions(condition, (c, negated) => {
      if (negated) return;
      if (c.type === "flag_equals" && !flagValues.has(`${c.flag}=${JSON.stringify(c.value)}`)) problems.push(`旗標 ${c.flag}=${JSON.stringify(c.value)} 沒有任何效果會設定`);
      if (c.type === "has_item" && !obtainableItems.has(c.itemId)) problems.push(`物品「${c.itemId}」沒有任何取得方式`);
      if ((c.type === "quest_completed" || c.type === "quest_active") && !completable.has(c.questId)) problems.push(`任務「${c.questId}」無法完成`);
    });
    // any 只要求其中一個成立；簡化處理：any 底下有問題只列為警告
    return problems;
  };
  const hasAny = (condition: GameCondition | undefined): boolean => {
    let found = false;
    walkConditions(condition, (c) => {
      if (c.type === "any") found = true;
    });
    return found;
  };

  project.endings.forEach((ending, i) => {
    const problems = unmet(ending.condition);
    if (problems.length) (hasAny(ending.condition) ? warn : err)(`endings[${i}]`, `結局「${ending.title}」可能無法達成：${problems.join("；")}`);
  });
  project.quests.forEach((quest, i) => {
    const problems = unmet(quest.startCondition);
    if (problems.length) (hasAny(quest.startCondition) ? warn : err)(`quests[${i}].startCondition`, `任務「${quest.title}」可能無法開始：${problems.join("；")}`);
    quest.objectives.forEach((o, oi) => {
      if (o.type === "collect_item" && !obtainableItems.has(o.targetId)) err(`quests[${i}].objectives[${oi}]`, `任務目標需要的物品「${o.targetId}」沒有任何取得方式`);
    });
  });
  project.dialogues.forEach((d, di) =>
    (d.choices ?? []).forEach((c, ci) =>
      (c.effects ?? []).forEach((e, ei) => {
        if (e.type === "remove_item" && !obtainableItems.has(e.itemId)) {
          err(`dialogues[${di}].choices[${ci}].effects[${ei}]`, `移除物品「${e.itemId}」，但這個物品沒有任何取得方式（台詞與道具狀態不一致）`);
        }
      }),
    ),
  );
  project.npcs.forEach((npc, i) =>
    (npc.dialogueVariants ?? []).forEach((v, vi) => {
      const problems = unmet(v.condition);
      if (problems.length) warn(`npcs[${i}].dialogueVariants[${vi}]`, `對話分支可能永遠不會出現：${problems.join("；")}`);
    }),
  );
}
