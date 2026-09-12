import { WorkerHomePage } from '@sight-cache/worker-home-page'

const styles = `
.processing-illustration {
  --illustration-columns: 96px minmax(70px, 1fr) 112px;
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
  .processing-illustration {
    --illustration-min-height: 140px;
    --illustration-columns: 72px minmax(38px, 1fr) 78px;
    --illustration-padding: 18px 14px;
    --illustration-gap: 7px;
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
}
`

export const HomePage = () => (
  <WorkerHomePage
    documentTitle="Image Worker | Sight Cache"
    metaDescription="Sight Cache Image Worker endpoint."
    serviceName="Image worker"
    description="Sample stored frames and assemble hourly contact sheets."
    illustrationClassName="processing-illustration"
    serviceStyles={styles}
    illustration={
      <>
        <div class="frame-stack">
          <span class="frame-card"></span>
          <span class="frame-card"></span>
          <span class="frame-card"></span>
        </div>
        <div class="flow-track">
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
      </>
    }
  />
)
