import { WorkerHomePage } from '@sight-cache/worker-home-page'

const styles = `
.control-illustration {
  --illustration-columns: 112px minmax(64px, 1fr) 126px;
  --illustration-gap: 13px;
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
  .control-illustration {
    --illustration-min-height: 140px;
    --illustration-columns: 78px minmax(34px, 1fr) 84px;
    --illustration-padding: 18px 13px;
    --illustration-gap: 6px;
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
}

@media (prefers-reduced-motion: reduce) {
  .access-key {
    left: calc(50% - 15px);
    animation: none;
  }
}
`

export const HomePage = () => (
  <WorkerHomePage
    documentTitle="Admin Worker | Sight Cache"
    metaDescription="Sight Cache Admin Worker endpoint."
    serviceName="Admin worker"
    description="Manage collector devices and access tokens from the protected console."
    illustrationClassName="control-illustration"
    serviceStyles={styles}
    action={{ href: '/admin', label: 'Open device console' }}
    illustration={
      <>
        <div class="device-stack">
          <span class="device-row"></span>
          <span class="device-row"></span>
          <span class="device-row"></span>
        </div>
        <div class="flow-track">
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
      </>
    }
  />
)
