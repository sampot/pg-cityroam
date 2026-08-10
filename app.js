/**
 * pg-cityroam 主程式：Canvas 渲染、輸入、玩家步進、員警巡邏、HUD。
 */

import {
  TILE, VIEW_W, VIEW_H,
  generateCity, tryPlayerMove, tickPolice,
  coinsRemaining, coinsTotal,
  ROAD, ROAD_PLAIN, SIDEWALK, CURB_TL, CURB_TR, CURB_BL, CURB_BR,
  CROSSWALK_H, CROSSWALK_V,
  BUILDING, TREE, LAMP, BIN, CAR_RED, CAR_BLUE, COIN, EXIT,
  PLAYER, POLICE,
} from "./game.js";
import { CityAudio } from "./audio.js";

const audio = new CityAudio();

const TILES_BASE = "assets/tiles";

// 每個 cell type 對應的 tile 圖檔
const TILE_FILES = {
  [ROAD]:         "road_main_v.png",     // 主道路中央黃虛線（預設縱向；橫向會由 app 根據方位覆寫）
  [ROAD_PLAIN]:   "road_plain.png",
  [SIDEWALK]:     "sidewalk_h.png",
  [CURB_TL]:      "curb_nw.png",
  [CURB_TR]:      "curb_ne.png",
  [CURB_BL]:      "curb_sw.png",
  [CURB_BR]:      "curb_se.png",
  [CROSSWALK_H]:  "crosswalk_h.png",
  [CROSSWALK_V]:  "crosswalk.png",       // 現有 tile 中 crosswalk 是橫向斑馬線；改命名衝突
  [BUILDING]:     "building1.png",
  [TREE]:         "tree.png",
  [LAMP]:         "lamp.png",
  [BIN]:          "bin.png",
  [CAR_RED]:      "car_red.png",
  [CAR_BLUE]:     "car_blue.png",
  [COIN]:         "coin.png",
  [EXIT]:         "goal.png",
  [PLAYER]:       "player_down.png",
  [POLICE]:       "police.png",
};
const BUILDING_FILES = ["building1.png", "building2.png", "building3.png", "building4.png"];
const PLAYER_FILES = {
  up: "player_up.png",
  down: "player_down.png",
  left: "player_left.png",
  right: "player_right.png",
};

// 要載入的所有 tiles
const TILE_FILES_FOR_LOAD = Array.from(new Set([
  ...Object.values(TILE_FILES),
  ...BUILDING_FILES,
  ...Object.values(PLAYER_FILES),
]));

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

const tileImgs = {};

let state = {
  d: null,
  seed: null,
  anim: 0,
  playerPx: { x: 0, y: 0 },
  playerTarget: { x: 0, y: 0 },
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
  const i = ((x * 7 + y * 13) >>> 0) % BUILDING_FILES.length;
  return tileImgs[BUILDING_FILES[i]] || tileImgs["building1.png"];
}

function fitCanvas() {
  const rect = el.canvas.getBoundingClientRect();
  const viewRatio = VIEW_W / VIEW_H;
  let h = rect.height;
  let w = rect.height * viewRatio;
  if (w > rect.width) { w = rect.width; h = w / viewRatio; }
  return { w, h, ox: (rect.width - w) / 2, oy: (rect.height - h) / 2 };
}

function resizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  el.canvas.width = Math.round(el.canvas.clientWidth * dpr);
  el.canvas.height = Math.round(el.canvas.clientHeight * dpr);
  el.c.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function toPx(gx, gy) {
  return { x: gx * TILE + TILE / 2, y: gy * TILE + TILE / 2 };
}

