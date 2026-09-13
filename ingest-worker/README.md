<div align="center">
  <h1>Sight Cache Ingest Worker</h1>
  <p><em>Authenticate collector devices and store camera frames in Cloudflare R2.</em></p>
  <p>English · <a href="README.zh-TW.md" lang="zh-Hant-TW">繁體中文</a></p>
</div>

**Sight Cache Ingest Worker** receives JPEG frames from authenticated Sight
Cache collectors. It validates each upload, stores the frame under a
time-based R2 key, and records recent device activity in D1.

## How it works

```text
Collector
    |
    | POST /api/ingest
    | Bearer token + raw JPEG
    v
Hono ingest endpoint
    |
    +--> D1: verify device token and record activity
    |
    +--> R2: store the frame under frames/{deviceId}/...
```

- The request body is streamed directly to R2 after its headers are validated.
- Token and device activity writes are throttled to reduce D1 write volume.

## Bindings

| Name | Type | Purpose |
| --- | --- | --- |
| `DB` | D1 | Reads devices and token hashes, then records activity |
| `BUCKET` | R2 | Stores uploaded JPEG frames |

## Authentication

Create a device with the Admin Worker and save the collector token returned at
creation time. Send the complete token in every upload:

```http
Authorization: Bearer scd_<token-id>.<secret>
```

## Upload API

`POST /api/ingest` accepts one raw JPEG per request.

| Header | Requirement |
| --- | --- |
| `Authorization` | A valid collector bearer token |
| `Content-Type` | `image/jpeg` |
| `Content-Length` | A positive integer; the image must not exceed 10 MiB |
| `X-Filename` | A non-future capture timestamp in `YYYY-MM-DDTHH:mm:ss±HHMM.jpg` format |

The request body must contain the JPEG bytes. For example:

```sh
curl --fail-with-body http://localhost:8787/api/ingest \
  --request POST \
  --header "Authorization: Bearer scd_<token-id>.<secret>" \
  --header "Content-Type: image/jpeg" \
  --header "Content-Length: $(wc -c < frame.jpg)" \
  --header "X-Filename: 2026-09-12T03:42:47+0800.jpg" \
  --data-binary @frame.jpg
```

A successful upload returns HTTP `200`:

```json
{
  "status": 200,
  "message": "process successfully"
}
```

Frame keys are immutable. If the same device and capture timestamp already
exist, the Worker returns HTTP `409` with error code `frame_already_exists` and
leaves the existing R2 object unchanged.

## R2 object layout

Frames are grouped by device and UTC capture time:

```text
frames/{deviceId}/{YYYY}/{MM}/{DD}/{HH}/{mm}/{UTC_TIMESTAMP}.jpg
```

For example, `2026-09-12T03:42:47+0800.jpg` is stored as:

```text
frames/550e8400-e29b-41d4-a716-446655440000/2026/09/11/19/42/20260911T194247Z.jpg
```

## Activity tracking

- A successful token verification updates `device_tokens.last_used_at` at most
  once every five minutes.
- A successful R2 write updates `devices.last_frame_at` in the background at
  most once every five seconds.
- Conditional D1 updates prevent concurrent uploads from causing unnecessary
  writes.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/ingest` | Authenticate a collector and store one JPEG frame |
| `GET` | `/` | Return a basic availability response |
