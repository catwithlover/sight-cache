<div align="center">
  <h1>Sight Cache Image Worker</h1>
  <p><em>建立監視器縮圖總覽，並提供受保護的唯讀 MCP 工具。</em></p>
  <p><a href="README.md" lang="en">English</a> · 繁體中文</p>
</div>

**Sight Cache Image Worker** 會將 Ingest Worker 儲存的監視器畫面整理成精簡的縮圖總覽，並提供唯讀 MCP endpoint，供呼叫者檢視設備、時間區間、鄰近畫面與選定的原始畫面。

## 運作方式

```text
ChatGPT 或其他 MCP Client
        |
        | Managed OAuth Bearer Token
        v
Cloudflare Access
        |
        | Cf-Access-Jwt-Assertion
        v
Stateless MCP Endpoint：/mcp
        |
        +--> D1：讀取啟用中的設備
        |
        +--> R2：讀取畫面與快取的縮圖總覽
        |
        +--> Cloudflare Images：合成縮圖總覽

Cron：5 * * * * --> Queue --> 每小時縮圖總覽 Builder --> R2
```

- 每小時 cron 會為所有啟用中的設備排入上一個完整小時的工作。
- 分鐘縮圖總覽會在時間區間完成後，於第一次請求時建立。

## Bindings（綁定）

| 名稱 | 類型 | 用途 |
| --- | --- | --- |
| `DB` | D1 | 讀取啟用中的設備與最近上傳時間 |
| `BUCKET` | R2 | 讀取原始畫面，並儲存縮圖總覽與索引檔 |
| `IMAGES` | Cloudflare Images | 縮放畫面並合成縮圖總覽 |
| `ASSETS` | Workers Static Assets | 提供合成時使用的空白底圖 |
| `CONTACT_SHEET_BUILDER_QUEUE` | Queue | 透過佇列建立每小時縮圖總覽 |
| `ACCESS_TEAM_DOMAIN` | Variable | Cloudflare Access 團隊網址，例如 `https://team.cloudflareaccess.com` |
| `ACCESS_AUD` | Variable | MCP Access Application 的 audience tag |
| `LOCAL_MCP_BYPASS` | Variable | 僅在本機 loopback 環境略過 Access 驗證 |
| `LOCAL_MCP_EMAIL` | Variable | 本機略過驗證時記錄的使用者身分 |
| `MCP_ALLOWED_ORIGIN_HOSTNAMES` | Variable | 額外允許的瀏覽器 Origin hostnames，以逗號分隔 |
| `MCP_ENABLE_FRAME_DOWNLOAD_URLS` | Variable | 僅在值精確為 `true` 時註冊批次短效下載連結，預設關閉 |
| `MCP_MAX_LOOKBACK_DAYS` | Variable | 最長可讀歷史期間，預設為 14 天 |
| `R2_ACCOUNT_ID` / `R2_BUCKET_NAME` | Variable | `BUCKET` binding 所使用帳號與 bucket 的 R2 S3 endpoint 資訊 |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Secret | 限定於 `BUCKET` binding 相同 R2 bucket 的唯讀 S3 credentials |

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `list_devices` | 列出啟用中的設備、最近上傳時間與時區 |
| `get_contact_sheet` | 回傳已完成分鐘或小時的一張 JPEG 縮圖總覽，以及各縮圖格的時間與狀態資訊 |
| `list_frames` | 列出最長五分鐘區間內的精確拍攝時間 |
| `get_original_frame` | 回傳精確 `capturedAt` 時間的未修改 JPEG |
| `create_original_frame_downloads` | 啟用時回傳純 JSON；包含最多 20 個、有效 30 分鐘的原始畫面下載連結 |

建議的檢視流程是先呼叫 `list_devices`、檢查該小時的每張縮圖總覽，再深入可疑的分鐘、列出鄰近畫面的時間，最後只取回需要作為證據的原始畫面。

只有當 `MCP_ENABLE_FRAME_DOWNLOAD_URLS` 精確設為 `true` 時，才會註冊 `create_original_frame_downloads`。它不嵌入圖片資料，只回傳 metadata 與 HTTPS GET URL，並將每個要求的時間標示為 `available` 或 `unavailable`。

## 縮圖總覽

| 區間 | 觸發方式 | 取樣 | 輸出 |
| --- | --- | --- | --- |
| 小時 | `5 * * * *` cron 與 Queue | 60 個一分鐘取樣格 | 六張 2×5 JPEG 縮圖總覽 |
| 分鐘 | 第一次 MCP 請求 | 12 個五秒取樣格 | 兩張 2×3 JPEG 縮圖總覽 |

- 一個分鐘區間會在結束五分鐘後才能使用，避免延遲上傳永久被記錄為缺少畫面

## R2 物件結構

原始畫面沿用 Ingest Worker 建立的 UTC 結構：

```text
frames/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/{mm}/{UTC_TIMESTAMP}.jpg
```

每小時的檔案位於小時層級，每分鐘的檔案則位於其分鐘子目錄：

```text
contact-sheets/v1/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/
|-- manifest.json
|-- generations/
|   `-- {generationId}/
|       `-- sheet-{NN}.jpg
`-- {mm}/
    |-- manifest.json
    `-- generations/
        `-- {generationId}/
            `-- sheet-{NN}.jpg
```

## 身分驗證

請使用 Cloudflare Access Application 保護 `/mcp`，並啟用 Access Managed OAuth。Cloudflare 會在 edge 處理 OAuth discovery、授權與 Token。

請在 Worker secrets/variables 或本機 `.dev.vars` 設定：

```dotenv
ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com
ACCESS_AUD=your-access-application-aud
```

目前 Access Application 允許的每個身分都能讀取所有啟用中的設備。在完成identity-to-device grants 前，請將 Access policy 限制為擁有者。正式環境中，所有可連到 `/mcp` 的網域與路徑都必須由 Cloudflare Access 保護。

`LOCAL_MCP_BYPASS` 僅供 loopback 本機開發使用，不得設定於正式環境。

簽署後的畫面 URL 是會略過 Access 的 bearer credential。關閉工具只能阻止簽發新 URL，既有 URL 在 30 分鐘到期前仍可讀取；若需立即失效，必須撤銷 R2 signing credential。R2 presigned URL 使用 S3 API 網域而非自訂網域；瀏覽器下載時另需設定 bucket CORS。

## 路由

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/` | 渲染服務資訊頁面 |
| `POST` | `/mcp` | 通過 Access 驗證後處理 stateless MCP requests |

## 本機開發

以 `.dev.vars.example` 為範本建立`.dev.vars`。

預設範本會啟用僅限 loopback 的本機驗證 bypass，並以 `LOCAL_MCP_EMAIL` 作為記錄的本機身分，因此本機 MCP 請求不需要 Access assertion。非 loopback URL 不會套用此 bypass。
