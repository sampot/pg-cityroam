# pg-cityroam

> 街區撿金幣、躲警察、走到出口的小地圖收集遊戲；行動裝置優先、無依賴。

![kind](https://img.shields.io/badge/kind-game-7aa6cc) ![series](https://img.shields.io/badge/series-%E8%A1%97%E6%A9%9F-ffcd5c) ![license](https://img.shields.io/badge/license-MIT-5cff5c)

`pg-cityroam` 是 [Playgrounds](https://github.com/sampot/playgrounds) 系列中的一個輕量街機：

- 隨機生成 30×22 街區：道路、建築、裝飾、停車車
- 玩家（WASD／方向鍵／觸控／畫面 swipe）走在道路上
- 撿光分散在路上的金幣；撿完後出口旗幟生成
- 員警警車會隨機巡邏；撞到扣 HP，3 次扣完失敗
- 走到出口旗幟過關

## 執行

```bash
npx serve .
# 開 http://localhost:3000
```

無依賴、無建置：直接靜態伺服器即可。

## 控制

| 動作 | 鍵盤 | 觸控 |
| --- | --- | --- |
| 移動 | WASD／方向鍵 | 畫面 swipe / 右下 ◀▲▼▶ |

## 規則

- 撿完全部金幣 → 出口旗幟生成；走上去過關。
- 員警警車隨機巡邏；同格時扣 1 HP（3 HP 上限），玩家彈到鄰近道路。
- 員警節奏約 480ms 一步。
- 行動裝置優先 UI；觸控鍵也支援滑鼠點擊。

## 檔案結構

```
index.html          # 主畫面
styles.css          # mobile-first 樣式
app.js              # Canvas 渲染、輸入、HUD、員警節奏
game.js             # 街區生成、撿金幣、員警 AI（純函式）
audio.js            # Web Audio 載入 + BGM loop
game.test.js        # vitest 單元測試
functions.js        # Playgrounds Worker functions hook（預留）
assets/
  tiles/*.png       # Kenney Roguelike Modern City（CC0）+ 自繪（小人、警車、道路、旗、金幣）
  tiles/License.txt
  sfx/*.ogg         # Kenney RPG Audio + HydroGene Lively City BGM（CC0）
```

## 開發

```bash
npx vitest run
```

## 授權

MIT（程式碼）。

遊戲素材全部 CC0，署名見 [ATTRIBUTION.md](./ATTRIBUTION.md)。