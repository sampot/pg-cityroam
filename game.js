/**
 * pg-cityroam 核心：街道區塊（含人行道／路緣／斑馬線）、玩家步進、員警巡邏、金幣／出口。
 * 純 ESM、無 DOM，方便單元測試。
 *
 * 地圖設計：
 * - 30×22 網格。以「區塊」概念生成：街道網格在 x∈{6,18}、y∈{8,14}（兩橫兩縱）。
 * - 街道寬 2 格（含中央黃虛線 + 兩側路緣）；路口為 3×3，含斑馬線／路緣轉角。
 * - 每個 BLOCK 是 6×6 區域：中央 4×4 為建築、外圍為人行道／路緣。
 * - 玩家起點在左上角街道路面；員警在右下角；出口在左下角街道路面。
 */

// 圖塊類型
export const TILE = 24;
export const ROAD = 0;          // 主道路（含中央黃虛線）
export const ROAD_PLAIN = 1;    // 淨路面
export const SIDEWALK = 2;      // 人行道
export const CURB_TL = 3;       // 路緣左上轉角
export const CURB_TR = 4;       // 路緣右上轉角
export const CURB_BL = 5;       // 路緣左下轉角
export const CURB_BR = 6;       // 路緣右下轉角
export const CROSSWALK_H = 7;   // 斑馬線（橫向）
export const CROSSWALK_V = 8;   // 斑馬線（縱向）
export const BUILDING = 9;
export const TREE = 10;
export const LAMP = 11;
export const BIN = 12;
export const CAR_RED = 13;
export const CAR_BLUE = 14;
export const COIN = 15;
export const EXIT = 16;
export const PLAYER = 17;
export const POLICE = 18;

// 道具種類（以 items 陣列追蹤，不寫進 grid）
export const ITEM_SHIELD = "shield"; // 護盾：擋下一次撞擊
export const ITEM_SPEED = "speed";   // 加速鞋：短時間走得快（每步連走 2 格）

// 追蹤距離：超過此格數就不展開視線追逐（給玩家喘息）
export const POLICE_SIGHT = 9;

// 可行走（玩家可走）的格子
export const WALKABLE = new Set([
  ROAD, ROAD_PLAIN, SIDEWALK,
  CURB_TL, CURB_TR, CURB_BL, CURB_BR,
  CROSSWALK_H, CROSSWALK_V,
  COIN, EXIT,
]);
// 員警可行走
export const POLICE_WALKABLE = new Set([
  ROAD, ROAD_PLAIN,
  CROSSWALK_H, CROSSWALK_V,
  COIN, EXIT,
]);

