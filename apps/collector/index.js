import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";

const spoolDir = "./frames";
const captureIntervalSeconds = Number(
  process.env.CAPTURE_INTERVAL_SECONDS ?? 5,
);
const streamStallTimeoutMs = Math.max(
  30_000,
  captureIntervalSeconds * 3 * 1000,
);
const restartDelayMs = 5000;

if (!Number.isFinite(captureIntervalSeconds) || captureIntervalSeconds <= 0) {
  throw new Error("CAPTURE_INTERVAL_SECONDS must be a positive number");
}

let shuttingDown = false;
let forceKillTimer;
let restartTimer;
let ffmpeg;
let lastFrameAt = Date.now();
let uploadQueue = Promise.resolve();

await mkdir(spoolDir, { recursive: true });

const uploadFrame = async (filePath, filename) => {
  const binaryData = await readFile(filePath);

  console.log(`Uploading image ${filename} to API`);
  const response = await fetch(process.env.API_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
      "Content-Type": "image/jpeg",
      "Content-Length": String(binaryData.length),
      "X-Filename": filename,
    },
    body: binaryData,
    signal: AbortSignal.timeout(30_000),
  });
  const responseBody = await response.text();

  if (!response.ok) {
    const details = responseBody ? `: ${responseBody.slice(0, 500)}` : "";
    throw new Error(`Upload failed (${response.status})${details}`);
  }
  console.log(`Uploaded ${filename} to the API`);

  await unlink(filePath);
  console.log(`Uploaded and deleted: ${filename}`);
};

const enqueueUpload = (filePath, filename) => {
  uploadQueue = uploadQueue
    .then(() => uploadFrame(filePath, filename))
    .catch((error) => {
      console.error(`Failed to process ${filePath}:`, error);
    });
};

const watcher = fs.watch(spoolDir, (eventType, filename) => {
  if (eventType !== "rename" || !filename) return;
  if (!filename.endsWith(".jpg")) return;

  const filePath = `${spoolDir}/${filename}`;
  if (!fs.existsSync(filePath)) return;

  lastFrameAt = Date.now();
  console.log(`New file detected: ${filePath}`);
  enqueueUpload(filePath, filename);
});

const truncatedSeiMessage =
  /^\[h264 @ 0x[\da-f]+\] SEI type 764 size \d+ truncated at \d+$/i;
const repeatedMessage = /^\s*Last message repeated \d+ times$/;

const startFfmpeg = () => {
  lastFrameAt = Date.now();
  console.log("Starting FFmpeg capture");

  const child = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel", "warning",

    "-rtsp_transport", "tcp",
    "-timeout", String(Math.ceil(streamStallTimeoutMs * 1000)),
    "-i", process.env.TAPO_URL,

    "-an",

    "-vf", `fps=1/${captureIntervalSeconds}`,
    "-q:v", "3",

    "-f", "image2",
    "-strftime", "1",
    "-atomic_writing", "1",

    `${spoolDir}/%Y-%m-%dT%H:%M:%S%z.jpg`,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  ffmpeg = child;

  const ffmpegStderr = createInterface({ input: child.stderr });
  let previousFfmpegMessageWasIgnored = false;

  ffmpegStderr.on("line", (line) => {
    if (truncatedSeiMessage.test(line)) {
      previousFfmpegMessageWasIgnored = true;
      return;
    }

    if (previousFfmpegMessageWasIgnored && repeatedMessage.test(line)) return;

    previousFfmpegMessageWasIgnored = false;
    console.error(`[ffmpeg] ${line}`);
  });

  child.on("error", (error) => {
    console.error("Failed to start FFmpeg:", error);
  });

  child.on("close", (code, signal) => {
    clearTimeout(forceKillTimer);
    console.error(`FFmpeg exited: ${signal ?? code}`);

    if (shuttingDown) return;

    console.error(`Restarting FFmpeg in ${restartDelayMs / 1000} seconds`);
    restartTimer = setTimeout(startFfmpeg, restartDelayMs);
  });
};

startFfmpeg();

const stallWatchdog = setInterval(() => {
  if (
    shuttingDown ||
    !ffmpeg ||
    ffmpeg.exitCode !== null ||
    ffmpeg.signalCode !== null
  ) return;

  const stalledForMs = Date.now() - lastFrameAt;
  if (stalledForMs < streamStallTimeoutMs) return;

  lastFrameAt = Date.now();
  console.error(
    `No new frame for ${Math.round(stalledForMs / 1000)} seconds; restarting FFmpeg`,
  );
  ffmpeg.kill("SIGTERM");
  forceKillTimer = setTimeout(() => {
    if (ffmpeg.exitCode === null && ffmpeg.signalCode === null) {
      console.error("FFmpeg did not stop in time; force stopping it");
      ffmpeg.kill("SIGKILL");
    }
  }, 5000);
}, Math.min(5000, streamStallTimeoutMs / 2));

const shutdown = signal => {
  if (shuttingDown) {
    console.error(`Received ${signal} again, force stopping FFmpeg`);
    ffmpeg?.kill("SIGKILL");
    return;
  }

  shuttingDown = true;
  process.exitCode = signal === "SIGINT" ? 130 : 143;
  clearInterval(stallWatchdog);
  clearTimeout(restartTimer);
  watcher.close();
  console.error(`Received ${signal}, stopping FFmpeg...`);

  if (ffmpeg && ffmpeg.exitCode === null && ffmpeg.signalCode === null) {
    ffmpeg.kill("SIGTERM");
    forceKillTimer = setTimeout(() => {
      if (ffmpeg.exitCode === null && ffmpeg.signalCode === null) {
        console.error("FFmpeg did not stop in time; force stopping it");
        ffmpeg.kill("SIGKILL");
      }
    }, 5000);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
