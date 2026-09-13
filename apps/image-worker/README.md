<div align="center">
  <h1>Sight Cache Image Worker</h1>
  <p><em>Build camera contact sheets and expose protected, read-only MCP tools.</em></p>
  <p>English · <a href="README.zh-TW.md" lang="zh-Hant-TW">繁體中文</a></p>
</div>

**Sight Cache Image Worker** turns camera frames stored by the Ingest Worker
into compact contact sheets. It also exposes a read-only MCP endpoint for
reviewing devices, time windows, nearby captures, and selected original frames.

## How it works

```text
ChatGPT or another MCP client
        |
        | Managed OAuth bearer token
        v
Cloudflare Access
        |
        | Cf-Access-Jwt-Assertion
        v
Stateless MCP endpoint: /mcp
        |
        +--> D1: read active devices
        |
        +--> R2: read frames and cached contact sheets
        |
        +--> Cloudflare Images: compose contact sheets

Cron: 5 * * * * --> Queue --> hourly contact-sheet builder --> R2
```

- The hourly cron enqueues the previous completed hour for every active device.
- Minute contact sheets are built on the first request after the window is
  complete.

## Bindings

| Name | Type | Purpose |
| --- | --- | --- |
| `DB` | D1 | Reads active devices and their latest upload time |
| `BUCKET` | R2 | Reads original frames and stores contact sheets and manifests |
| `IMAGES` | Cloudflare Images | Resizes frames and composes contact sheets |
| `ASSETS` | Workers Static Assets | Supplies the blank image used during composition |
| `CONTACT_SHEET_BUILDER_QUEUE` | Queue | Builds hourly contact sheets through a queue |
| `ACCESS_TEAM_DOMAIN` | Variable | Cloudflare Access team URL, such as `https://team.cloudflareaccess.com` |
| `ACCESS_AUD` | Variable | Audience tag for the MCP Access application |
| `LOCAL_MCP_BYPASS` | Variable | Bypasses Access only for local loopback development |
| `LOCAL_MCP_EMAIL` | Variable | Identity logged when local authentication is bypassed |
| `MCP_ALLOWED_ORIGIN_HOSTNAMES` | Variable | Additional comma-separated browser Origin hostnames |
| `MCP_MAX_LOOKBACK_DAYS` | Variable | Maximum readable history; defaults to 14 days |

## MCP tools

| Tool | Purpose |
| --- | --- |
| `list_devices` | List active devices and their latest upload time |
| `get_contact_sheet` | Return one JPEG contact sheet for a completed minute or hour, including the time and status of each thumbnail |
| `list_frames` | List exact capture timestamps in an interval of up to five minutes |
| `get_original_frame` | Return the unmodified JPEG at an exact `capturedAt` timestamp |

The recommended inspection flow is to call `list_devices`, review every contact
sheet for the hour, inspect suspicious minutes, list nearby frame timestamps,
and retrieve only the original frames needed as evidence.

## Contact sheets

| Window | Trigger | Sampling | Output |
| --- | --- | --- | --- |
| Hour | `5 * * * *` cron and Queue | 60 one-minute samples | Six 2-by-5 JPEG contact sheets |
| Minute | First MCP request | 12 five-second samples | Two 2-by-3 JPEG contact sheets |

- A minute becomes available five minutes after it ends so delayed uploads are
  not permanently recorded as missing.

## R2 object layout

Original frames use the UTC layout established by the Ingest Worker:

```text
frames/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/{mm}/{UTC_TIMESTAMP}.jpg
```

Hourly files live at the hour level. Minute files live in a child directory:

```text
contact-sheets/v1/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/
|-- manifest.json
|-- generations/
|   `-- {generationId}/
|       `-- sheet-{NN}.jpg
`-- {mm}/
    |-- manifest.json
    `-- generations/
        `-- {generationId}/
            `-- sheet-{NN}.jpg
```

## Authentication

Protect `/mcp` with a Cloudflare Access application and enable Access Managed
OAuth. Cloudflare handles OAuth discovery, authorization, and tokens at the
edge.

Configure the following as Worker secrets/variables or in local `.dev.vars`:

```dotenv
ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com
ACCESS_AUD=your-access-application-aud
```

Every identity allowed by the Access application can currently read every
active device. Restrict the Access policy to the owner until identity-to-device
grants are implemented. In production, every hostname and path that can reach
`/mcp` must be protected by Cloudflare Access.

`LOCAL_MCP_BYPASS` is for loopback local development only and must not be
configured in production.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Render the service information page |
| `POST` | `/mcp` | Handle stateless MCP requests after Access validation |

## Local development

Create `.dev.vars` from the `.dev.vars.example` template.

The default template enables the loopback-only local authentication bypass and
uses `LOCAL_MCP_EMAIL` as the logged local identity, so local MCP requests do not
need an Access assertion. The bypass does not apply to non-loopback URLs.
