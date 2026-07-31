import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { app } from "electron";
import ffmpegBinaryPath from "ffmpeg-static";
import ffprobeStaticPkg from "ffprobe-static";

/**
 * Video codecs Chromium's native <video> element reliably decodes, across
 * platforms. HEVC is deliberately excluded - Windows support depends on an
 * optional codec pack and isn't guaranteed, so we'd rather over-flag it and
 * let the user re-encode than have playback silently fail on some machines.
 */
const SUPPORTED_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);

/**
 * ffmpeg-static/ffprobe-static ship their binaries inside node_modules/,
 * which the packaged build excludes (see apps/desktop/scripts/pack.mjs) -
 * pack.mjs copies them into resources/bin/ instead, so packaged builds read
 * from there while dev reads straight from node_modules.
 */
function resolveBinary(devPath: string): string {
  if (!app.isPackaged) return devPath;
  return join(process.resourcesPath, "bin", basename(devPath));
}

function ffmpegPath(): string {
  if (!ffmpegBinaryPath) throw new Error("ffmpeg-static did not resolve a binary path for this platform.");
  return resolveBinary(ffmpegBinaryPath);
}

function ffprobePath(): string {
  return resolveBinary(ffprobeStaticPkg.path);
}

export interface MediaProbeResult {
  videoCodec: string | null;
  audioCodec: string | null;
  durationSec: number | null;
  /** false = detected an unsupported codec. null = probe failed - callers should fail open (don't block on a probing bug). */
  supported: boolean | null;
  reason?: string;
}

function runProcess(bin: string, args: string[]): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(bin, args);
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ stdout, code }));
  });
}

/** Probe a media file's codecs via ffprobe. Never throws - a failed probe reports `supported: null`. */
export async function probeMedia(absPath: string): Promise<MediaProbeResult> {
  try {
    const { stdout, code } = await runProcess(ffprobePath(), [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      "-show_format",
      absPath,
    ]);
    if (code !== 0) {
      return { videoCodec: null, audioCodec: null, durationSec: null, supported: null, reason: `ffprobe exited with code ${code}` };
    }

    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string; codec_name?: string }>;
      format?: { duration?: string };
    };
    const videoCodec = parsed.streams?.find((s) => s.codec_type === "video")?.codec_name ?? null;
    const audioCodec = parsed.streams?.find((s) => s.codec_type === "audio")?.codec_name ?? null;
    const durationSec = parsed.format?.duration ? Number(parsed.format.duration) : null;

    if (!videoCodec) {
      // No video stream (e.g. an audio-only file picked via the "media" filter) - nothing to validate.
      return { videoCodec, audioCodec, durationSec, supported: true };
    }

    const supported = SUPPORTED_VIDEO_CODECS.has(videoCodec);
    return {
      videoCodec,
      audioCodec,
      durationSec,
      supported,
      reason: supported ? undefined : `Video codec "${videoCodec}" isn't supported for in-app playback.`,
    };
  } catch (err) {
    return {
      videoCodec: null,
      audioCodec: null,
      durationSec: null,
      supported: null,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Re-encode a video to H.264/AAC mp4 via ffmpeg. `durationSec` (from probeMedia) drives progress percent; omit to skip progress reporting. */
export async function reencodeVideo(
  absSrcPath: string,
  absOutPath: string,
  durationSec: number | null,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpegPath(), [
      "-y",
      "-i", absSrcPath,
      "-c:v", "libx264",
      "-preset", "fast",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      absOutPath,
    ]);

    let stderrTail = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-2000);
      if (onProgress && durationSec) {
        const match = /time=(\d+):(\d+):(\d+\.\d+)/.exec(text);
        if (match) {
          const elapsedSec = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
          onProgress(Math.min(99, Math.round((elapsedSec / durationSec) * 100)));
        }
      }
    });

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        onProgress?.(100);
        resolvePromise();
      } else {
        rejectPromise(new Error(`ffmpeg exited with code ${code}: ${stderrTail}`));
      }
    });
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Pick a filename that doesn't collide in `dir`, appending _1, _2, ... before the extension if needed. */
export async function dedupeFilename(dir: string, fileName: string): Promise<string> {
  if (!(await pathExists(join(dir, fileName)))) return fileName;

  const ext = extname(fileName);
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  let i = 1;
  while (await pathExists(join(dir, `${base}_${i}${ext}`))) {
    i++;
  }
  return `${base}_${i}${ext}`;
}
