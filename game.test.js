import { describe, it, expect } from "vitest";
import {
  rng,
  generateCity,
  tryPlayerMove,
  tickPolice,
  coinsRemaining,
  coinsTotal,
  ROAD,
  BUILDING,
  EXIT,
  PLAYER,
  POLICE,
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
  it("builds a 30x20 grid with roads and buildings", () => {
    const d = generateCity(7);
    expect(d.w).toBe(30);
    expect(d.h).toBe(20);
    expect(d.grid.length).toBe(20);
    expect(d.grid[0].length).toBe(30);
    expect(d.coins.length).toBeGreaterThan(0);
    expect(d.coins.length).toBeLessThanOrEqual(8);
    // 起點是 ROAD
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
    // 構造一個已知環境：玩家在 ROAD，右側是 BUILDING
    d.grid[d.player.y][d.player.x] = ROAD;
    d.grid[d.player.y][d.player.x + 1] = BUILDING;
    const before = { x: d.player.x, y: d.player.y };
    const r = tryPlayerMove(d, 1, 0);
    expect(r.blocked).toBe(true);
    expect(d.player.x).toBe(before.x);
    expect(d.player.y).toBe(before.y);
  });
  it("collects a coin when stepped on", () => {
    const d = generateCity(13);
    // 強制放一個金幣在玩家右邊
    d.grid[d.player.y][d.player.x + 1] = ROAD;
    d.coins = [{ x: d.player.x + 1, y: d.player.y, taken: false }];
    const beforeGold = d.player.gold;
    const r = tryPlayerMove(d, 1, 0);
    expect(r.moved).toBe(true);
    expect(r.tookCoin).toBe(true);
    expect(d.player.gold).toBe(beforeGold + 1);
    expect(coinsRemaining(d)).toBe(0);
    expect(d.exit).not.toBeNull();
  });
  it("opens exit at corner when all coins taken", () => {
    const d = generateCity(13);
    d.grid[d.player.y][d.player.x + 1] = ROAD;
    d.coins = [{ x: d.player.x + 1, y: d.player.y, taken: false }];
    tryPlayerMove(d, 1, 0);
    expect(d.exit).not.toBeNull();
    // 出口格已變 EXIT
    expect(d.grid[d.exit.y][d.exit.x]).toBe(EXIT);
  });
  it("stepping onto exit wins", () => {
    const d = generateCity(13);
    d.grid[d.player.y][d.player.x + 1] = ROAD;
    d.coins = [{ x: d.player.x + 1, y: d.player.y, taken: false }];
    tryPlayerMove(d, 1, 0);
    // 玩家現在在金幣處；把出口搬到玩家右側
    d.exit = { x: d.player.x + 1, y: d.player.y };
    d.grid[d.exit.y][d.exit.x] = EXIT;
    const r = tryPlayerMove(d, 1, 0);
    expect(r.win).toBe(true);
    expect(d.state).toBe("won");
  });
});

describe("tickPolice", () => {
  it("moves along current direction on road", () => {
    const d = generateCity(7);
    // 強制員警在純 ROAD 上向右走
    d.police.x = 5;
    d.police.y = 9;
    d.police.dir = 0;
    d.grid[d.police.y][d.police.x] = ROAD;
    d.grid[d.police.y][d.police.x + 1] = ROAD;
    // 玩家放遠
    d.player.x = 0;
    d.player.y = 0;
    const before = d.police.x;
    tickPolice(d);
    expect(d.police.x).toBe(before + 1);
  });
  it("changes direction when blocked", () => {
    const d = generateCity(7);
    d.police.x = 5;
    d.police.y = 9;
    d.police.dir = 0; // 向右
    d.police.turnCooldown = 0;
    d.grid[d.police.y][d.police.x] = ROAD;
    d.grid[d.police.y][d.police.x + 1] = BUILDING; // 右邊擋住
    d.player.x = 0;
    d.player.y = 0;
    // 先跑一輪：撞牆 → 方向應改變（不是反向）
    tickPolice(d);
    expect(d.police.dir).not.toBe(2); // 反向（dir 2）不會被選
    expect(d.police.turnCooldown).toBeGreaterThan(0);
    // 員警不會前進（冷卻中）
    const afterX = d.police.x;
    tickPolice(d);
    expect(d.police.x).toBe(afterX);
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