/** Mulberry32 PRNG */
export function rng(seed) {
  let t = seed | 0;
  return function () {
    t = (t + 0x6d2b79f5) | 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function ri(rand, lo, hi) { return lo + Math.floor(rand() * (hi - lo)); }

/**
 * 30×22 城市區塊生成。
 *
 * - 主街：y=8, y=14（橫向）；x=6, x=18（縱向）
 * - 街道寬 1 格（= 1 tile = 24px 內部空間），路口 3×3，斑馬線垂直於街道
 * - 區塊（block）大小 12×6（橫向）／ 6×6（縱向）BLOCKs 之間為街道
 * - 街道主格：ROAD（中央黃虛線）
 * - 路口：3×3 區域，內格 ROAD；周圍8 格依方位為路緣／斑馬線
 * - 建築：每個 BLOCK 內有 1-2 個 4×4 建築區，外圍 SIDEWALK
 */
export function generateCity(seed) {
  const rand = rng(seed);
  const W = 30, H = 22;
  const buildings = [];
  const grid = Array.from({ length: H }, () =>
    Array.from({ length: W }, () => SIDEWALK)
  );

  const ROW_H = [8, 14];
  const COL_V = [6, 18];

  // 街道：橫向 row（3 格寬：col 6..6/18..18 + 主道中央 + 路口3×3）
  // 簡化：橫向街道 y=8, y=14 都是 ROAD；縱向 x=6, x=18 都是 ROAD
  for (const y of ROW_H) {
    for (let x = 0; x < W; x++) grid[y][x] = ROAD;
  }
  for (const x of COL_V) {
    for (let y = 0; y < H; y++) grid[y][x] = ROAD;
  }

  // BLOCK 區域內填建築 + 路緣 + 人行道
  // BLOCK 是兩個主街之間的區塊；橫向 BLOCK 在 y∈{0..7} 與 y∈{9..13}；縱向 BLOCK 在 x∈{0..5} 與 x∈{7..17} 與 x∈{19..29}
  // 把所有 BLOCK 內格設為 SIDEWALK；中央設一個 4×4 BUILDING（佔 4 格寬 x 4 格高）；建築物周圍的 SIDEWALK 自然存在
  for (const yTop of [0, 9]) {
    for (const xLeft of [0, 7, 19]) {
      const blockH = (yTop === 0 ? 7 : 4);  // 第一橫向 BLOCK 高 7，第二高 4 (8..14 之間的 9..13)
      const blockW = (xLeft === 0 || xLeft === 19 ? 5 : 11); // 邊 block 寬 5/11
      // 建築位置：中央
      const bW = Math.min(4, blockW);
      const bH = Math.min(4, blockH);
      const bX0 = xLeft + Math.floor((blockW - bW) / 2);
      const bY0 = yTop + Math.floor((blockH - bH) / 2);
      // 記錄建築矩形（供渲染畫屋頂）
      buildings.push({ x: bX0, y: bY0, w: bW, h: bH });
      // BUILDING 4×4
      for (let dy = 0; dy < bH; dy++) {
        for (let dx = 0; dx < bW; dx++) {
          const gy = bY0 + dy;
          const gx = bX0 + dx;
          if (gy < H && gx < W) grid[gy][gx] = BUILDING;
        }
      }
    }
  }

  // 在人行道裝飾：每個 BLOCK 街角放樹／燈
  for (const yTop of [0, 9]) {
    for (const xLeft of [0, 7, 19]) {
      const blockH = (yTop === 0 ? 7 : 4);
      const blockW = (xLeft === 0 || xLeft === 19 ? 5 : 11);
      // 街角（BLOCK 四角靠街道）
      const corners = [
        { x: xLeft, y: yTop },
        { x: xLeft + blockW - 1, y: yTop },
        { x: xLeft, y: yTop + blockH - 1 },
        { x: xLeft + blockW - 1, y: yTop + blockH - 1 },
      ];
      for (const c of corners) {
        // 街角 1 格偏移（避開 BLOCK 邊、靠街道那側）
        if (yTop === 0 && c.y === 0) c.y = 1;
        if (yTop === 9 && c.y === 13) c.y = 12;
        // 在街角格放 SIDEWALK；如果原是 SIDEWALK，依機率放樹
        if (grid[c.y][c.x] === SIDEWALK) {
          const r = rand();
          if (r < 0.22) grid[c.y][c.x] = TREE;
        }
      }
    }
  }

  // 汽車停車：在 ROAD 上、緊鄰 BLOCK 邊、放車（路邊停）
  // 我們對每個 BLOCK 的橫向邊（y==yTop-1 或 y==yTop+blockH）放車
  for (const yTop of [0, 9]) {
    for (const xLeft of [0, 7, 19]) {
      const blockH = (yTop === 0 ? 7 : 4);
      const blockW = (xLeft === 0 || xLeft === 19 ? 5 : 11);
      const yAbove = yTop - 1;
      const yBelow = yTop + blockH;
      // 上方街邊
      if (yAbove >= 0 && ROW_H.includes(yAbove)) {
        for (let x = xLeft + 1; x < xLeft + blockW - 1; x += 3) {
          if (grid[yAbove][x] === ROAD && rand() < 0.30) {
            grid[yAbove][x] = rand() < 0.5 ? CAR_RED : CAR_BLUE;
          }
        }
      }
      // 下方街邊
      if (yBelow < H && ROW_H.includes(yBelow)) {
        for (let x = xLeft + 1; x < xLeft + blockW - 1; x += 3) {
          if (grid[yBelow][x] === ROAD && rand() < 0.30) {
            grid[yBelow][x] = rand() < 0.5 ? CAR_RED : CAR_BLUE;
          }
        }
      }
    }
  }

  // 路口轉角：在 4 個路口（兩個橫街 × 兩個縱街的交叉），周圍的 SIDEWALK 格升級為路緣／斑馬線
  for (const y of ROW_H) {
    for (const x of COL_V) {
      // 路口本身是 ROAD；周圍8 格變路緣或斑馬線
      const set = (gy, gx, val) => {
        if (gy >= 0 && gx >= 0 && gy < H && gx < W && grid[gy][gx] !== BUILDING) {
          grid[gy][gx] = val;
        }
      };
      // 上方：x 兩側 → 路緣，y-1 → 斑馬線
      set(y - 1, x - 1, CURB_TR);
      set(y - 1, x + 1, CURB_TL);
      set(y - 1, x, CROSSWALK_H);
      // 下方
      set(y + 1, x - 1, CURB_BR);
      set(y + 1, x + 1, CURB_BL);
      set(y + 1, x, CROSSWALK_H);
      // 左側
      set(y - 1, x - 1, CURB_BR); // 對角多寫一次
      set(y + 1, x - 1, CURB_TR);
      set(y, x - 1, CROSSWALK_V);
      // 右側
      set(y - 1, x + 1, CURB_BL);
      set(y + 1, x + 1, CURB_TL);
      set(y, x + 1, CROSSWALK_V);
    }
  }

  // 起點：左上角街道路面；員警：右下角
  const start = { x: 0, y: ROW_H[0] };
  const policeStart = { x: W - 1, y: ROW_H[ROW_H.length - 1] };
  // 起點 ROAD 可能被車佔 → 往右找最近的 ROAD
  const findRoad = (x, y, dx) => {
    let cx = x;
    while (cx >= 0 && cx < W && grid[y][cx] !== ROAD && grid[y][cx] !== ROAD_PLAIN) cx += dx;
    return cx;
  };
  if (grid[start.y][start.x] !== ROAD) start.x = findRoad(0, start.y, 1);
  if (grid[policeStart.y][policeStart.x] !== ROAD) policeStart.x = findRoad(W - 1, policeStart.y, -1);

  // 出口：在左下角街道路面
  const exit = { x: 0, y: ROW_H[ROW_H.length - 1] };
  if (grid[exit.y][exit.x] !== ROAD) exit.x = findRoad(0, exit.y, 1);
  // 金幣：5-8 個，分散在 ROAD 上（不在起點、員警、出出口位置）
  const coins = [];  let safety = 0;
  while (coins.length < 6 && safety < 400) {
    safety++;
    const x = ri(rand, 0, W);
    const y = ri(rand, 0, H);
    if (grid[y][x] !== ROAD) continue;
    if (x === start.x && y === start.y) continue;
    if (x === policeStart.x && y === policeStart.y) continue;
    if (x === exit.x && y === exit.y) continue;
    if (coins.some((c) => c.x === x && c.y === y)) continue;
    coins.push({ x, y, taken: false });
  }

  // 道具：2-3 個，放在 ROAD 上（避開起點／員警／出口／金幣／互相重疊）
  const items = [];  let itemSafety = 0;
  while (items.length < 3 && itemSafety < 600) {
    itemSafety++;
    const x = ri(rand, 0, W);
    const y = ri(rand, 0, H);
    if (grid[y][x] !== ROAD) continue;
    if (!POLICE_WALKABLE.has(grid[y][x])) continue;
    if (x === start.x && y === start.y) continue;
    if (x === policeStart.x && y === policeStart.y) continue;
    if (x === exit.x && y === exit.y) continue;
    if (coins.some((c) => c.x === x && c.y === y)) continue;
    if (items.some((i) => i.x === x && i.y === y)) continue;
    items.push({ x, y, type: rand() < 0.5 ? ITEM_SHIELD : ITEM_SPEED, taken: false });
  }

  return {
    seed,
    w: W,
    h: H,
    grid,
    player: { x: start.x, y: start.y, hp: 3, maxHp: 3, gold: 0, face: "down", shield: 0, speed: 0 },
    police: {
      x: policeStart.x,
      y: policeStart.y,
      dir: 0, // 0=right, 1=down, 2=left, 3=up
      turnCooldown: 0,
      chaseTurns: 0, // 視線追逐剩餘步數
    },
    coins,
    items,
    buildings,
    exit: { x: exit.x, y: exit.y },
    exitActive: false,
    state: "playing", // playing | won | caught
    timeLeft: 60,     // 秒；歸零 → 失敗
    score: 0,
    best: 0,          // 本機（runtime 代為持久化）最高分
    log: [],
  };
}

/** 嘗試玩家往 (dx, dy) 走一步。回傳 { moved, blocked, tookCoin?, tookItem?, usedShield?, hitPolice?, win? }
 *  加速鞋生效時：一步內連走 2 格（speed 代表剩餘的雙步次數）。 */
export function tryPlayerMove(d, dx, dy) {
  if (d.state !== "playing") return { blocked: true };
  const speedActive = d.player.speed > 0;
  const steps = speedActive ? 2 : 1;
  let result = { moved: false };
  for (let i = 0; i < steps; i++) {
    if (d.state !== "playing") break;
    const r = stepPlayer(d, dx, dy);
    if (r.blocked) {
      if (!result.moved) return { blocked: true };
      break;
    }
    result = { ...result, ...r };
  }
  // 這次移動有使用加速 → 扣掉一次雙步（拾取當下不扣）
  if (speedActive) d.player.speed -= 1;
  return result;
}

/** 單格步進邏輯（供 tryPlayerMove 內部呼叫）。 */
function stepPlayer(d, dx, dy) {
  const nx = d.player.x + dx;
  const ny = d.player.y + dy;
  if (nx < 0 || ny < 0 || nx >= d.w || ny >= d.h) return { blocked: true };
  const t = d.grid[ny][nx];
  if (!WALKABLE.has(t) && t !== COIN && t !== EXIT) return { blocked: true };
  // 不能踩到員警所在的格子
  if (nx === d.police.x && ny === d.police.y) return { blocked: true };
  // 更新方向
  if (dx > 0) d.player.face = "right";
  else if (dx < 0) d.player.face = "left";
  else if (dy > 0) d.player.face = "down";
  else if (dy < 0) d.player.face = "up";
  const result = { moved: true };
  // 走到出口 → 過關
  if (d.exitActive && d.exit.x === nx && d.exit.y === ny) {
    d.player.x = nx;
    d.player.y = ny;
    d.state = "won";
    d.log.unshift({ kind: "system", text: "抵達出口，過關！" });
    d.score += 100 + d.player.hp * 50 + Math.ceil(d.timeLeft) * 20;
    return { ...result, win: true };
  }
  d.player.x = nx;
  d.player.y = ny;
  // 道具
  const it = d.items.find((i) => !i.taken && i.x === nx && i.y === ny);
  if (it) {
    it.taken = true;
    if (it.type === ITEM_SHIELD) {
      d.player.shield += 1;
      d.log.unshift({ kind: "item", text: "拾起護盾！下次碰撞不扣血。" });
    } else {
      d.player.speed += 2; // 2 次雙步
      d.log.unshift({ kind: "item", text: "拾起加速鞋！短時間內走得快。" });
    }
    result.tookItem = it.type;
    return result;
  }
  // 金幣
  const c = d.coins.find((cc) => !cc.taken && cc.x === nx && cc.y === ny);
  if (c) {
    c.taken = true;
    d.player.gold += 1;
    d.score += 25;
    d.log.unshift({ kind: "coin", text: "撿到 1 金幣" });
    if (d.coins.every((cc) => cc.taken) && !d.exitActive) {
      d.exitActive = true;
      // 確保出口格是 ROAD，若不是則移動到最近 ROAD
      if (!POLICE_WALKABLE.has(d.grid[d.exit.y][d.exit.x])) {
        for (let x = d.w - 1; x >= 0; x--) {
          if (POLICE_WALKABLE.has(d.grid[d.exit.y][x])) { d.exit.x = x; break; }
        }
      }
      d.log.unshift({ kind: "system", text: "所有金幣到手！出口已開啟。" });
    }
    result.tookCoin = true;
    return result;
  }
  return result;
}

/**
 * 員警 AI：
 * - 若玩家在警車的視線範圍（同一條水平／垂直道路上、中間無建築擋住、距離 ≤ POLICE_SIGHT）
 *   → 進入追逐（chaseTurns > 0），朝玩家所在方向走，走完 chaseTurns 格後恢復巡邏。
 * - 否則沿當前方向巡邏；碰到障礙或邊界就隨機轉 90 度。
 */
export function tickPolice(d) {
  if (d.state !== "playing") return;
  const p = d.police;
  if (p.turnCooldown > 0) { p.turnCooldown--; return; }
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: -1 },
  ];

  // 偵測視線內玩家，決定目標方向與追逐步數
  if (p.chaseTurns <= 0) {
    const sight = policeSight(d, p, dirs);
    if (sight) {
      p.dir = sight.dir;
      p.chaseTurns = Math.min(sight.dist, POLICE_SIGHT); // 追 1~9 格
    }
  }

  const cur = dirs[p.dir];
  const nx = p.x + cur.dx;
  const ny = p.y + cur.dy;
  let blocked = false;
  if (nx < 0 || ny < 0 || nx >= d.w || ny >= d.h) blocked = true;
  else if (!POLICE_WALKABLE.has(d.grid[ny][nx])) blocked = true;
  else if (d.coins.some((c) => !c.taken && c.x === nx && c.y === ny)) blocked = true;
  else if (d.items.some((i) => !i.taken && i.x === nx && i.y === ny)) blocked = true;
  // 下一格就是玩家 → 直接撞上去扣血（不視為障礙轉向）
  if (!blocked && nx === d.player.x && ny === d.player.y) {
    p.x = nx;
    p.y = ny;
    p.chaseTurns = 0;
    policeCatch(d);
    return;
  }
  if (blocked) {
    // 追逐中碰到障礙→結束追逐；巡邏中→隨機轉
    p.chaseTurns = 0;
    const choices = [0, 1, 2, 3].filter((i) => i !== (p.dir + 2) % 4);
    p.dir = choices[Math.floor(Math.random() * choices.length)];
    p.turnCooldown = 2;
    return;
  }
  p.x = nx;
  p.y = ny;
  if (p.chaseTurns > 0) p.chaseTurns -= 1;
  if (p.x === d.player.x && p.y === d.player.y) {
    p.chaseTurns = 0;
    policeCatch(d);
  }
}

