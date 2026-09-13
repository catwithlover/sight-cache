<div align="center">
  <img src="docs/assets/logo.svg" alt="Sight Cache" width="180" />
  <h1>Sight Cache</h1>
  <p><em>給 AI Agent 的監視器之眼與影像記憶。</em></p>
  <p><a href="README.md" lang="en">English</a> · 繁體中文</p>
</div>

**Sight Cache** — 基於 Cloudflare 建構的無伺服器監視器歷史管線，透過 MCP 為 AI Agent 提供精簡且可檢視的影像記憶。

## 運作方式

```text
管理者 <--> Cloudflare Access <--> Admin Worker
                                          +--> D1 設備與 Token 雜湊
                                          `--> Collector Token（僅顯示一次）

RTSP 監視器 --> FFmpeg Collector --> Ingest Worker --> D1 活動時間
                                                    `--> R2 原始 JPEG

MCP Client <--> Access Managed OAuth <--> Image Worker
                                            ^  |  |
每小時 cron --> Queue ----------------------'  |  +--> Cloudflare Images
R2 原始 JPEG ----------------------------------'  `--> R2 縮圖總覽與索引檔
```

## 元件

| 元件 | 執行環境 | 職責 |
| --- | --- | --- |
| [`apps/collector/`](apps/collector/README.zh-TW.md) | Node.js or Docker | 擷取 RTSP 畫面並上傳 |
| [`apps/admin-worker/`](apps/admin-worker/README.zh-TW.md) | Cloudflare Workers | 管理設備、核發 Collector Token、輪替憑證與停用存取權限 |
| [`apps/ingest-worker/`](apps/ingest-worker/README.zh-TW.md) | Cloudflare Workers | 驗證 Collector、檢查影像上傳、儲存原始畫面 |
| [`apps/image-worker/`](apps/image-worker/README.zh-TW.md) | Cloudflare Workers | 建立縮圖總覽，並提供受保護的 MCP 檢視工具 |

## Cloudflare 服務

本專案實際使用下列 Cloudflare 服務與 Workers 功能：

| 服務或功能 | 使用元件 | 用途 |
| --- | --- | --- |
| Cloudflare Workers | Admin、Ingest、Image Worker | 執行管理介面、影像接收 API、MCP endpoint、排程與 Queue handlers |
| Cloudflare Access | Admin、Image Worker | 保護管理介面與 MCP；MCP 使用 Managed OAuth，Worker 驗證 Access JWT assertion |
| Cloudflare D1 | Admin、Ingest、Image Worker | 儲存設備、Collector Token 雜湊與活動時間，並提供啟用中設備資料近期資訊 |
| Cloudflare R2 | Ingest、Image Worker | 儲存原始畫面、縮圖總覽與索引檔 |
| Cloudflare Images | Image Worker | 將原始畫面縮放、裁切並合成 JPEG 縮圖總覽 |
| Cloudflare Queues | Image Worker | 傳遞每小時縮圖總覽工作 |
| Cron Triggers | Image Worker | 於每小時初排入上一個完整小時的縮圖總覽工作 |
| Workers Static Assets | Admin、Ingest、Image Worker | 提供管理介面的 CSS/JavaScript、服務頁面資產及縮圖總覽空白底圖 |

## MCP 檢視

Image Worker 提供 stateless `/mcp` endpoint，並由 Cloudflare Access Managed OAuth 保護。

| 工具 | 用途 |
| --- | --- |
| `list_devices` | 列出啟用中的設備與最近上傳時間 |
| `get_contact_sheet` | 回傳一張 JPEG 縮圖總覽，以及各縮圖格的精確資訊 |
| `list_frames` | 列出最長五分鐘區間內的精確拍攝時間 |
| `get_frame_comparison_sheet` | 將 2–10 張選定的精確影格合成一張衍生 JPEG 供比較 |
| `get_original_frame` | 回傳指定拍攝時間的未修改 JPEG |
| `create_original_frame_downloads` | 啟用時為最多 20 張原始影格建立短效下載連結 |

每個小時區間包含 60 個一分鐘取樣格，分為 6 張縮圖總覽。每個分鐘區間包含 12 個 5 秒取樣格，分為 2 張縮圖總覽，並在 5 分鐘的完成等待時間結束後，於第一次請求時建立。

## 儲存結構

物件 key 使用正規化後的 UTC 拍攝時間：

```text
frames/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/{mm}/{UTC_TIMESTAMP}.jpg

contact-sheets/v1/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/
|-- manifest.json
|-- generations/{generationId}/sheet-{NN}.jpg
`-- {mm}/
    |-- manifest.json
    `-- generations/{generationId}/sheet-{NN}.jpg
```

小時層級的索引檔會發布排程建立的每小時縮圖總覽；分鐘目錄則保存按需建立的縮圖總覽。

## 系統需求

- Node.js 24.19.0 或更新版本
- Collector 使用的 FFmpeg，或 Docker 與 Compose
- 可連線的 RTSP 監視器串流
- Cloudflare Workers Paid plan

## 開始使用

安裝所有 workspace 相依套件，並執行目前提供的型別檢查：

```sh
npm ci
npm run typecheck
```

部署前，請先建立共用 D1 資料庫與 R2 bucket、縮圖總覽所需的 Queues，以及對應的 Access Applications，再依環境完成各 `wrangler.jsonc`。

在專案根目錄套用 D1 migration：

```sh
# 本機 D1
npm run dev:migrate --workspace admin-worker

# 遠端 D1
npm run prod:migrate --workspace admin-worker
```

在不同終端機分別啟動各服務：

```sh
npm run dev --workspace admin-worker
npm run dev --workspace ingest-worker
npm run dev --workspace image-worker
npm start --workspace @sight-cache/collector
```

透過 Admin Worker 建立設備、在 Collector Token 顯示時加以保存，再以 `apps/collector/.env.example` 為範本設定 `apps/collector/.env`，填入 Ingest URL、Token 與 RTSP URL。各元件的詳細設定與行為請參閱對應文件。

完成特定帳號的設定並套用遠端 D1 migration 後，部署三個 Worker：

```sh
npm run deploy --workspace admin-worker
npm run deploy --workspace ingest-worker
npm run deploy --workspace image-worker
```

## 安全性與保留政策

- Admin Worker 以及所有可連到 `/mcp` 的路由，都必須由對應的 Cloudflare Access 保護。
- 目前 MCP Access policy 允許的每個身分都能檢視所有啟用中的設備。在完成個別設備授權前，請嚴格限制該 policy。
- 啟用影像接收前，請考慮將共用 R2 bucket 的 lifecycle rule 設為物件於 14 天後過期。

## 文件

- [Collector](apps/collector/README.zh-TW.md)
- [Admin Worker](apps/admin-worker/README.zh-TW.md)
- [Ingest Worker](apps/ingest-worker/README.zh-TW.md)
- [Image Worker 與 MCP](apps/image-worker/README.zh-TW.md)
