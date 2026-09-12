import { raw } from 'hono/html'
import type { AccessUser } from './access'
import type { Device } from './devices'

type AdminPageProps = {
  devices: Device[]
  user: AccessUser
}

const Timestamp = ({ value }: { value: string | null }) => {
  if (!value) return <span>尚未連線</span>

  return (
    <time dateTime={value} data-local-time>
      {value.replace('T', ' ').slice(0, 16)} UTC
    </time>
  )
}

const CaptureRoute = () => (
  <div class="capture-route" aria-hidden="true">
    <div class="route-visual">
      <div class="camera-shape">
        <span class="camera-light"></span>
        <span class="camera-lens"></span>
        <span class="camera-foot"></span>
      </div>
      <div class="route-track">
        <span></span>
        <span></span>
        <span></span>
        <i></i>
      </div>
      <div class="library-shape">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
    <div class="route-labels">
      <span>觀測設備</span>
      <span>安全傳送</span>
      <span>影像庫</span>
    </div>
  </div>
)

const DeviceCard = ({ device }: { device: Device }) => {
  const disabled = device.disabledAt !== null

  return (
    <article class="device-card" data-disabled={disabled ? 'true' : 'false'}>
      <header class="device-heading">
        <span class="status-mark" aria-hidden="true"></span>
        <div class="device-heading-copy">
          <div class="device-title-line">
            <h3>{device.name}</h3>
            <span class="status-label">{disabled ? '已停用' : '可使用'}</span>
          </div>
          <div class="device-id">
            <span>設備 ID</span>
            <code title={device.id}>{device.id}</code>
          </div>
        </div>
      </header>

      <dl class="device-details">
        <div>
          <dt>目前 Token</dt>
          <dd>{device.token?.hint ?? '已撤銷'}</dd>
        </div>
        <div>
          <dt>{disabled ? '停用時間' : '最近使用'}</dt>
          <dd>
            <Timestamp
              value={disabled ? device.disabledAt : device.token?.lastUsedAt ?? null}
            />
          </dd>
        </div>
      </dl>

      {!disabled && (
        <div class="device-actions">
          <button
            class="secondary-button"
            type="button"
            data-device-action="rotate"
            data-device-id={device.id}
            data-device-name={device.name}
            aria-label={`為 ${device.name} 重新產生 Token`}
          >
            重新產生 Token
          </button>
          <button
            class="danger-button"
            type="button"
            data-device-action="disable"
            data-device-id={device.id}
            data-device-name={device.name}
            aria-label={`停用 ${device.name}`}
          >
            停用設備
          </button>
        </div>
      )}
    </article>
  )
}

