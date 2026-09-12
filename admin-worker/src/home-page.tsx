import { raw } from 'hono/html'

const styles = `
:root {
  color-scheme: light;
  --canvas: #f5f7f8;
  --surface: #ffffff;
  --ink: #26323d;
  --muted: #626c74;
  --line: #d2d6d8;
  --action: #1a5fad;
  --action-hover: #154f91;
  --action-soft: #e3edfc;
  --accent: #d8ac58;
  --success: #287354;
  --success-soft: #e8f4ed;
  --font-sans: "Avenir Next", Avenir, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html {
  background: var(--canvas);
}

body {
  min-width: 320px;
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0;
  color: var(--ink);
  background: var(--canvas);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

.page-shell {
  display: grid;
  min-height: 100vh;
  min-height: 100dvh;
  place-items: center;
  padding: clamp(1rem, 5vw, 3rem);
}

.status-card {
  width: min(100%, 44rem);
  padding: clamp(2rem, 6vw, 4rem);
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 30px 30px 30px 11px;
  text-align: center;
}

.brand-logo {
  display: block;
  width: 92px;
  height: 92px;
  margin: -12px auto 4px;
}

.brand-name,
.service-name {
  margin: 0;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.brand-name {
  color: var(--action);
  font-size: 0.78rem;
}

.service-name {
  margin-top: 8px;
  color: var(--muted);
  font-size: 0.66rem;
  letter-spacing: 0.18em;
}

h1 {
  margin: 13px 0 0;
  color: var(--ink);
  font-size: clamp(2.25rem, 8vw, 3.6rem);
  font-weight: 650;
  letter-spacing: -0.05em;
  line-height: 1.12;
}

.description {
  width: min(100%, 31rem);
  margin: 15px auto 0;
  color: var(--muted);
  font-size: 0.98rem;
  line-height: 1.65;
}

.control-illustration {
  display: grid;
  width: min(100%, 32rem);
  min-height: 174px;
  grid-template-columns: 112px minmax(64px, 1fr) 126px;
  margin: 28px auto 0;
  padding: 25px;
  align-items: center;
  gap: 13px;
  background: var(--action-soft);
  border: 1px solid #bfd0e5;
  border-radius: 22px 22px 22px 8px;
}

.device-stack {
  display: grid;
  gap: 8px;
}

.device-row {
  display: flex;
  min-height: 30px;
  padding: 7px 9px;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border: 1px solid #aac4df;
  border-radius: 8px 8px 8px 3px;
}

.device-row::before {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  background: var(--success);
  border-radius: 50%;
  content: "";
}

.device-row::after {
  width: 100%;
  height: 4px;
  background: #9fb7cc;
  border-radius: 999px;
  content: "";
}

.device-row:nth-child(2)::after {
  width: 68%;
}

.device-row:nth-child(3)::before {
  background: var(--accent);
}

.device-row:nth-child(3)::after {
  width: 82%;
}

.access-track {
  position: relative;
  height: 56px;
}

.access-track::before {
  position: absolute;
  top: 27px;
  right: 0;
  left: 0;
  border-top: 2px dashed #7fa4ca;
  content: "";
}

.access-track::after {
  position: absolute;
  top: 22px;
  right: -1px;
  width: 9px;
  height: 9px;
  border-top: 2px solid var(--action);
  border-right: 2px solid var(--action);
  content: "";
  transform: rotate(45deg);
}

.access-key {
  position: absolute;
  z-index: 1;
  top: 17px;
  left: 0;
  width: 30px;
  height: 20px;
  background: #fff8e9;
  border: 3px solid var(--accent);
  border-radius: 999px;
  animation: access-travel 3.2s ease-in-out infinite;
}

.access-key::after {
  position: absolute;
  top: 5px;
  right: -8px;
  width: 10px;
  border-top: 3px solid var(--accent);
  content: "";
}

.console-panel {
  width: 122px;
  padding: 11px;
  background: var(--surface);
  border: 2px solid var(--action);
  border-radius: 13px 13px 13px 6px;
}

.console-bar {
  display: flex;
  margin-bottom: 11px;
  gap: 4px;
}

.console-bar span {
  width: 5px;
  height: 5px;
  background: #9fb7cc;
  border-radius: 50%;
}

.console-line {
  display: grid;
  grid-template-columns: 1fr 22px;
  margin-top: 8px;
  align-items: center;
  gap: 8px;
}

.console-line::before {
  height: 5px;
  background: #b5c9dc;
  border-radius: 999px;
  content: "";
}

.console-line::after {
  width: 22px;
  height: 12px;
  background: var(--action);
  border: 3px solid #90b9e2;
  border-radius: 999px;
  content: "";
}

.console-line:nth-child(3)::before {
  width: 72%;
}

.console-line:nth-child(4)::before {
  width: 86%;
}

.console-line:nth-child(4)::after {
  background: #aeb8c1;
  border-color: #d9dee2;
}

.actions {
  display: flex;
  margin-top: 28px;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.service-state,
.console-link {
  display: inline-flex;
  min-height: 40px;
  padding: 8px 14px;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border-radius: 999px;
  font-size: 0.84rem;
  font-weight: 750;
}

.service-state {
  color: var(--success);
  background: var(--success-soft);
  border: 1px solid #c5ddcf;
}

.state-dot {
  position: relative;
  width: 8px;
  height: 8px;
  background: var(--success);
  border-radius: 50%;
}

.state-dot::after {
  position: absolute;
  inset: -4px;
  border: 1px solid var(--success);
  border-radius: inherit;
  content: "";
  opacity: 0;
  animation: status-breathe 2.8s ease-out infinite;
}

.console-link {
  color: #ffffff;
  background: var(--action);
  border: 1px solid var(--action);
  text-decoration: none;
  transition: background 160ms ease, transform 160ms ease;
}

.console-link:hover {
  background: var(--action-hover);
  transform: translateY(-1px);
}

.console-link:focus-visible {
  outline: 3px solid #9fc5ec;
  outline-offset: 3px;
}

@keyframes status-breathe {
  45% {
    opacity: 0.35;
  }

  80%,
  100% {
    opacity: 0;
    transform: scale(1.8);
  }
}

@keyframes access-travel {
  0%,
  14% {
    left: 0;
  }

  72%,
  100% {
    left: calc(100% - 30px);
  }
}

@media (max-width: 430px) {
  .status-card {
    padding: 2.25rem 1.5rem 2.5rem;
    border-radius: 23px 23px 23px 9px;
  }

  .brand-logo {
    width: 84px;
    height: 84px;
    margin-top: -9px;
  }

  .control-illustration {
    min-height: 140px;
    grid-template-columns: 78px minmax(34px, 1fr) 84px;
    padding: 18px 13px;
    gap: 6px;
  }

  .device-stack {
    gap: 6px;
  }

  .device-row {
    min-height: 24px;
    padding: 5px 6px;
    gap: 6px;
  }

  .device-row::before {
    width: 6px;
    height: 6px;
  }

  .console-panel {
    width: 82px;
    padding: 8px;
  }

  .console-line {
    grid-template-columns: 1fr 16px;
    margin-top: 6px;
    gap: 5px;
  }

  .console-line::after {
    width: 16px;
    height: 10px;
  }

  .actions {
    flex-direction: column;
  }

  .service-state,
  .console-link {
    width: min(100%, 13rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .access-key {
    left: calc(50% - 15px);
    animation: none;
  }

  .state-dot::after {
    animation: none;
  }

  .console-link {
    transition: none;
  }
}
`

