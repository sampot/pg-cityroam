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

  return {
    seed,
    w: W,
    h: H,
    grid,
    player: { x: start.x, y: start.y, hp: 3, maxHp: 3, gold: 0, face: "down" },
    police: {
      x: policeStart.x,
      y: policeStart.y,
      dir: 0, // 0=right, 1=down, 2=left, 3=up
      turnCooldown: 0,
    },
    coins,
    buildings,
    exit: { x: exit.x, y: exit.y },
    exitActive: false,
    state: "playing", // playing | won | caught
    log: [],
  };
}

/** 嘗試玩家往 (dx, dy) 走一步。回傳 { moved, blocked, tookCoin?, hitPolice?, win? } */
export function tryPlayerMove(d, dx, dy) {
  if (d.state !== "playing") return { blocked: true };
  const nx = d.player.x + dx;
  const ny = d.player.y + dy;
  if (nx < 0 || ny < 0 || nx >= d.w || ny >= d.h) return { blocked: true };
  const t = d.grid[ny][nx];
  if (!WALKABLE.has(t) && t !== COIN && t !== EXIT) return { blocked: true };
  // 更新方向
  if (dx > 0) d.player.face = "right";
  else if (dx < 0) d.player.face = "left";
  else if (dy > 0) d.player.face = "down";
  else if (dy < 0) d.player.face = "up";
  // 走到出口 → 過關
  if (d.exitActive && d.exit.x === nx && d.exit.y === ny) {
    d.player.x = nx;
    d.player.y = ny;
    d.state = "won";
    return { moved: true, win: true };
  }
  d.player.x = nx;
  d.player.y = ny;
  // 金幣
  const c = d.coins.find((cc) => !cc.taken && cc.x === nx && cc.y === ny);
  if (c) {
    c.taken = true;
    d.player.gold += 1;
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
    return { moved: true, tookCoin: true };
  }
  return { moved: true };
}

/** 員警 AI：沿當前方向走；碰到障礙或邊界就隨機轉 90 度。*/
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
  const cur = dirs[p.dir];
  const nx = p.x + cur.dx;
  const ny = p.y + cur.dy;
  let blocked = false;
  if (nx < 0 || ny < 0 || nx >= d.w || ny >= d.h) blocked = true;
  else if (!POLICE_WALKABLE.has(d.grid[ny][nx])) blocked = true;
  else if (d.coins.some((c) => !c.taken && c.x === nx && c.y === ny)) blocked = true;
  if (!blocked && nx === d.player.x && ny === d.player.y) blocked = true;
  if (blocked) {
    const choices = [0, 1, 2, 3].filter((i) => i !== (p.dir + 2) % 4);
    p.dir = choices[Math.floor(Math.random() * choices.length)];
    p.turnCooldown = 2;
    return;
  }
  p.x = nx;
  p.y = ny;
  if (p.x === d.player.x && p.y === d.player.y) policeCatch(d);
}

/** 員警抓到玩家：扣 HP，0 時死亡；玩家彈回鄰近 SIDEWALK／ROAD。*/
function policeCatch(d) {
  d.player.hp -= 1;
  d.log.unshift({ kind: "catch", text: `被員警撞到！剩 ${d.player.hp}/${d.player.maxHp} HP` });
  if (d.player.hp <= 0) { d.state = "caught"; return; }
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

export const VIEW_W = 18 * TILE;
export const VIEW_H = 12 * TILE;