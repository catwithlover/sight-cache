<div align="center">
  <h1>Sight Cache Admin Worker</h1>
  <p><em>管理 Sight Cache 的 Collector 設備與存取 Token。</em></p>
  <p><a href="README.md" lang="en">English</a> · 繁體中文</p>
</div>

**Sight Cache Admin Worker** 用來管理將截圖送入 Sight Cache 的設備。管理者
可以建立設備、輪替 Collector Token，以及停用設備並撤銷存取權限。

## 運作方式

```text
管理者瀏覽器
    |
    v
Cloudflare Access
    |
    +--> Hono：/admin 與 /api/* --> D1
```

- Hono 在伺服器端渲染 `/admin`，並處理設備 API。
- 完整 Bearer Token 只會在建立設備或輪替 Token 時回傳一次。D1 僅保存
  SHA-256 雜湊與遮罩提示。
- 停用設備會保留設備紀錄，同時撤銷有效 Token。

## Bindings（綁定）

| 名稱 | 類型 | 用途 |
| --- | --- | --- |
| `DB` | D1 | 儲存設備與 Token 雜湊 |
| `ASSETS` | Workers Static Assets | 提供 `public/` 內的檔案 |
| `ACCESS_TEAM_DOMAIN` | Variable | Cloudflare Access 團隊網址，例如 `https://team.cloudflareaccess.com` |
| `ACCESS_AUD` | Variable | Admin Access Application 的 audience tag |

## 安全模型

- 管理介面的正式主機名稱必須由對應的 Cloudflare Access Application 保護。
- `LOCAL_ADMIN_BYPASS` 僅供 loopback 本機開發使用，不得設定於正式環境。

## 資料庫遷移

版本化 SQL migration 檔案位於 `migrations/`。請在此目錄明確套用
尚未執行的 migrations：

```sh
# 本機 D1
npm run dev:migrate

# 遠端 D1
npm run prod:migrate
```

D1 會在 migration table 記錄已執行的檔案，因此每次只會套用尚未執行的
migrations。

## 路由

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/admin` | 渲染管理介面 |
| `GET` | `/api/devices` | 列出設備 |
| `POST` | `/api/devices` | 建立設備與 Token |
| `POST` | `/api/devices/:id/token` | 撤銷舊 Token 並建立新 Token |
| `DELETE` | `/api/devices/:id` | 停用設備並撤銷 Token |

## 本機開發

安裝相依套件，並以 `.dev.vars.example` 為範本建立不納入版本控制的
`.dev.vars`。預設範本會啟用本機驗證 bypass，並設定本機管理者電子郵件。