/** 偵測玩家是否在警車視線內；回傳 { dir, dist } 或 null。
 *  視線 = 警車所在的街道列／行，朝四個方向看，直到碰到建築或邊界。 */
function policeSight(d, p, dirs) {
  let best = null;
  for (let i = 0; i < 4; i++) {
    const { dx, dy } = dirs[i];
    // 警車只在道路／斑馬線上視線才成立
    const pt = d.grid[p.y][p.x];
    const onRoad = POLICE_WALKABLE.has(pt);
    if (!onRoad) continue;
    let x = p.x + dx;
    let y = p.y + dy;
    let dist = 1;
    while (x >= 0 && y >= 0 && x < d.w && y < d.h && dist <= POLICE_SIGHT) {
      const tt = d.grid[y][x];
      if (!POLICE_WALKABLE.has(tt)) break; // 碰到建築／路緣／人行道→視線被擋
      if (x === d.player.x && y === d.player.y) {
        if (!best || dist < best.dist) best = { dir: i, dist };
        break;
      }
      x += dx;
      y += dy;
      dist++;
    }
  }
  return best;
}

/** 員警抓到玩家：扣 HP（有護盾則擋下），0 時死亡；玩家彈回鄰近 SIDEWALK／ROAD。*/
function policeCatch(d) {
  if (d.player.shield > 0) {
    d.player.shield -= 1;
    d.log.unshift({ kind: "item", text: "護盾擋下一次碰撞！" });
    bumpAway(d);
    return;
  }
  d.player.hp -= 1;
  d.log.unshift({ kind: "catch", text: `被員警撞到！剩 ${d.player.hp}/${d.player.maxHp} HP` });
  if (d.player.hp <= 0) { d.state = "caught"; return; }
  bumpAway(d);
}