export const HomePage = () => (
  <>
    {raw('<!doctype html>')}
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Sight Cache admin service availability." />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content="#f5f7f8" />
        <title>Admin Worker | Sight Cache</title>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <style>{raw(styles)}</style>
      </head>
      <body>
        <main class="page-shell">
          <section class="status-card" aria-labelledby="page-title">
            <img class="brand-logo" src="/logo.svg" alt="" width="92" height="92" />
            <p class="brand-name">Sight Cache</p>
            <p class="service-name">Admin worker</p>
            <h1 id="page-title">Service is ready</h1>
            <p class="description">
              Manage collector devices and access tokens from the protected console.
            </p>
            <div class="control-illustration" aria-hidden="true">
              <div class="device-stack">
                <span class="device-row"></span>
                <span class="device-row"></span>
                <span class="device-row"></span>
              </div>
              <div class="access-track">
                <span class="access-key"></span>
              </div>
              <div class="console-panel">
                <div class="console-bar">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <span class="console-line"></span>
                <span class="console-line"></span>
                <span class="console-line"></span>
              </div>
            </div>
            <div class="actions">
              <div class="service-state" role="status">
                <span class="state-dot" aria-hidden="true"></span>
                <span>Operational</span>
              </div>
              <a class="console-link" href="/admin">Open device console</a>
            </div>
          </section>
        </main>
      </body>
    </html>
  </>
)
