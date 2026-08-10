/**
 * pg-cityroam 主程式：Canvas 渲染、輸入、玩家步進、員警巡邏、HUD。
 *
 * 輸入：
 * - WASD／方向鍵
 * - 觸控 ◀▲▼▶ 右下按鈕
 * - 畫面 swipe
 *
 * 流程：
 * - 玩家走在 ROAD 上，撿 COIN，避開警察
 * - 撿完全部 COIN → 出口生成 → 走上去過關
 * - 被警察撞 3 次 → 失敗
 */

import {
  TILE,
  VIEW_W,
  VIEW_H,
  generateCity,
  tryPlayerMove,
  tickPolice,
  coinsRemaining,
  coinsTotal,
  ROAD,
  BUILDING,
  TREE,
  LAMP,
  BIN,
  CAR_RED,
  CAR_BLUE,
  COIN,
  EXIT,
  PLAYER,
  POLICE,
} from "./game.js";
import { CityAudio } from "./audio.js";

const audio = new CityAudio();

const TILES_BASE = "assets/tiles";
const TILE_FILES = {
  [ROAD]: "road.png",
  [BUILDING]: "building1.png",
  [TREE]: "tree.png",
  [LAMP]: "lamp.png",
  [BIN]: "bin.png",
  [CAR_RED]: "car_red.png",
  [CAR_BLUE]: "car_blue.png",
  [COIN]: "coin.png",
  [EXIT]: "goal.png",
  [PLAYER]: "player.png",
  [POLICE]: "police.png",
};

// 多張建築紋理輪播
const BUILDING_FILES = ["building1.png", "building2.png", "building3.png", "building4.png"];

const el = {
  canvas: document.getElementById("stage"),
  c: null,
  status: document.getElementById("status"),
  hpText: document.getElementById("hp"),
  hpBar: document.getElementById("hp-bar"),
  gold: document.getElementById("gold"),
  coinsLeft: document.getElementById("coins-left"),
  coinsTotal: document.getElementById("coins-total"),
  log: document.getElementById("log"),
  btnMute: document.getElementById("btn-mute"),
  btnNewGame: document.getElementById("btn-newgame"),
  btnRestart: document.getElementById("btn-restart"),
  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlay-title"),
  overlayText: document.getElementById("overlay-text"),
  touchLeft: document.getElementById("t-left"),
  touchRight: document.getElementById("t-right"),
  touchUp: document.getElementById("t-up"),
  touchDown: document.getElementById("t-down"),
};
el.c = el.canvas.getContext("2d");

const tileImgs = {}; // 載入快取
const TILE_FILES_FOR_LOAD = Array.from(new Set([...Object.values(TILE_FILES), ...BUILDING_FILES]));

let state = {
  d: null,
  seed: null,
  anim: 0,
  playerPx: { x: 0, y: 0 }, // 平滑像素動畫
  playerTarget: { x: 0, y: 0 }, // 移動目標（格）
  policePx: { x: 0, y: 0 },
  policeTarget: { x: 0, y: 0 },
  drawScale: 1,
};

async function loadTiles() {
  await Promise.all(
    TILE_FILES_FOR_LOAD.map(async (name) => {
      return new Promise((res) => {
        const img = new Image();
        img.onload = () => { tileImgs[name] = img; res(); };
        img.onerror = () => res();
        img.src = `${TILES_BASE}/${name}`;
      });
    })
  );
}

function buildingImgFor(x, y) {
  // 為穩定，根據 (x,y) 選一張建築圖
  const i = ((x * 7 + y * 13) >>> 0) % BUILDING_FILES.length;
  return tileImgs[BUILDING_FILES[i]] || tileImgs["building1.png"];
}

function fitCanvas() {
  const rect = el.canvas.getBoundingClientRect();
  const viewRatio = VIEW_W / VIEW_H;
  let h = rect.height;
  let w = rect.height * viewRatio;
  if (w > rect.width) {
    w = rect.width;
    h = rect.width / viewRatio;
  }
  return { w, h, ox: (rect.width - w) / 2, oy: (rect.height - h) / 2 };
}

function resizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  el.canvas.width = Math.round(el.canvas.clientWidth * dpr);
  el.canvas.height = Math.round(el.canvas.clientHeight * dpr);
  el.c.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** 把 (gx, gy) 像素中心算出來 */
function toPx(gx, gy) {
  return { x: gx * TILE + TILE / 2, y: gy * TILE + TILE / 2 };
}

