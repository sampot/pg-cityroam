/**
 * pg-cityroam 核心：街道區塊生成、玩家步進、員警巡邏、金幣／出口。
 * 純 ESM、無 DOM，方便單元測試。
 *
 * 地圖設計：
 * - 30×20 網格。橫向 4 條街道、縱向 3 條；街道為 ROAD，其餘為 BUILDING。
 * - 街道兩側沿機率放裝飾（TREE／LAMP／CAR）。
 * - 在 ROAD 上散佈 5–8 個金幣；玩家起點在左上角 ROAD。
 * - 員警選定一條 patrol path（沿道路水平或垂直往返）。
 * - 玩家收集完所有金幣 → 出口在角落 ROAD 出現 → 走過去即過關。
 */

export const TILE = 24;

// 圖塊類型（與 app.js 對應渲染）
export const ROAD = 0;
export const BUILDING = 1;
export const TREE = 2;
export const LAMP = 3;
export const BIN = 4;
export const CAR_RED = 5;
export const CAR_BLUE = 6;
export const COIN = 7;
export const EXIT = 8;
export const PLAYER = 9;
export const POLICE = 10;

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

/** 生成城市區塊。*/
export function generateCity(seed) {
  const rand = rng(seed);
  const w = 30;
  const h = 20;
  // 預設全部 BUILDING；街道以水平／垂直通道劃過
  const grid = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push(BUILDING);
    grid.push(row);
  }
  // 街道：5 條水平（y=4, 9, 14）+ 4 條垂直（x=5, 11, 18, 25）
  const horizRows = [4, 9, 14];
  const vertCols = [5, 11, 18, 25];
  for (const y of horizRows) {
    for (let x = 0; x < w; x++) grid[y][x] = ROAD;
  }
  for (const x of vertCols) {
    for (let y = 0; y < h; y++) grid[y][x] = ROAD;
  }
  // 在 ROAD 上散佈裝飾（樹、燈、垃圾箱、停車車）
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x] !== ROAD) continue;
      const r = rand();
      // 路口偏好樹
      const atIntersection = horizRows.includes(y) && vertCols.includes(x);
      if (atIntersection) {
        if (r < 0.12) grid[y][x] = TREE;
        else if (r < 0.18) grid[y][x] = LAMP;
      } else {
        if (r < 0.06) grid[y][x] = TREE;
        else if (r < 0.10) grid[y][x] = LAMP;
        else if (r < 0.12) grid[y][x] = BIN;
        else if (r < 0.16) grid[y][x] = rand() < 0.5 ? CAR_RED : CAR_BLUE;
      }
    }
  }
  // 起點：左上角 ROAD
  const start = { x: 0, y: horizRows[0] };
  // 員警：右下角 ROAD
  const policeStart = { x: w - 1, y: horizRows[horizRows.length - 1] };
  // 出口初始隱藏；收集完金幣後再放
  // 金幣：6 個，分散在 ROAD 上（避開起點、員警、可達的裝飾）
  const coins = [];
  let safety = 0;
  while (coins.length < 6 && safety < 400) {
    safety++;
    const x = ri(rand, 1, w - 1);
    const y = ri(rand, 1, h - 1);
    if (grid[y][x] !== ROAD) continue;
    if (x === start.x && y === start.y) continue;
    if (x === policeStart.x && y === policeStart.y) continue;
    if (coins.some((c) => c.x === x && c.y === y)) continue;
    coins.push({ x, y, taken: false });
  }
  return {
    seed,
    w,
    h,
    grid,
    player: { x: start.x, y: start.y, hp: 3, maxHp: 3, gold: 0 },
    police: {
      x: policeStart.x,
      y: policeStart.y,
      dir: 0, // 0=right, 1=down, 2=left, 3=up
      turnCooldown: 0,
    },
    coins,
    exit: null, // null until all coins collected
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
  if (t === BUILDING) return { blocked: true };
  // 走到出口 → 過關
  if (d.exit && d.exit.x === nx && d.exit.y === ny) {
    d.player.x = nx;
    d.player.y = ny;
    d.state = "won";
    return { moved: true, win: true };
  }
  d.player.x = nx;
  d.player.y = ny;
  // 金幣
  const c = d.coins.find((c) => !c.taken && c.x === nx && c.y === ny);
  if (c) {
    c.taken = true;
    d.player.gold += 1;
    d.log.unshift({ kind: "coin", text: "撿到 1 金幣" });
    // 全部撿完 → 放出口在角落
    if (d.coins.every((c) => c.taken) && !d.exit) {
      d.exit = { x: d.w - 1, y: 0 };
      // 確保出口格是 ROAD；若被裝飾佔用，移到最近的 ROAD
      if (d.grid[d.exit.y][d.exit.x] !== ROAD) {
        // 沿第 1 條街道找最近 ROAD
        for (let x = d.w - 1; x >= 0; x--) {
          if (d.grid[d.exit.y][x] === ROAD) { d.exit.x = x; break; }
        }
      }
      d.grid[d.exit.y][d.exit.x] = EXIT;
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
  else if (d.grid[ny][nx] !== ROAD && d.grid[ny][nx] !== EXIT) blocked = true;
  else if (d.coins.some((c) => !c.taken && c.x === nx && c.y === ny)) blocked = true;
  // 撞到玩家
  if (!blocked && nx === d.player.x && ny === d.player.y) {
    blocked = true; // 不會走進玩家那一格（先停下）
  }
  if (blocked) {
    // 隨機轉向（避開當前方向反向）
    const choices = [0, 1, 2, 3].filter((i) => i !== (p.dir + 2) % 4);
    p.dir = choices[Math.floor(Math.random() * choices.length)];
    p.turnCooldown = 2;
    return;
  }
  p.x = nx;
  p.y = ny;
  // 撞到玩家（玩家走到員警同格）
  if (p.x === d.player.x && p.y === d.player.y) {
    policeCatch(d);
  }
}

/** 員警抓到玩家：扣 HP，0 時死亡；玩家彈回最近 ROAD。*/
function policeCatch(d) {
  d.player.hp -= 1;
  d.log.unshift({ kind: "catch", text: `被員警撞到！剩 ${d.player.hp}/${d.player.maxHp} HP` });
  if (d.player.hp <= 0) {
    d.state = "caught";
    return;
  }
  // 員警讓開，玩家彈到鄰近 ROAD
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  for (const { dx, dy } of dirs) {
    const nx = d.player.x + dx;
    const ny = d.player.y + dy;
    if (nx < 0 || ny < 0 || nx >= d.w || ny >= d.h) continue;
    if (d.grid[ny][nx] !== ROAD) continue;
    d.player.x = nx;
    d.player.y = ny;
    // 員警推回 1 格
    const px = d.police.x - dx;
    const py = d.police.y - dy;
    if (px >= 0 && py >= 0 && px < d.w && py < d.h && d.grid[py][px] === ROAD) {
      d.police.x = px;
      d.police.y = py;
    }
    return;
  }
}

/** 計算剩餘金幣數。*/
export function coinsRemaining(d) {
  return d.coins.filter((c) => !c.taken).length;
}
export function coinsTotal(d) {
  return d.coins.length;
}

export const VIEW_W = 18 * TILE;
export const VIEW_H = 12 * TILE;