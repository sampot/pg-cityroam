import { describe, it, expect } from "vitest";
import {
  rng,
  generateCity,
  tryPlayerMove,
  tickPolice,
  tickTime,
  updateBest,
  coinsRemaining,
  coinsTotal,
  itemsRemaining,
  ITEM_SHIELD,
  ITEM_SPEED,
  ROAD,
  BUILDING,
  EXIT,
  COIN,
} from "./game.js";

describe("rng", () => {
  it("is deterministic", () => {
    const a = rng(42);
    const b = rng(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});

describe("generateCity", () => {
  it("builds a 30x22 grid with roads and buildings", () => {
    const d = generateCity(7);
    expect(d.w).toBe(30);
    expect(d.h).toBe(22);
    expect(d.grid.length).toBe(22);
    expect(d.grid[0].length).toBe(30);
    expect(d.coins.length).toBeGreaterThan(0);
    expect(d.coins.length).toBeLessThanOrEqual(8);
    expect(d.grid[d.player.y][d.player.x]).toBe(ROAD);
  });
  it("deterministic for same seed", () => {
    const a = generateCity(99);
    const b = generateCity(99);
    expect(a.coins.length).toBe(b.coins.length);
    expect(a.player.x).toBe(b.player.x);
    expect(a.player.y).toBe(b.player.y);
    expect(a.police.x).toBe(b.police.x);
    expect(a.police.y).toBe(b.police.y);
  });
  it("place coins on road only", () => {
    const d = generateCity(11);
    for (const c of d.coins) {
      expect(d.grid[c.y][c.x]).toBe(ROAD);
    }
  });
});

describe("tryPlayerMove", () => {
  it("blocks into building", () => {
    const d = generateCity(5);
    // 玩家右側放 BUILDING，驗證被擋
    d.grid[d.player.y][d.player.x + 1] = BUILDING;
    const before = { x: d.player.x, y: d.player.y };
    const r = tryPlayerMove(d, 1, 0);
    expect(r.blocked).toBe(true);
    expect(d.player.x).toBe(before.x);
    expect(d.player.y).toBe(before.y);
  });
  it("collects a coin when stepped on", () => {
    const d = generateCity(13);
    // 玩家右側必須是 ROAD（不是裝飾或人行道）；強制 ROAD 並放金幣
    d.grid[d.player.y][d.player.x + 1] = ROAD;
    d.coins = [{ x: d.player.x + 1, y: d.player.y, taken: false }];
    const beforeGold = d.player.gold;
    const r = tryPlayerMove(d, 1, 0);
    expect(r.moved).toBe(true);
    expect(r.tookCoin).toBe(true);
    expect(d.player.gold).toBe(beforeGold + 1);
    expect(coinsRemaining(d)).toBe(0);
    expect(d.exitActive).toBe(true);
  });
  it("opens exit when all coins taken", () => {
    const d = generateCity(13);
    expect(d.exitActive).toBe(false);
    d.grid[d.player.y][d.player.x + 1] = ROAD;
    d.coins = [{ x: d.player.x + 1, y: d.player.y, taken: false }];
    tryPlayerMove(d, 1, 0);
    expect(d.exitActive).toBe(true);
  });
  it("stepping onto exit wins", () => {
    const d = generateCity(13);
    d.grid[d.player.y][d.player.x + 1] = ROAD;
    d.coins = [{ x: d.player.x + 1, y: d.player.y, taken: false }];
    tryPlayerMove(d, 1, 0); // 收集金幣 → exitActive=true
    // 玩家現在在金幣處；把 exit 放到玩家右側並標 active
    d.exit = { x: d.player.x + 1, y: d.player.y };
    d.grid[d.exit.y][d.exit.x] = EXIT;
    const r = tryPlayerMove(d, 1, 0);
    expect(r.win).toBe(true);
    expect(d.state).toBe("won");
  });
  it("sets face direction", () => {
    const d = generateCity(13);
    d.grid[d.player.y][d.player.x + 1] = ROAD;
    tryPlayerMove(d, 1, 0);
    expect(d.player.face).toBe("right");
    d.grid[d.player.y][d.player.x + 1] = ROAD;
    tryPlayerMove(d, -1, 0);
    expect(d.player.face).toBe("left");
  });
  it("blocks moving onto the police tile", () => {
    const d = generateCity(13);
    d.grid[d.player.y][d.player.x + 1] = ROAD;
    d.police.x = d.player.x + 1;
    d.police.y = d.player.y;
    const before = { x: d.player.x, y: d.player.y };
    const r = tryPlayerMove(d, 1, 0);
    expect(r.blocked).toBe(true);
    expect(d.player.x).toBe(before.x);
    expect(d.player.y).toBe(before.y);
  });
});

describe("tickPolice", () => {
  it("moves along current direction on road", () => {
    const d = generateCity(7);
    // 把員警放到縱向道路上（x=6 是縱向 ROAD）
    d.police.x = 6;
    d.police.y = 1;
    d.police.dir = 1; // down
    d.grid[1][6] = ROAD;
    d.grid[2][6] = ROAD;
    // 玩家放遠
    d.player.x = 0;
    d.player.y = 0;
    const before = d.police.y;
    tickPolice(d);
    expect(d.police.y).toBe(before + 1);
  });
  it("changes direction when blocked", () => {
    const d = generateCity(7);
    d.police.x = 5;
    d.police.y = 8;
    d.police.dir = 0; // right
    d.police.turnCooldown = 0;
    d.grid[d.police.y][d.police.x] = ROAD;
    d.grid[d.police.y][d.police.x + 1] = BUILDING; // right blocked
    d.player.x = 0;
    d.player.y = 0;
    tickPolice(d);
    expect(d.police.dir).not.toBe(2); // not reverse
    expect(d.police.turnCooldown).toBeGreaterThan(0);
    const afterX = d.police.x;
    tickPolice(d);
    expect(d.police.x).toBe(afterX);
  });
  it("catches the player when moving onto their tile (deducts HP)", () => {
    const d = generateCity(7);
    // 員警沿右走，下一格就是玩家所在 → 應撞上扣血
    d.police.x = 3;
    d.police.y = 8;
    d.police.dir = 0; // right
    d.police.turnCooldown = 0;
    d.player.x = 4;
    d.player.y = 8;
    d.grid[8][3] = ROAD;
    d.grid[8][4] = ROAD;
    const hpBefore = d.player.hp;
    tickPolice(d);
    expect(d.player.hp).toBe(hpBefore - 1);
    expect(d.state).toBe("playing");
  });
  it("fails after 3 catches (HP reaches 0)", () => {
    const d = generateCity(7);
    d.player.hp = 1;
    d.police.x = 3;
    d.police.y = 8;
    d.police.dir = 0; // right
    d.police.turnCooldown = 0;
    d.player.x = 4;
    d.player.y = 8;
    d.grid[8][3] = ROAD;
    d.grid[8][4] = ROAD;
    tickPolice(d);
    expect(d.state).toBe("caught");
  });
});

describe("coins helpers", () => {
  it("total/remaining track", () => {
    const d = generateCity(3);
    const total = coinsTotal(d);
    expect(coinsRemaining(d)).toBe(total);
    d.coins[0].taken = true;
    expect(coinsRemaining(d)).toBe(total - 1);
  });
});

describe("items / power-ups", () => {
  it("generates items on road", () => {
    const d = generateCity(11);
    expect(d.items.length).toBeGreaterThan(0);
    for (const it of d.items) {
      expect(d.grid[it.y][it.x]).toBe(ROAD);
    }
  });
  it("picks up a shield and grants protection", () => {
    const d = generateCity(13);
    d.grid[d.player.y][d.player.x + 1] = ROAD;
    d.items = [{ x: d.player.x + 1, y: d.player.y, type: ITEM_SHIELD, taken: false }];
    const r = tryPlayerMove(d, 1, 0);
    expect(r.tookItem).toBe(ITEM_SHIELD);
    expect(d.player.shield).toBe(1);
    expect(itemsRemaining(d)).toBe(0);
  });
  it("speed item grants double-step", () => {
    const d = generateCity(13);
    d.grid[d.player.y][d.player.x + 1] = ROAD;
    d.grid[d.player.y][d.player.x + 2] = ROAD;
    d.items = [{ x: d.player.x + 1, y: d.player.y, type: ITEM_SPEED, taken: false }];
    const r = tryPlayerMove(d, 1, 0);
    expect(r.tookItem).toBe(ITEM_SPEED);
    expect(d.player.speed).toBe(2);
    // 下一格加速雙步：一次 tryPlayerMove 走 2 格
    const before = d.player.x;
    tryPlayerMove(d, 1, 0);
    expect(d.player.x).toBe(before + 2);
  });
  it("shield blocks police collision without HP loss", () => {
    const d = generateCity(7);
    d.player.shield = 1;
    d.police.x = 3;
    d.police.y = 8;
    d.police.dir = 0;
    d.police.turnCooldown = 0;
    d.player.x = 4;
    d.player.y = 8;
    d.grid[8][3] = ROAD;
    d.grid[8][4] = ROAD;
    const hpBefore = d.player.hp;
    tickPolice(d);
    expect(d.player.hp).toBe(hpBefore);
    expect(d.player.shield).toBe(0);
    expect(d.state).toBe("playing");
  });
});

describe("police line-of-sight chase", () => {
  it("chases player within sight on the same road", () => {
    const d = generateCity(7);
    // 員警在 y=8 的行，玩家同一行右側 3 格，中間皆 ROAD
    d.grid[8][3] = ROAD;
    d.grid[8][4] = ROAD;
    d.grid[8][5] = ROAD;
    d.grid[8][6] = ROAD;
    d.police.x = 3;
    d.police.y = 8;
    d.police.dir = 0;
    d.police.turnCooldown = 0;
    d.player.x = 6;
    d.player.y = 8;
    tickPolice(d);
    expect(d.police.x).toBe(4); // 朝玩家追一格
    expect(d.police.chaseTurns).toBeGreaterThan(0);
  });
  it("does not chase through a building (LOS blocked)", () => {
    const d = generateCity(7);
    d.grid[8][3] = ROAD;
    d.grid[8][4] = BUILDING; // 擋住視線
    d.grid[8][5] = ROAD;
    d.police.x = 3;
    d.police.y = 8;
    d.police.dir = 0;
    d.police.turnCooldown = 0;
    d.player.x = 6;
    d.player.y = 8;
    d.police.chaseTurns = 0;
    // 前方被建築擋住 → 轉向而非朝玩家追
    tickPolice(d);
    expect(d.police.x).toBe(3); // 沒移動
  });
});

describe("timer / time", () => {
  it("counts down and times out at 0", () => {
    const d = generateCity(5);
    d.timeLeft = 0.4;
    tickTime(d, 0.5);
    expect(d.state).toBe("timedout");
    expect(d.timeLeft).toBe(0);
  });
  it("does not tick after timeout", () => {
    const d = generateCity(5);
    d.timeLeft = 3;
    tickTime(d, 10);
    expect(d.state).toBe("timedout");
    d.timeLeft = 5;
    tickTime(d, 1);
    expect(d.timeLeft).toBe(5); // 已結束不再扣
  });
});

describe("score", () => {
  it("updateBest tracks best", () => {
    const d = generateCity(5);
    updateBest(d, 100);
    expect(d.best).toBe(100);
    expect(updateBest(d, 50)).toBe(false);
    expect(d.best).toBe(100);
    expect(updateBest(d, 150)).toBe(true);
    expect(d.best).toBe(150);
  });
  it("winning awards score from HP and time", () => {
    const d = generateCity(13);
    d.grid[d.player.y][d.player.x + 1] = ROAD;
    d.coins = [{ x: d.player.x + 1, y: d.player.y, taken: false }];
    tryPlayerMove(d, 1, 0); // 收金幣 → exitActive
    d.exit = { x: d.player.x + 1, y: d.player.y };
    d.grid[d.exit.y][d.exit.x] = EXIT;
    d.timeLeft = 30;
    d.player.hp = 3;
    const r = tryPlayerMove(d, 1, 0);
    expect(r.win).toBe(true);
    expect(d.score).toBe(25 + 100 + 3 * 50 + Math.ceil(30) * 20);
  });
});