function draw() {
  if (!state.d) return;
  const f = fitCanvas();
  const ctx = el.c;
  state.drawScale = f.w / VIEW_W;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#1b1d22";
  ctx.fillRect(0, 0, el.canvas.clientWidth, el.canvas.clientHeight);
  ctx.save();
  ctx.translate(f.ox, f.oy);
  ctx.scale(state.drawScale, state.drawScale);

  // 攝影機：玩家置中
  const d = state.d;
  const cx = state.playerPx.x;
  const cy = state.playerPx.y;
  const camX = cx - VIEW_W / 2;
  const camY = cy - VIEW_H / 2;
  ctx.translate(-camX, -camY);

  // 計算可見範圍
  const col0 = Math.max(0, Math.floor(camX / TILE) - 1);
  const col1 = Math.min(d.w - 1, Math.ceil((camX + VIEW_W) / TILE) + 1);
  const row0 = Math.max(0, Math.floor(camY / TILE) - 1);
  const row1 = Math.min(d.h - 1, Math.ceil((camY + VIEW_H) / TILE) + 1);

  // 畫地圖
  for (let y = row0; y <= row1; y++) {
    for (let x = col0; x <= col1; x++) {
      const t = d.grid[y][x];
      const px = x * TILE;
      const py = y * TILE;
      // 底層：道路或建築
      if (t === BUILDING) {
        const img = buildingImgFor(x, y);
        if (img) ctx.drawImage(img, px, py, TILE, TILE);
        else { ctx.fillStyle = "#3a3a44"; ctx.fillRect(px, py, TILE, TILE); }
      } else {
        // 道路／裝飾：先畫道路底，再畫裝飾
        const roadImg = tileImgs["road.png"];
        if (roadImg) ctx.drawImage(roadImg, px, py, TILE, TILE);
        else { ctx.fillStyle = "#444"; ctx.fillRect(px, py, TILE, TILE); }
        let overlay = null;
        if (t === TREE) overlay = tileImgs["tree.png"];
        else if (t === LAMP) overlay = tileImgs["lamp.png"];
        else if (t === BIN) overlay = tileImgs["bin.png"];
        else if (t === CAR_RED) overlay = tileImgs["car_red.png"];
        else if (t === CAR_BLUE) overlay = tileImgs["car_blue.png"];
        else if (t === EXIT) overlay = tileImgs["goal.png"];
        if (overlay) ctx.drawImage(overlay, px, py, TILE, TILE);
      }
    }
  }

  // 金幣
  for (const c of d.coins) {
    if (c.taken) continue;
    const img = tileImgs["coin.png"];
    if (!img) continue;
    // 浮動動畫
    const wobble = Math.sin(state.anim * 0.08 + c.x + c.y) * 1.5;
    const px = c.x * TILE;
    const py = c.y * TILE + wobble;
    ctx.drawImage(img, px, py, TILE, TILE);
  }

  // 員警
  {
    const px = state.policePx.x - TILE / 2;
    const py = state.policePx.y - TILE / 2;
    const img = tileImgs["police.png"];
    if (img) ctx.drawImage(img, px, py, TILE, TILE);
  }

  // 玩家
  {
    const px = state.playerPx.x - TILE / 2;
    const py = state.playerPx.y - TILE / 2;
    const img = tileImgs["player.png"];
    if (img) ctx.drawImage(img, px, py, TILE, TILE);
  }

  ctx.restore();
}

function updateHud() {
  if (!state.d) return;
  const d = state.d;
  el.hpText.textContent = `${Math.max(0, d.player.hp)}/${d.player.maxHp}`;
  const ratio = Math.max(0, d.player.hp) / d.player.maxHp;
  el.hpBar.style.width = `${Math.floor(ratio * 100)}%`;
  el.hpBar.style.background = ratio > 0.5 ? "#5cff5c" : ratio > 0.25 ? "#ffcd5c" : "#ff5c5c";
  el.gold.textContent = String(d.player.gold);
  el.coinsLeft.textContent = String(coinsRemaining(d));
  el.coinsTotal.textContent = String(coinsTotal(d));
  el.log.innerHTML = "";
  for (const item of d.log.slice(0, 6)) {
    const li = document.createElement("li");
    li.dataset.tone = item.kind;
    li.textContent = item.text;
    el.log.appendChild(li);
  }
  if (d.state === "caught" || d.state === "won") {
    el.overlay.dataset.show = "true";
    if (d.state === "won") {
      el.overlayTitle.textContent = "🎉 過關！";
      el.overlayTitle.dataset.tone = "win";
      el.overlayText.textContent = `撿完 ${coinsTotal(d)} 金幣、躲過員警、抵達出口。`;
    } else {
      el.overlayTitle.textContent = "🚨 被抓到了！";
      el.overlayTitle.dataset.tone = "die";
      el.overlayText.textContent = `倒在城市街角，帶走 ${d.player.gold} 金幣。`;
    }
  } else {
    el.overlay.dataset.show = "";
  }
}

