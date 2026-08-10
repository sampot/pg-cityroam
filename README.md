# pg-cityroam

> 街區撿金幣、躲警察、走到出口的小地圖收集遊戲；行動裝置優先、無依賴。

![kind](https://img.shields.io/badge/kind-game-7aa6cc) ![series](https://img.shields.io/badge/series-%E8%A1%97%E6%A9%9F-ffcd5c) ![license](https://img.shields.io/badge/license-MIT-5cff5c)

`pg-cityroam` 是 [Playgrounds](https://github.com/sampot/playgrounds) 系列中的一個輕量街機：

- 隨機生成 30×22 街區：道路、建築、裝飾、停車車
- 玩家（WASD／方向鍵／觸控／畫面 swipe）走在道路上
- 撿光分散在路上的金幣；撿完後出口旗幟生成
- 員警警車會在視線內追人；撞到扣 HP，3 次扣完失敗
- 撿道具強化：護盾（擋一次碰撞）、加速鞋（短時間雙步）
- 限時 60 秒；時間內走到出口過關，得分越高越好（最高分跨沙盒持久化）

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

- 撿完全部金幣 → 出口旗幟生成；限時 60 秒內走上去過關。
- 員警警車會在視線（同路、無建築擋住）內追逐玩家；撞到扣 1 HP（3 HP 上限），玩家彈到鄰近道路。有護盾則擋下不扣血。
- 道具：護盾（藍）擋一次碰撞；加速鞋（黃）拾取後短時間內一次可連走 2 格。
- 員警節奏約 480ms 一步。
- 得分：金幣 +25／枚；過關 +100、每剩餘 HP +50、每剩餘秒 +20。
- 最高分經 `PUT /api/kv/pg-cityroam.best` 由 runtime 持久化（跨沙盒共享）。
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
  tiles/*.png       # 全部自繪（程序產生）像素風格：道路、行人、警車、汽車、樹、旗、金幣
  tiles/License.txt
  sfx/*.ogg         # Kenney RPG Audio + HydroGene Lively City BGM（CC0）
```

## 開發

```bash
npx vitest run
```

## 授權

MIT（程式碼與美術）。
音效／音樂為 CC0，署名見 [ATTRIBUTION.md](./ATTRIBUTION.md)。