/** @jsxImportSource hono/jsx */
import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'

const baseStyles = `
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

.service-illustration {
  display: grid;
  width: min(100%, 32rem);
  min-height: var(--illustration-min-height, 174px);
  grid-template-columns: var(--illustration-columns);
  margin: var(--illustration-margin-top, 28px) auto 0;
  padding: var(--illustration-padding, 25px);
  align-items: center;
  gap: var(--illustration-gap, 14px);
  background: var(--action-soft);
  border: 1px solid #bfd0e5;
  border-radius: 22px 22px 22px 8px;
}

.flow-track {
  position: relative;
  height: 56px;
}

.flow-track::before {
  position: absolute;
  top: 27px;
  right: 0;
  left: 0;
  border-top: 2px dashed #7fa4ca;
  content: "";
}

.flow-track::after {
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

.service-state,
.console-link {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border-radius: 999px;
  font-size: 0.84rem;
  font-weight: 750;
}

.service-state {
  margin-top: 28px;
  padding: 7px 13px;
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

.actions {
  display: flex;
  margin-top: 28px;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.actions .service-state {
  min-height: 40px;
  margin-top: 0;
  padding: 8px 14px;
}

.console-link {
  min-height: 40px;
  padding: 8px 14px;
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

  .actions {
    flex-direction: column;
  }

  .actions .service-state,
  .console-link {
    width: min(100%, 13rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .state-dot::after {
    animation: none;
  }

  .console-link {
    transition: none;
  }
}
`

type WorkerHomePageProps = {
  documentTitle: string
  metaDescription: string
  serviceName: string
  description: string
  illustrationClassName: string
  illustration: Child
  serviceStyles: string
  action?: {
    href: string
    label: string
  }
}

export const WorkerHomePage = ({
  documentTitle,
  metaDescription,
  serviceName,
  description,
  illustrationClassName,
  illustration,
  serviceStyles,
  action,
}: WorkerHomePageProps) => (
  <>
    {raw('<!doctype html>')}
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={metaDescription} />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content="#f5f7f8" />
        <title>{documentTitle}</title>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <style>{raw(`${baseStyles}\n${serviceStyles}`)}</style>
      </head>
      <body>
        <main class="page-shell">
          <section class="status-card" aria-labelledby="page-title">
            <img class="brand-logo" src="/logo.svg" alt="" width="92" height="92" />
            <p class="brand-name">Sight Cache</p>
            <p class="service-name">{serviceName}</p>
            <h1 id="page-title">Endpoint is ready</h1>
            <p class="description">{description}</p>
            <div
              class={`service-illustration ${illustrationClassName}`}
              aria-hidden="true"
            >
              {illustration}
            </div>
            {action ? (
              <div class="actions">
                <ServiceState />
                <a class="console-link" href={action.href}>{action.label}</a>
              </div>
            ) : (
              <ServiceState />
            )}
          </section>
        </main>
      </body>
    </html>
  </>
)

const ServiceState = () => (
  <div class="service-state" role="status">
    <span class="state-dot" aria-hidden="true"></span>
    <span>Endpoint reachable</span>
  </div>
)