export const AdminPage = ({ devices, user }: AdminPageProps) => {
  const activeDevices = devices.filter((device) => !device.disabledAt)
  const disabledDevices = devices.filter((device) => device.disabledAt)

  return (
    <>
      {raw('<!doctype html>')}
      <html lang="zh-Hant">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="robots" content="noindex, nofollow" />
          <meta name="theme-color" content="#f5f7f8" />
          <title>設備管理 | Sight Cache</title>
          <link rel="icon" href="/logo.svg" type="image/svg+xml" />
          <link rel="stylesheet" href="/admin/assets.css" />
        </head>
        <body>
          <a class="skip-link" href="#main-content">跳到主要內容</a>

          <header class="topbar">
            <div class="topbar-inner">
              <a href="/admin" class="brand" aria-label="Sight Cache 設備控制台首頁">
                <img class="brand-mark" src="/logo.svg" alt="" width="50" height="50" />
                <span class="brand-copy">
                  <strong>Sight Cache</strong>
                  <small>設備控制台</small>
                </span>
              </a>
              <div class="identity" title={user.email}>
                <span>已登入</span>
                <strong>{user.email}</strong>
              </div>
            </div>
          </header>

          <main id="main-content" class="page-shell" tabIndex={-1}>
            <section class="hero" aria-labelledby="page-title">
              <div class="hero-copy">
                <p class="eyebrow">Collector 設備管理</p>
                <h1 id="page-title">讓觀測畫面穩穩送回影像庫</h1>
                <p class="description">
                  建立設備、更新 Token，或在設備退役時撤銷權限。每台設備只保留一組
                  有效 Token。
                </p>

                <dl class="fleet-summary" aria-label="設備摘要">
                  <div>
                    <dt>可使用</dt>
                    <dd>{activeDevices.length}</dd>
                  </div>
                  <div>
                    <dt>已停用</dt>
                    <dd>{disabledDevices.length}</dd>
                  </div>
                </dl>
              </div>

              <div class="connect-panel">
                <CaptureRoute />
                <div class="connect-heading">
                  <p class="eyebrow">連接 Collector</p>
                  <h2>建立一台新設備</h2>
                  <p>用所在位置或用途命名，之後會更容易辨認。</p>
                </div>

                <form class="create-form" data-create-device>
                  <label for="device-name">設備名稱</label>
                  <div class="create-controls">
                    <input
                      id="device-name"
                      name="name"
                      type="text"
                      maxLength={80}
                      placeholder="例如：客廳砂盆"
                      autoComplete="off"
                      aria-describedby="device-name-help"
                      required
                    />
                    <button class="primary-button" type="submit">
                      建立設備
                    </button>
                  </div>
                  <p id="device-name-help" class="form-hint">
                    <span aria-hidden="true">i</span>
                    建立後只會顯示一次完整 Token，請準備立即保存。
                  </p>
                </form>
              </div>
            </section>

            <section class="registry" aria-labelledby="registry-title">
              <header class="section-heading">
                <div>
                  <p class="eyebrow">存取清單</p>
                  <h2 id="registry-title">目前的觀測設備</h2>
                  <p>查看最近使用時間，並只在必要時重新產生 Token。</p>
                </div>
                <div class="registry-count" aria-label={`${activeDevices.length} 台可使用`}>
                  <strong>{activeDevices.length}</strong>
                  <span>台可使用</span>
                </div>
              </header>

              {devices.length === 0 ? (
                <div class="empty-state">
                  <div class="empty-illustration" aria-hidden="true">
                    <span></span>
                    <i></i>
                  </div>
                  <h3>還沒有設備來報到</h3>
                  <p>先建立第一台設備，再將一次性 Token 放進 Collector。</p>
                  <a class="primary-link-button" href="#device-name">
                    建立第一台設備
                  </a>
                </div>
              ) : (
                <>
                  {activeDevices.length > 0 ? (
                    <div class="device-list" aria-label="可使用的設備">
                      {activeDevices.map((device) => (
                        <DeviceCard key={device.id} device={device} />
                      ))}
                    </div>
                  ) : (
                    <div class="inline-empty">
                      <strong>目前沒有可使用的設備。</strong>
                      <span>可從上方建立新設備。</span>
                    </div>
                  )}

                  {disabledDevices.length > 0 && (
                    <details class="disabled-devices">
                      <summary>
                        <span>已停用設備</span>
                        <span>{disabledDevices.length} 台</span>
                      </summary>
                      <div class="device-list" aria-label="已停用的設備">
                        {disabledDevices.map((device) => (
                          <DeviceCard key={device.id} device={device} />
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}

              <p class="registry-note">
                <span aria-hidden="true">●</span>
                停用設備會立即撤銷目前 Token，之後無法再次啟用。
              </p>
            </section>
          </main>

          <div class="notice" role="status" aria-live="polite" data-notice hidden></div>

          <dialog
            class="token-dialog"
            aria-labelledby="token-title"
            aria-describedby="token-description"
            data-token-dialog
          >
            <div class="dialog-content">
              <div class="token-ready-mark" aria-hidden="true">
                <span></span>
              </div>
              <p class="eyebrow">Token 已就緒</p>
              <h2 id="token-title">先保存，再繼續</h2>
              <p id="token-description">
                <strong data-token-device></strong> 已可連線。把以下 Token 放入
                Collector 的環境變數。
              </p>
              <p class="token-warning">
                <strong>這是唯一一次顯示。</strong>
                關閉後若遺失，只能重新產生。
              </p>
              <label class="token-label" for="token-value">Collector Token</label>
              <textarea
                id="token-value"
                class="token-value"
                aria-label="設備 Token"
                readOnly
                spellCheck={false}
                data-token-value
              ></textarea>
              <div
                class="dialog-notice"
                role="status"
                aria-live="polite"
                data-dialog-notice
                hidden
              ></div>
              <ol class="token-steps">
                <li><span>1</span>複製這組 Token</li>
                <li><span>2</span>寫入 Collector 環境變數</li>
              </ol>
              <form method="dialog" class="dialog-actions">
                <button class="secondary-button" type="button" data-copy-token>
                  複製 Token
                </button>
                <button class="primary-button" value="close">我已安全保存</button>
              </form>
            </div>
          </dialog>

          <dialog
            class="action-dialog"
            aria-labelledby="action-title"
            aria-describedby="action-description"
            data-action-dialog
          >
            <form method="dialog" class="action-dialog-content">
              <div class="action-dialog-mark" aria-hidden="true" data-action-mark>?</div>
              <p class="eyebrow" data-action-kicker>確認操作</p>
              <h2 id="action-title" data-action-title></h2>
              <p id="action-description" data-action-description></p>
              <div class="dialog-actions">
                <button class="secondary-button" value="cancel" data-cancel-action>
                  返回
                </button>
                <button value="confirm" data-confirm-action></button>
              </div>
            </form>
          </dialog>

          <script src="/admin/assets.js" defer></script>
        </body>
      </html>
    </>
  )
}
