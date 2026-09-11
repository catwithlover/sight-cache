<div align="center">
  <h1>Sight Cache Collector</h1>
  <p><em>Capture RTSP camera frames and upload them to Sight Cache.</em></p>
  <p>English · <a href="README.zh-TW.md" lang="zh-Hant-TW">繁體中文</a></p>
</div>

**Sight Cache Collector** runs near an RTSP camera. It uses FFmpeg to save
timestamped JPEG frames to a local spool directory, then uploads them one at a
time to the Sight Cache Ingest Worker.

## How it works

```text
RTSP camera
     |
     v
   FFmpeg --> frames/*.jpg --> sequential upload queue
                                      |
                                      v
                              Ingest Worker
```

- FFmpeg connects over RTSP/TCP and captures one JPEG at the configured
  interval, which defaults to five seconds, without audio.

## Requirements

- Node.js 24.19.0 or later
- FFmpeg installed
- A reachable RTSP camera stream

## Tapo prerequisites

Before configuring `TAPO_URL`, follow the official
[Tapo setup instructions](https://www.tp-link.com/us/support/faq/2680/).

- Confirm that the camera model supports RTSP. Support varies by model.
- In the Tapo app, open **Device Settings > Advanced Settings > Camera
  Account** and create dedicated camera credentials. These are separate from
  the Tapo account used to sign in to the app.
- Find the camera's local IP address and keep the Collector on the same trusted
  local network.
- Use `stream1` for high quality or `stream2` for standard quality.

## Configuration

| Name | Purpose |
| --- | --- |
| `API_ENDPOINT` | Complete Ingest Worker endpoint ending in `/api/ingest` |
| `BEARER_TOKEN` | Complete Collector Token returned by the Admin Worker |
| `TAPO_URL` | RTSP stream URL, including the camera credentials and address |
| `CAPTURE_INTERVAL_SECONDS` | Optional positive capture interval in seconds; defaults to `5` |

## Run

Start the long-running collector process from this directory:

```sh
npm start
```

## Docker Compose

`compose.yml` defines two isolated camera instances that share the same
Collector image. Create the ignored `compose.env` file from
`compose.env.example`, then give each camera its own Collector Token, RTSP URL,
and optional capture interval.

Build the image and start every camera instance:

```sh
docker compose --env-file compose.env up --build --detach
```

Start only one camera instance by specifying its service name:

```sh
docker compose --env-file compose.env up --build --detach camera-1
```

Each instance has a separate named volume mounted at `/app/frames`. To add
another camera, duplicate a camera service and its volume in `compose.yml`, then
add the corresponding camera-prefixed values to `compose.env`.

## Capture and upload behavior

Frames are written beneath `frames/` with the host's local time and UTC offset:

```text
YYYY-MM-DDTHH:mm:ss±HHMM.jpg
```

The Collector sends the timestamped filename in `X-Filename`, the complete
Collector Token as a bearer token, and the JPEG bytes as the request body.
Uploads are processed sequentially so a slow request does not create parallel
upload bursts.

## Security

- Restrict access to the host because locally spooled frames may contain
  sensitive visual information.
