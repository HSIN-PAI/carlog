# 🚗 CarLog 持有成本

記錄愛車每一筆花費,算出「**每日持有成本**」的單頁工具。純靜態 HTML + JS,資料存在瀏覽器 localStorage,零後端零成本。
手機加到主畫面就是一個 App(有 PWA manifest 與圖示)。

## 核心指標:每日持有成本

```
每日持有成本 = 累計支出 ÷ 持有天數(從交車日起算,含當天)
```

持有越久每天越便宜,首頁主視覺就是這條遞減曲線。可切換兩種口徑:

- **含車價**:所有支出都算
- **不含車價**(純營運):排除「車價」分類,看養車本身的成本

刻意不用「每公里成本」當主指標,因為那會逼人每次都記里程。里程改用「偶爾抄一次里程表」的快照,兩點之間線性內插;不記也不影響其他功能。

## 系統架構

### App 執行架構

```mermaid
flowchart LR
  subgraph device["你的手機／電腦瀏覽器"]
    app["CarLog 單頁 App<br/>(純 HTML+JS,無框架無 build)"]
    ls["localStorage<br/>carlog.v1 資料、carlog.sync token"]
    app <--> ls
  end
  subgraph gh["GitHub"]
    pages["GitHub Pages<br/>hsin-pai.github.io/carlog<br/>(公開 repo carlog,只放程式)"]
    data["私有 repo carlog-data<br/>carlog.json(全部資料)"]
    shares["公開 repo carlog-shares<br/>shares/&lt;id&gt;.json(分享摘要)"]
  end
  pages -->|載入 index.html + app.js| app
  app <-->|"Contents API + token<br/>每次儲存後推、開啟時拉、id 合併"| data
  app -->|"按分享時寫入摘要"| shares
  friend["朋友的瀏覽器<br/>#id=… 唯讀頁"] -->|raw.githubusercontent.com| shares
```

沒有任何自建伺服器。瀏覽器直接呼叫 GitHub API,token 只存在裝置上。

### 程式更新流程

```mermaid
flowchart LR
  dev["改 index.html / app.js<br/>(記得升 ?v= 版本號)"] -->|git push| repo["GitHub 公開 repo<br/>carlog"]
  repo -->|自動建置約 30 秒| pages["GitHub Pages"]
  pages -->|重新整理| user["手機／電腦拿到新版"]
```

### 多裝置同步與合併

```mermaid
flowchart TD
  phone["手機 App"] -->|"儲存後 1.5 秒 push"| json["carlog.json<br/>(carlog-data)"]
  pc["電腦 App"] -->|"儲存後 1.5 秒 push"| json
  json -->|"開啟／回前景時 pull"| phone
  json -->|"開啟／回前景時 pull"| pc
  json -.->|"合併規則"| rule["同 id 取 updatedAt 較新<br/>刪除留墓碑 deleted[id]<br/>sha 衝突自動重拉再推(最多 3 次)"]
```

Claude 也可以直接改 `carlog-data` 的 `carlog.json`(例如幫忙從單據照片建立支出),App 下次開啟就會合併進來。

## 功能

| 頁面 | 內容 |
|---|---|
| 總覽 | 每日持有成本 + 遞減曲線(30 天 / 90 天 / 1 年 / 全部)、本月支出、每月平均、每公里成本(有里程快照才顯示)、最近支出、里程快照 |
| 記帳 | 支出列表(依月份分組)、依類型篩選、點一筆可編輯/刪除 |
| 統計 | 近 12 個月長條圖、分類圓餅(本月 / 今年 / 全部)、一次性 / 固定 / 變動 小計 |
| 設定 | 車款、交車日、交車里程、里程快照管理、JSON 匯出 / 匯入、清除資料 |

右下角 **+** 新增支出;記「充電」時多兩格「度數(kWh)」與「每度單價」,金額/度數/單價填任兩個自動算第三個,單價會記住上次的(家充通常固定,之後只填度數即可)。

## 分享給朋友

總覽右上「分享」→ 選含車價 / 不含車價 → 手機會跳系統分享選單(LINE 等),電腦則複製連結。
朋友點開看到唯讀摘要頁:每日持有成本、遞減曲線、三類型小計、分類占比、每月支出。

- **短連結(預設)**:摘要存到公開 repo `HSIN-PAI/carlog-shares` 的 `shares/<id>.json`,連結長 `#id=<id>`,LINE 貼得下。
  需要 token 的 Repository access 同時勾 `carlog-data` 和 `carlog-shares`。id 是摘要內容的雜湊,同一份快照只會產生一個檔
- **長連結(退路)**:存不上去(沒連線、token 沒權限)就把摘要用 deflate 壓縮後放在網址 `#z=…`,不經過任何伺服器;
  LINE 對太長的網址只會把前半段變成連結,所以能用短連結就用短連結
