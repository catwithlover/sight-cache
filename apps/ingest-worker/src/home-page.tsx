import { WorkerHomePage } from '@sight-cache/worker-home-page'

const styles = `
.transfer-illustration {
  --illustration-min-height: 164px;
  --illustration-columns: 88px minmax(80px, 1fr) 108px;
  --illustration-margin-top: 30px;
  --illustration-padding: 26px;
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
  .transfer-illustration {
    --illustration-min-height: 132px;
    --illustration-columns: 60px minmax(46px, 1fr) 72px;
    --illustration-padding: 19px 16px;
    --illustration-gap: 8px;
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
}
`

export const HomePage = () => (
  <WorkerHomePage
    documentTitle="Ingest Worker | Sight Cache"
    metaDescription="Sight Cache Ingest Worker endpoint."
    serviceName="Ingest worker"
    description="Authenticate collector uploads and store original camera frames."
    illustrationClassName="transfer-illustration"
    serviceStyles={styles}
    illustration={
      <>
        <div class="camera-shape">
          <span class="camera-light"></span>
          <span class="camera-lens"></span>
        </div>
        <div class="flow-track">
          <span class="traveling-frame"></span>
        </div>
        <div class="archive-shape">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </>
    }
  />
)