/** 根據 cell type 與周圍，決定 tile 圖檔。 */
function tileFileFor(d, x, y) {
  const t = d.grid[y][x];
  if (t === ROAD) {
    // 主街位置：COL_V 道路（x=6,18）→ 縱向黃虛線；ROW_H 道路（y=8,14）→ 橫向黃虛線；其餘路口用縱向
    const COL_V = new Set([6, 18]);
    const ROW_H = new Set([8, 14]);
    if (COL_V.has(x) && ROW_H.has(y)) return "road_main_v.png";
    if (COL_V.has(x)) return "road_main_v.png";
    if (ROW_H.has(y)) return "road_main_h.png";
    return "road_main_h.png";
  }
  if (t === SIDEWALK) {
    return "sidewalk_h.png";
  }
  return TILE_FILES[t] || null;
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

  const d = state.d;
  const cx = state.playerPx.x;
  const cy = state.playerPx.y;
  const camX = cx - VIEW_W / 2;
  const camY = cy - VIEW_H / 2;
  ctx.translate(-camX, -camY);

  const col0 = Math.max(0, Math.floor(camX / TILE) - 1);
  const col1 = Math.min(d.w - 1, Math.ceil((camX + VIEW_W) / TILE) + 1);
  const row0 = Math.max(0, Math.floor(camY / TILE) - 1);
  const row1 = Math.min(d.h - 1, Math.ceil((camY + VIEW_H) / TILE) + 1);

  for (let y = row0; y <= row1; y++) {
    for (let x = col0; x <= col1; x++) {
      const t = d.grid[y][x];
      const px = x * TILE;
      const py = y * TILE;
      if (t === BUILDING) {
        const img = buildingImgFor(x, y);
        if (img) ctx.drawImage(img, px, py, TILE, TILE);
        else { ctx.fillStyle = "#3a3a44"; ctx.fillRect(px, py, TILE, TILE); }
      } else {
        // 用 tileFileFor 決定圖
        const file = tileFileFor(d, x, y);
        const img = file ? tileImgs[file] : null;
        if (img) ctx.drawImage(img, px, py, TILE, TILE);
        else { ctx.fillStyle = "#444"; ctx.fillRect(px, py, TILE, TILE); }
        // 裝飾覆蓋
        let overlay = null;
        if (t === TREE) overlay = tileImgs["tree.png"];
        else if (t === LAMP) overlay = tileImgs["lamp.png"];
        else if (t === BIN) overlay = tileImgs["bin.png"];
        else if (t === CAR_RED) overlay = tileImgs["car_red.png"];
        else if (t === CAR_BLUE) overlay = tileImgs["car_blue.png"];
        else if (t === EXIT && d.exitActive) overlay = tileImgs["goal.png"];
        if (overlay) ctx.drawImage(overlay, px, py, TILE, TILE);
      }
    }
  }

  // 金幣
  for (const c of d.coins) {
    if (c.taken) continue;
    const img = tileImgs["coin.png"];
    if (!img) continue;
    const wobble = Math.sin(state.anim * 0.08 + c.x + c.y) * 1.5;
    ctx.drawImage(img, c.x * TILE, c.y * TILE + wobble, TILE, TILE);
  }

  // 員警
  {
    const img = tileImgs["police.png"];
    if (img) ctx.drawImage(img, state.policePx.x - TILE / 2, state.policePx.y - TILE / 2, TILE, TILE);
  }

  // 玩家（4 方向）
  {
    const face = state.d.player.face || "down";
    const file = PLAYER_FILES[face] || "player_down.png";
    const img = tileImgs[file];
    if (img) ctx.drawImage(img, state.playerPx.x - TILE / 2, state.playerPx.y - TILE / 2, TILE, TILE);
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

function move(dx, dy) {
  if (!state.d) return;
  if (state.d.state !== "playing") return;
  if (state.playerTarget.x !== state.d.player.x || state.playerTarget.y !== state.d.player.y) return;
  audio.unlock();
  const r = tryPlayerMove(state.d, dx, dy);
  if (r.blocked) return;
  if (r.tookCoin) audio.play("coin");
  else if (r.win) audio.play("win");
  else audio.play("step" + (1 + Math.floor(Math.random() * 3)));
  state.playerTarget = { x: state.d.player.x, y: state.d.player.y };
}

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

let lastPoliceStep = 0;
function tick() {
  state.anim++;
  const targetPlayer = toPx(state.playerTarget.x, state.playerTarget.y);
  const speed = 0.25;
  state.playerPx.x += (targetPlayer.x - state.playerPx.x) * speed;
  state.playerPx.y += (targetPlayer.y - state.playerPx.y) * speed;
  const targetPolice = toPx(state.policeTarget.x, state.policeTarget.y);
  state.policePx.x += (targetPolice.x - state.policePx.x) * speed;
  state.policePx.y += (targetPolice.y - state.policePx.y) * speed;
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