- 只帶彙總:分類合計、有支出的月份合計、曲線取樣 60 點;**單筆明細與備註不會出去**
- 連結是分享當下的快照,之後記的新資料不會更新到舊連結,要再分享一次;不想再讓某個連結被看到,把 `carlog-shares` 裡對應的檔刪掉即可

## 支出分類

- **一次性**:車價、領牌/規費、充電樁、配件
- **固定週期**:保險、牌照稅/燃料費
- **變動**:充電、保養/維修、停車、過路費、洗車、罰單、其他

## 專案結構

| 檔案 | 用途 |
|---|---|
| `index.html` | 頁面骨架與樣式(深色主題、行動優先) |
| `app.js` | 全部邏輯:狀態與 localStorage、每日成本序列、里程內插、SVG 圖表(手刻,無外部套件)、GitHub 同步 |
| `manifest.json`、`icon-*.png`、`apple-touch-icon.png` | 加到主畫面用 |

資料格式(localStorage key `carlog.v1`):

```json
{
  "version": 1,
  "car": { "name": "Tesla Model Y", "deliveryDate": "2026-09-05", "deliveryOdo": 8 },
  "settings": { "includePrice": true, "chartWindow": "all", "statsPeriod": "all" },
  "expenses": [ { "id": "…", "date": "2026-09-12", "category": "charging", "amount": 420, "note": "超充 台中", "kwh": 38.5 } ],
  "odometer": [ { "id": "…", "date": "2026-09-15", "km": 410 } ]
}
```

「設定 → 匯出 JSON」就是這個物件。換手機前先匯出,新手機匯入即可。

## 雲端同步(GitHub 私有 repo)

只存手機沒安全感,所以 App 可以把資料自動存到你 GitHub 的**私有 repo**(本專案用 `HSIN-PAI/carlog-data`,裡面只有一個 `carlog.json`)。
每次記帳都是一個 commit,GitHub 的版本歷史就是備份;多裝置開啟會自動拉回並合併。沒有後端,是瀏覽器直接呼叫 GitHub API。

### 設定步驟

1. GitHub 建一個**私有** repo(例如 `carlog-data`),放一個內容為 `{}` 的 `carlog.json`(或直接讓 App 建立也可以)
2. 產生 token:GitHub 右上頭像 → **Settings** → 左側最下方 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
   - Token name:隨便,例如 `carlog`
   - Expiration:選最長(到期後 App 會顯示「token 無效或已過期」,再產生一把貼上即可)
   - Repository access:**Only select repositories** → 勾 `carlog-data`(資料)和 `carlog-shares`(分享短連結,公開 repo)
   - Permissions → Repository permissions → **Contents:Read and write**(其他都不用)
   - Generate,把 `github_pat_…` 複製起來(只會顯示一次)
3. 打開 App → **設定 → 雲端同步** → 填 repo(`帳號/carlog-data`)與 token → **連線並同步**
4. 每一台裝置都做一次第 3 步(同一把 token 可以重複用)

token 只存在該裝置的 localStorage;因為它只能讀寫那一個私有 repo,外洩的最壞情況是車子花費紀錄被看到或改掉,不會影響你其他 repo。

### 合併規則

- 支出與里程各有 `id` 與 `updatedAt`,兩邊聯集、同 id 取較新的
- 刪除會留「墓碑」(`deleted[id] = 刪除時間`),別台裝置的舊資料不會讓它復活
- 車輛資料取 `meta.updatedAt` 較新的一邊;「含車價 / 圖表窗口 / 統計期間」這類純介面偏好不同步
- 推送時若雲端已被別台裝置更新(sha 不符),自動重拉、合併、再推,最多三次
- 時機:每次儲存後 1.5 秒、App 回到前景時、網路恢復時;失敗會在「設定」顯示原因,下次儲存再試

## 改完程式要做的事

`index.html` 裡 `<script src="app.js?v=…">` 的版本號和 `app.js` 開頭的 `VERSION` 一起升,不然 GitHub Pages 的快取會讓使用者拿到新 HTML 配舊 JS。

## 本機預覽

任何靜態伺服器都行,例如:

```bash
npx --yes http-server . -p 8124 -c-1
```

## 部署到 GitHub Pages

1. 在 GitHub 建一個 repo(公開私有皆可,Pages 公開 repo 免費)
2. 推上去:`git remote add origin <repo url>` → `git push -u origin main`
3. repo 的 **Settings → Pages → Build and deployment**:Source 選 *Deploy from a branch*,Branch 選 `main` / `(root)`,Save
4. 一兩分鐘後網址會出現在同一頁,手機 Safari 開啟 → 分享 → **加入主畫面**

## 未來可能加的

- 油車比較(v0.1 做過,PAI 覺得沒有比較依據,v0.3 拿掉;需要的話從 git 歷史找回)

- 預估殘值 / 折舊(目前只記實際支出)
- 固定週期支出到期提醒(保險、稅金)
- 多台車