function newGame(seed) {
  state.seed = seed != null ? seed : Math.floor(Math.random() * 100000);
  state.d = generateCity(state.seed);
  state.d.log.unshift({ kind: "system", text: "踏入街區，撿金幣、躲員警。" });
  state.playerPx = toPx(state.d.player.x, state.d.player.y);
  state.playerTarget = { x: state.d.player.x, y: state.d.player.y };
  state.policePx = toPx(state.d.police.x, state.d.police.y);
  state.policeTarget = { x: state.d.police.x, y: state.d.police.y };
  audio.stopBgm();
  if (audio.enabled) audio.playBgm();
  setStatus("用方向鍵或下方按鈕移動；碰到警察會扣血。");
}

/** 玩家步進：邏輯層呼叫，然後設定像素動畫目標。*/
function move(dx, dy) {
  if (!state.d) return;
  if (state.d.state !== "playing") return;
  if (state.playerTarget.x !== state.d.player.x || state.playerTarget.y !== state.d.player.y) return; // 動畫中
  audio.unlock();
  const r = tryPlayerMove(state.d, dx, dy);
  if (r.blocked) return;
  // 觸發音效
  if (r.tookCoin) audio.play("coin");
  else if (r.win) audio.play("win");
  else audio.play("step" + (1 + Math.floor(Math.random() * 3)));
  // 設定目標 → 平滑動畫
  state.playerTarget = { x: state.d.player.x, y: state.d.player.y };
}

/** 員警步進：設定像素動畫目標。*/
function policeMove() {
  if (!state.d) return;
  if (state.d.state !== "playing") return;
  if (state.policeTarget.x !== state.d.police.x || state.policeTarget.y !== state.d.police.y) return;
  tickPolice(state.d);
  state.policeTarget = { x: state.d.police.x, y: state.d.police.y };
  if (state.d.state === "caught") {
    audio.play("lose");
    audio.stopBgm();
  }
}

function setStatus(msg) {
  el.status.textContent = msg;
}

/** 主迴圈：動畫補間、員警節奏、HUD、畫面。*/
let lastPoliceStep = 0;
function tick() {
  state.anim++;
  // 玩家補間
  const targetPlayer = toPx(state.playerTarget.x, state.playerTarget.y);
  const speed = 0.25;
  state.playerPx.x += (targetPlayer.x - state.playerPx.x) * speed;
  state.playerPx.y += (targetPlayer.y - state.playerPx.y) * speed;
  // 員警補間
  const targetPolice = toPx(state.policeTarget.x, state.policeTarget.y);
  state.policePx.x += (targetPolice.x - state.policePx.x) * speed;
  state.policePx.y += (targetPolice.y - state.policePx.y) * speed;
  // 員警節奏（每 ~480ms 走一步）
  if (state.anim - lastPoliceStep > 28) {
    policeMove();
    lastPoliceStep = state.anim;
  }
  draw();
  updateHud();
  requestAnimationFrame(tick);
}

function wireInput() {
  window.addEventListener("keydown", (e) => {
    audio.unlock();
    if (e.repeat) return;
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") move(-1, 0);
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") move(1, 0);
    else if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") move(0, -1);
    else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") move(0, 1);
  });

  const mk = (elx, fn) => {
    elx.addEventListener("touchstart", (e) => { e.preventDefault(); audio.unlock(); fn(); }, { passive: false });
    elx.addEventListener("mousedown", (e) => { e.preventDefault(); audio.unlock(); fn(); });
  };
  mk(el.touchLeft, () => move(-1, 0));
  mk(el.touchRight, () => move(1, 0));
  mk(el.touchUp, () => move(0, -1));
  mk(el.touchDown, () => move(0, 1));

  // 畫面 swipe
  let touchStart = null;
  el.canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    audio.unlock();
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  el.canvas.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (Math.max(adx, ady) > 24) {
      if (adx > ady) move(dx > 0 ? 1 : -1, 0);
      else move(0, dy > 0 ? 1 : -1);
    }
    touchStart = null;
  }, { passive: true });

  el.btnNewGame.addEventListener("click", () => newGame());
  el.btnRestart.addEventListener("click", () => newGame(state.seed));
  el.btnMute.addEventListener("click", () => {
    const on = !audio.enabled;
    audio.setEnabled(on);
    el.btnMute.setAttribute("aria-pressed", String(on));
    el.btnMute.textContent = on ? "音效開" : "音效關";
    if (on) audio.playBgm(); else audio.stopBgm();
  });
  window.addEventListener("resize", resizeCanvas);
}

async function init() {
  try {
    resizeCanvas();
    wireInput();
    await audio.unlock();
    await loadTiles();
    await audio.preloadAll();
    newGame();
    requestAnimationFrame(tick);
  } catch (e) {
    console.error("[pg-cityroam] init failed", e);
    setStatus("初始化失敗：" + (e?.message || e));
  }
}

init();

if (typeof window !== "undefined") {
  window.__city = { state, audio, get city() { return state.d; } };
}