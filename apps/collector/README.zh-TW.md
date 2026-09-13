<div align="center">
  <h1>Sight Cache Collector</h1>
  <p><em>擷取 RTSP 攝影機畫面，並上傳至 Sight Cache。</em></p>
  <p><a href="README.md" lang="en">English</a> · 繁體中文</p>
</div>

**Sight Cache Collector** 運行於 RTSP 攝影機附近的主機。使用 FFmpeg 將
帶有時間戳記的 JPEG 畫面寫入本機暫存目錄，再逐張上傳至 Sight Cache
Ingest Worker。

## 運作方式

```text
RTSP 攝影機
     |
     v
   FFmpeg --> frames/*.jpg --> 循序上傳佇列
                                      |
                                      v
                               Ingest Worker
```

- FFmpeg 透過 RTSP/TCP 連線，依設定的間隔擷取 JPEG；預設為每五秒一張，且
  不處理音訊。
- 若 RTSP 連線停止產生畫面，Collector 會終止卡住的 FFmpeg process 並自動
  重新連線。

## 系統需求

- Node.js 24.19.0 或更新版本
- 已安裝 `ffmpeg`
- 主機可連線的 RTSP 攝影機串流

## Tapo 前置設定

設定 `TAPO_URL` 前，請依照官方的
[TAPO 前置設定操作指引](https://www.tp-link.com/us/support/faq/2680/)，並完成設定。

- 確認攝影機型號支援 RTSP；不同型號的支援情況不同。
- 在 Tapo App 開啟 **Device Settings > Advanced Settings > Camera Account**，建立攝影機專用憑證。此帳號與登入 Tapo App 的 Tapo 帳號不同。
- 查詢攝影機的區域網路 IP 位址，並讓 Collector 與攝影機位於同一受信任的
  區域網路。
- `stream1` 為高畫質串流，`stream2` 為標準畫質串流。

## 設定

| 名稱 | 用途 |
| --- | --- |
| `API_ENDPOINT` | 以 `/api/ingest` 結尾的完整 Ingest Worker endpoint |
| `BEARER_TOKEN` | Admin Worker 回傳的完整 Collector Token |
| `TAPO_URL` | 包含攝影機憑證與位址的 RTSP 串流 URL |
| `CAPTURE_INTERVAL_SECONDS` | 選填的正數擷取間隔，單位為秒；預設為 `5` |

## 執行

請在此目錄啟動常駐的 Collector process：

```sh
npm start
```

## Docker Compose

`compose.yml` 定義兩個相互隔離、共用同一 Collector image 的攝影機 instance。

請以 `compose.env.example` 為範本建立 `compose.env`，並為每台攝影機設定獨立的 Collector Token、RTSP URL 與選填的擷取間隔。

建立 image 並啟動所有攝影機 instance：

```sh
docker compose --env-file compose.env up --build --detach
```

若要增加攝影機，請在 `compose.yml` 複製一組攝影機 service 與 volume，並在 `compose.env` 加入對應的攝影機前綴設定值。

## 擷取與上傳行為

畫面會以主機的本機時間與 UTC offset 命名，並寫入 `frames/`：

```text
YYYY-MM-DDTHH:mm:ss±HHMM.jpg
```

Collector 會將時間戳記檔名放入 `X-Filename`、將完整 Collector Token 作為
Bearer Token，並以 request body 傳送 JPEG bytes。上傳會循序處理，避免緩慢
的 request 形成平行上傳突發流量。

## 安全性

- 本機暫存畫面可能包含敏感影像資訊，應限制 Collector 主機的存取權限。