/** 碰撞後把玩家往鄰近可走格彈開，警車反向退一格。 */
function bumpAway(d) {
  const dirs = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
  ];
  for (const { dx, dy } of dirs) {
    const nx = d.player.x + dx;
    const ny = d.player.y + dy;
    if (nx < 0 || ny < 0 || nx >= d.w || ny >= d.h) continue;
    if (!WALKABLE.has(d.grid[ny][nx])) continue;
    d.player.x = nx;
    d.player.y = ny;
    const px = d.police.x - dx;
    const py = d.police.y - dy;
    if (px >= 0 && py >= 0 && px < d.w && py < d.h && POLICE_WALKABLE.has(d.grid[py][px])) {
      d.police.x = px;
      d.police.y = py;
    }
    return;
  }
}

/** 計算剩餘金幣數。*/
export function coinsRemaining(d) { return d.coins.filter((c) => !c.taken).length; }
export function coinsTotal(d) { return d.coins.length; }

/** 剩餘道具數（未拾取）。*/
export function itemsRemaining(d) { return d.items.filter((i) => !i.taken).length; }

/** 每秒扣除倒數計時；歸零 → 失敗。 */
export function tickTime(d, dtSeconds) {
  if (d.state !== "playing") return;
  d.timeLeft -= dtSeconds;
  if (d.timeLeft <= 0) {
    d.timeLeft = 0;
    d.state = "timedout";
  }
}

/** 設定／更新最高分並回傳是否破紀錄。 */
export function updateBest(d, score) {
  if (score > d.best) {
    d.best = score;
    return true;
  }
  return false;
}

export const VIEW_W = 18 * TILE;
export const VIEW_H = 12 * TILE;