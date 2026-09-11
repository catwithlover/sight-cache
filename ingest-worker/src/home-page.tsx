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
  position: relative;
  width: min(100%, 44rem);
  padding: clamp(2rem, 6vw, 4rem);
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 30px 30px 30px 11px;
  text-align: center;
}

.brand-mark {
  display: grid;
  width: 58px;
  height: 58px;
  margin: 0 auto 22px;
  align-content: center;
  gap: 5px;
  padding: 13px;
  overflow: hidden;
  background: var(--action);
  border-radius: 17px 17px 9px;
}

.brand-mark span {
  display: block;
  height: 4px;
  background: var(--surface);
  border-radius: 999px;
}

.brand-mark span:nth-child(1) {
  width: 16px;
}

.brand-mark span:nth-child(2) {
  width: 30px;
}

.brand-mark span:nth-child(3) {
  width: 22px;
  margin-left: 8px;
  background: #f6dca9;
}

.brand-name {
  margin: 0;
  color: var(--action);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1 {
  margin: 13px 0 0;
  color: var(--ink);
  font-size: clamp(2.25rem, 8vw, 3.6rem);
  font-weight: 650;
  letter-spacing: -0.05em;
  line-height: 1.12;
}

.transfer-illustration {
  display: grid;
  width: min(100%, 32rem);
  min-height: 164px;
  grid-template-columns: 88px minmax(80px, 1fr) 108px;
  margin: 30px auto 0;
  padding: 26px;
  align-items: center;
  gap: 14px;
  background: var(--action-soft);
  border: 1px solid #bfd0e5;
  border-radius: 22px 22px 22px 8px;
}

.camera-shape {
  position: relative;
  width: 82px;
  height: 62px;
  background: var(--action);
  border-radius: 18px 18px 10px;
}

.camera-shape::before {
  position: absolute;
  top: -8px;
  left: 13px;
  width: 29px;
  height: 11px;
  background: var(--action);
  border-radius: 7px 7px 0 0;
  content: "";
}

.camera-lens {
  position: absolute;
  top: 13px;
  right: 13px;
  width: 36px;
  height: 36px;
  background: var(--surface);
  border: 8px solid #8bb9e8;
  border-radius: 50%;
}

.camera-light {
  position: absolute;
  top: 13px;
  left: 13px;
  width: 8px;
  height: 8px;
  background: var(--accent);
  border: 2px solid #f6dca9;
  border-radius: 50%;
}

.signal-track {
  position: relative;
  height: 56px;
}

.signal-track::before {
  position: absolute;
  top: 27px;
  right: 0;
  left: 0;
  border-top: 2px dashed #7fa4ca;
  content: "";
}

.signal-track::after {
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

.traveling-frame {
  position: absolute;
  z-index: 1;
  top: 12px;
  left: 0;
  width: 31px;
  height: 27px;
  overflow: hidden;
  background: #fff8e9;
  border: 3px solid var(--accent);
  border-radius: 7px 7px 4px;
  animation: frame-travel 3.2s ease-in-out infinite;
}

.traveling-frame::before {
  position: absolute;
  right: 3px;
  bottom: 3px;
  left: 3px;
  height: 8px;
  background: #a7c8ea;
  border-radius: 4px 4px 2px 2px;
  clip-path: polygon(0 100%, 28% 28%, 48% 68%, 70% 8%, 100% 100%);
  content: "";
}

.archive-shape {
  position: relative;
  width: 102px;
  height: 96px;
}

.archive-shape span {
  position: absolute;
  width: 82px;
  height: 67px;
  border: 2px solid var(--action);
  border-radius: 13px 13px 13px 6px;
}

.archive-shape span:nth-child(1) {
  top: 0;
  left: 0;
  background: #bcd6f1;
}

.archive-shape span:nth-child(2) {
  top: 9px;
  left: 9px;
  background: #f6dca9;
}

.archive-shape span:nth-child(3) {
  top: 18px;
  left: 18px;
  background: var(--surface);
}

.archive-shape span:nth-child(3)::after {
  position: absolute;
  right: 15px;
  bottom: 13px;
  left: 15px;
  height: 10px;
  background: #bcd6f1;
  border-radius: 5px 5px 2px 2px;
  content: "";
  clip-path: polygon(0 100%, 24% 26%, 47% 66%, 70% 8%, 100% 100%);
}

.service-state {
  display: inline-flex;
  min-height: 36px;
  margin-top: 28px;
  padding: 7px 13px;
  align-items: center;
  gap: 9px;
  color: var(--success);
  background: var(--success-soft);
  border: 1px solid #c5ddcf;
  border-radius: 999px;
  font-size: 0.84rem;
  font-weight: 750;
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

@keyframes frame-travel {
  0%,
  14% {
    left: 0;
  }

  72%,
  100% {
    left: calc(100% - 31px);
  }
}

@media (max-width: 430px) {
  .status-card {
    padding: 2.25rem 1.5rem 2.5rem;
    border-radius: 23px 23px 23px 9px;
  }

  .brand-mark {
    width: 52px;
    height: 52px;
    margin-bottom: 20px;
    padding: 11px;
  }

  .transfer-illustration {
    min-height: 132px;
    grid-template-columns: 60px minmax(46px, 1fr) 72px;
    padding: 19px 16px;
    gap: 8px;
  }

  .camera-shape {
    width: 60px;
    height: 47px;
    border-radius: 14px 14px 8px;
  }

  .camera-shape::before {
    top: -6px;
    left: 10px;
    width: 22px;
    height: 8px;
  }

  .camera-lens {
    top: 10px;
    right: 9px;
    width: 27px;
    height: 27px;
    border-width: 6px;
  }

  .camera-light {
    top: 10px;
    left: 9px;
    width: 7px;
    height: 7px;
  }

  .archive-shape {
    width: 72px;
    height: 72px;
  }

  .archive-shape span {
    width: 56px;
    height: 48px;
    border-radius: 10px 10px 10px 5px;
  }

  .archive-shape span:nth-child(2) {
    top: 7px;
    left: 7px;
  }

  .archive-shape span:nth-child(3) {
    top: 14px;
    left: 14px;
  }

  .archive-shape span:nth-child(3)::after {
    right: 10px;
    bottom: 9px;
    left: 10px;
    height: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .traveling-frame {
    left: calc(50% - 15px);
    animation: none;
  }

  .state-dot::after {
    animation: none;
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
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content="#f5f7f8" />
        <title>Sight Cache</title>
        <style>{raw(styles)}</style>
      </head>
      <body>
        <main class="page-shell">
          <section class="status-card" aria-labelledby="page-title">
            <div class="brand-mark" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <p class="brand-name">Sight Cache</p>
            <h1 id="page-title">Service is ready</h1>
            <div class="transfer-illustration" aria-hidden="true">
              <div class="camera-shape">
                <span class="camera-light"></span>
                <span class="camera-lens"></span>
              </div>
              <div class="signal-track">
                <span class="traveling-frame"></span>
              </div>
              <div class="archive-shape">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
            <div class="service-state" role="status">
              <span class="state-dot" aria-hidden="true"></span>
              <span>Operational</span>
            </div>
          </section>
        </main>
      </body>
    </html>
  </>
)
