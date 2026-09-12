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

.processing-illustration {
  display: grid;
  width: min(100%, 32rem);
  min-height: 174px;
  grid-template-columns: 96px minmax(70px, 1fr) 112px;
  margin: 28px auto 0;
  padding: 25px;
  align-items: center;
  gap: 14px;
  background: var(--action-soft);
  border: 1px solid #bfd0e5;
  border-radius: 22px 22px 22px 8px;
}

.frame-stack {
  position: relative;
  width: 92px;
  height: 94px;
}

.frame-card {
  position: absolute;
  width: 76px;
  height: 52px;
  overflow: hidden;
  background: #f9fbfd;
  border: 2px solid var(--action);
  border-radius: 10px 10px 10px 4px;
}

.frame-card::before {
  position: absolute;
  top: 8px;
  right: 9px;
  width: 8px;
  height: 8px;
  background: var(--accent);
  border-radius: 50%;
  content: "";
}

.frame-card::after {
  position: absolute;
  right: 8px;
  bottom: 8px;
  left: 8px;
  height: 19px;
  background: #9fc3e8;
  border-radius: 5px 5px 2px 2px;
  clip-path: polygon(0 100%, 25% 31%, 45% 70%, 68% 8%, 100% 100%);
  content: "";
}

.frame-card:nth-child(1) {
  top: 0;
  left: 0;
  background: #c6dbf1;
}

.frame-card:nth-child(2) {
  top: 15px;
  left: 8px;
  background: #fff4dd;
}

.frame-card:nth-child(3) {
  top: 30px;
  left: 16px;
}

.process-track {
  position: relative;
  height: 56px;
}

.process-track::before {
  position: absolute;
  top: 27px;
  right: 0;
  left: 0;
  border-top: 2px dashed #7fa4ca;
  content: "";
}

.process-track::after {
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

.moving-frame {
  position: absolute;
  z-index: 1;
  top: 13px;
  left: 0;
  width: 29px;
  height: 27px;
  background: #fff8e9;
  border: 3px solid var(--accent);
  border-radius: 7px 7px 4px;
  animation: frame-sort 3.2s ease-in-out infinite;
}

.contact-sheet {
  display: grid;
  width: 108px;
  height: 124px;
  grid-template: repeat(5, 1fr) / repeat(2, 1fr);
  gap: 5px;
  padding: 9px;
  background: var(--surface);
  border: 2px solid var(--action);
  border-radius: 13px 13px 13px 6px;
}

.contact-sheet span {
  background: #bcd6f1;
  border-radius: 3px 3px 3px 1px;
}

.contact-sheet span:nth-child(3n + 2) {
  background: #f6dca9;
}

.contact-sheet span:nth-child(4n) {
  background: #8bb9e8;
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

@keyframes frame-sort {
  0%,
  14% {
    left: 0;
  }

  72%,
  100% {
    left: calc(100% - 29px);
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

  .processing-illustration {
    min-height: 140px;
    grid-template-columns: 72px minmax(38px, 1fr) 78px;
    padding: 18px 14px;
    gap: 7px;
  }

  .frame-stack {
    width: 70px;
    height: 72px;
  }

  .frame-card {
    width: 57px;
    height: 39px;
    border-radius: 8px 8px 8px 3px;
  }

  .frame-card::before {
    top: 6px;
    right: 7px;
    width: 6px;
    height: 6px;
  }

  .frame-card::after {
    right: 6px;
    bottom: 6px;
    left: 6px;
    height: 14px;
  }

  .frame-card:nth-child(2) {
    top: 11px;
    left: 6px;
  }

  .frame-card:nth-child(3) {
    top: 22px;
    left: 12px;
  }

  .contact-sheet {
    width: 76px;
    height: 94px;
    gap: 3px;
    padding: 7px;
    border-radius: 10px 10px 10px 5px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .moving-frame {
    left: calc(50% - 14px);
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
        <meta name="description" content="Sight Cache image service availability." />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content="#f5f7f8" />
        <title>Image Worker | Sight Cache</title>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <style>{raw(styles)}</style>
      </head>
      <body>
        <main class="page-shell">
          <section class="status-card" aria-labelledby="page-title">
            <img class="brand-logo" src="/logo.svg" alt="" width="92" height="92" />
            <p class="brand-name">Sight Cache</p>
            <p class="service-name">Image worker</p>
            <h1 id="page-title">Service is ready</h1>
            <p class="description">
              Sampling stored frames and assembling hourly contact sheets.
            </p>
            <div class="processing-illustration" aria-hidden="true">
              <div class="frame-stack">
                <span class="frame-card"></span>
                <span class="frame-card"></span>
                <span class="frame-card"></span>
              </div>
              <div class="process-track">
                <span class="moving-frame"></span>
              </div>
              <div class="contact-sheet">
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
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
