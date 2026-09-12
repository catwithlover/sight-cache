<div align="center">
  <img src="docs/assets/logo.svg" alt="Sight Cache" width="180" />
  <h1>Sight Cache</h1>
  <p><em>Give AI agents eyes on the scene and a memory of what happened.</em></p>
  <p>English · <a href="README.zh-TW.md" lang="zh-Hant-TW">繁體中文</a></p>
</div>

**Sight Cache** — A self-hosted camera history pipeline for AI agents, built on
Cloudflare with image inspection through MCP.

## How it works

```text
Administrator <--> Cloudflare Access <--> Admin Worker
                                                +--> D1 devices + token hashes
                                                `--> Collector Token (shown once)

RTSP camera --> FFmpeg Collector --> Ingest Worker --> D1 activity
                                                   `--> R2 original JPEGs

MCP client <--> Access Managed OAuth <--> Image Worker
                                          ^  |  |
Hourly cron --> Queue ---------------------'  |  +--> Cloudflare Images
R2 original JPEGs ----------------------------'  `--> R2 contact sheets + manifests
```

## Components

| Component | Runtime | Responsibility |
| --- | --- | --- |
| [`collector/`](collector/README.md) | Node.js or Docker | Capture and upload RTSP frames |
| [`admin-worker/`](admin-worker/README.md) | Cloudflare Workers | Manage devices, issue Collector Tokens, rotate credentials, and disable access |
| [`ingest-worker/`](ingest-worker/README.md) | Cloudflare Workers | Authenticate collectors, validate image uploads, and store original frames |
| [`image-worker/`](image-worker/README.md) | Cloudflare Workers | Build contact sheets and expose protected, read-only MCP inspection tools |

## Cloudflare services

This project uses the following Cloudflare services and Workers features:

| Service or feature | Used by | Purpose |
| --- | --- | --- |
| Cloudflare Workers | Admin, Ingest, and Image Workers | Run the administration interface, image ingestion API, MCP endpoint, schedules, and Queue handlers |
| Cloudflare Access | Admin and Image Workers | Protect administration and MCP; MCP uses Managed OAuth, and the Worker validates the Access JWT assertion |
| Cloudflare D1 | Admin, Ingest, and Image Workers | Store devices, Collector Token hashes, and activity timestamps, and provide recent active-device information |
| Cloudflare R2 | Ingest and Image Workers | Store original images, contact sheets, and manifests |
| Cloudflare Images | Image Worker | Resize and crop original frames, then compose JPEG contact sheets |
| Cloudflare Queues | Image Worker | Deliver hourly contact-sheet jobs |
| Cron Triggers | Image Worker | Enqueue contact-sheet jobs for the previous complete hour near the start of each hour |
| Workers Static Assets | Admin, Ingest, and Image Workers | Serve administration CSS and JavaScript, service-page assets, and the blank contact-sheet canvas |

## MCP inspection

The Image Worker exposes a stateless `/mcp` endpoint protected by Cloudflare Access Managed OAuth.

| Tool | Purpose |
| --- | --- |
| `list_devices` | List active devices and their latest upload time |
| `get_contact_sheet` | Return one JPEG contact sheet with exact metadata for each slot |
| `list_frames` | List exact capture timestamps in an interval of up to five minutes |
| `get_original_frame` | Return the unmodified JPEG at an exact capture timestamp |

Hourly windows contain 60 one-minute samples across six contact sheets. Minute
windows contain 12 five-second samples across two contact sheets and are built
on the first request after a five-minute finalization delay.

## Storage layout

Object keys use the normalized UTC capture time:

```text
frames/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/{mm}/{UTC_TIMESTAMP}.jpg

contact-sheets/v1/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/
|-- manifest.json
|-- generations/{generationId}/sheet-{NN}.jpg
`-- {mm}/
    |-- manifest.json
    `-- generations/{generationId}/sheet-{NN}.jpg
```

The hour-level manifest publishes scheduled hourly sheets. A minute directory
contains its on-demand sheets.

## Requirements

- Node.js 24.19.0 or later
- FFmpeg, or Docker with Compose, for the Collector
- A reachable RTSP camera stream
- Cloudflare Workers Paid plan

## Getting started

Install all workspace dependencies and run the available type checks:

```sh
npm ci
npm run typecheck
```

Before deployment, provision the shared D1 database and R2 bucket, the
contact-sheet Queues, and the required Access applications, then complete each
`wrangler.jsonc` for your environment.

Apply the D1 migration from the repository root:

```sh
# Local D1
npm run dev:migrate --workspace admin-worker

# Remote D1
npm run prod:migrate --workspace admin-worker
```

Run each service in its own terminal:

```sh
npm run dev --workspace admin-worker
npm run dev --workspace ingest-worker
npm run dev --workspace image-worker
npm start --workspace collector
```

Create a device in the Admin Worker, save the Collector Token when it is shown,
then configure `collector/.env` from `collector/.env.example` with the Ingest
URL, token, and RTSP URL. See each component guide for its detailed
configuration and behavior.

After completing the account-specific configuration and applying the remote D1
migration, deploy the Workers:

```sh
npm run deploy --workspace admin-worker
npm run deploy --workspace ingest-worker
npm run deploy --workspace image-worker
```

## Security and retention

- Protect the Admin Worker and every route that can reach `/mcp` with the
  matching Cloudflare Access applications.
- Every identity admitted by the MCP Access policy can currently inspect every
  active device. Keep that policy restricted until per-device authorization is
  implemented.
- Define an appropriate R2 lifecycle policy based on the sensitivity of the
  images you store.

## Documentation

- [Collector](collector/README.md)
- [Admin Worker](admin-worker/README.md)
- [Ingest Worker](ingest-worker/README.md)
- [Image Worker and MCP](image-worker/README.md)
