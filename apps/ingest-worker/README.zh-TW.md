<div align="center">
  <h1>Sight Cache Ingest Worker</h1>
  <p><em>驗證 Collector 設備，並將攝影機畫面儲存至 Cloudflare R2。</em></p>
  <p><a href="README.md" lang="en">English</a> · 繁體中文</p>
</div>

**Sight Cache Ingest Worker** 接收通過驗證的 Sight Cache Collector 所上傳的
JPEG 畫面。它會驗證每次上傳、依時間產生 R2 key 並儲存畫面，同時在 D1
記錄設備最近的活動時間。

## 運作方式

```text
Collector
    |
    | POST /api/ingest
    | Bearer Token + raw JPEG
    v
Hono Ingest Endpoint
    |
    +--> D1：驗證設備 Token 並記錄活動時間
    |
    +--> R2：將畫面儲存於 frames/{deviceId}/...
```

- Request headers 通過驗證後，request body 會直接以串流寫入 R2。
- Token 與設備活動時間的寫入皆有節流，以減少 D1 寫入量。

## Bindings（綁定）

| 名稱 | 類型 | 用途 |
| --- | --- | --- |
| `DB` | D1 | 讀取設備與 Token 雜湊，並記錄活動時間 |
| `BUCKET` | R2 | 儲存上傳的 JPEG 畫面 |

## 身分驗證

請先透過 Admin Worker 建立設備，並保存建立時回傳的 Collector Token。每次
上傳都必須送出完整 Token：

```http
Authorization: Bearer scd_<token-id>.<secret>
```

## 上傳 API

`POST /api/ingest` 每次接受一張 raw JPEG。

| Header | 規則 |
| --- | --- |
| `Authorization` | 有效的 Collector Bearer Token |
| `Content-Type` | `image/jpeg` |
| `Content-Length` | 正整數；影像大小不得超過 10 MiB |
| `X-Filename` | `YYYY-MM-DDTHH:mm:ss±HHMM.jpg` 格式的拍攝時間；允許最多五分鐘的未來時鐘偏差 |
| `X-Timezone` | 攝影機的 IANA 時區，例如 `Asia/Taipei` |

Request body 必須是 JPEG bytes。例如：

```sh
curl --fail-with-body http://localhost:8787/api/ingest \
  --request POST \
  --header "Authorization: Bearer scd_<token-id>.<secret>" \
  --header "Content-Type: image/jpeg" \
  --header "Content-Length: $(wc -c < frame.jpg)" \
  --header "X-Filename: 2026-09-12T03:42:47+0800.jpg" \
  --header "X-Timezone: Asia/Taipei" \
  --data-binary @frame.jpg
```

上傳成功時會回傳 HTTP `200`：

```json
{
  "status": 200,
  "message": "process successfully"
}
```

影格 key 不可變更。若相同設備與拍攝時間已存在，Worker 會回傳 HTTP `409` 與
錯誤代碼 `frame_already_exists`，並保留既有 R2 物件不變。

## R2 物件結構

畫面會依設備與 UTC 拍攝時間分層保存：

```text
frames/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/{mm}/{UTC_TIMESTAMP}.jpg
```

例如，`2026-09-12T03:42:47+0800.jpg` 會儲存為：

```text
frames/550e8400-e29b-41d4-a716-446655440000/2026/09/11/19/42/20260911T194247Z.jpg
```

R2 metadata 會保存 UTC `capturedAt`、含 offset 的 `capturedAtLocal` 與 IANA
`timezone`。

## 活動時間追蹤

- Token 驗證成功後，`device_tokens.last_used_at` 最多每五分鐘更新一次。
- R2 寫入成功後，`devices.last_frame_at` 最多每五秒在背景更新一次。
- 條件式 D1 updates 可避免併發上傳造成不必要的重複寫入。

## 路由

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/api/ingest` | 驗證 Collector，並儲存一張 JPEG 畫面 |
| `GET` | `/` | 回傳基本的服務可用狀態 |
