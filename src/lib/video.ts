import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ffmpeg binary; in Docker it is installed via `apk add ffmpeg`, locally it is
// expected on PATH. Override with FFMPEG_PATH if it lives somewhere else.
const FFMPEG_BIN = process.env.FFMPEG_PATH ?? "ffmpeg";

type Logger = {
  warn: (obj: unknown, msg?: string) => void;
  info?: (obj: unknown, msg?: string) => void;
};

/**
 * Whether a file is an MP4/MOV that benefits from a faststart remux. Raw videos
 * recorded on phones/cameras usually store the moov atom at the END of the file,
 * which forces the browser to fetch large/scattered byte ranges before playback
 * can start. WebM/Ogg don't have this problem, so they are skipped.
 */
export function isFaststartCandidate(mimeType: string, fileName: string): boolean {
  const mp4ish = mimeType === "video/mp4" || mimeType === "video/quicktime";
  const lower = fileName.toLowerCase();
  return mp4ish || lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".m4v");
}

/**
 * Remux an MP4/MOV so the moov atom sits at the front (`-movflags +faststart`).
 * Uses stream copy (`-c copy`) — no re-encode, so it is fast and lossless. If
 * ffmpeg is missing or fails, the original buffer is returned unchanged so the
 * upload never breaks.
 */
export async function remuxMp4ToFaststart(input: Buffer, logger?: Logger): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "aspire-video-"));
  const inputPath = join(dir, "input");
  const outputPath = join(dir, "output.mp4");

  try {
    await writeFile(inputPath, input);
    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      outputPath,
    ]);

    const output = await readFile(outputPath);
    if (output.length === 0) return input;

    logger?.info?.({ originalBytes: input.length, faststartBytes: output.length }, "Video remuxed to faststart");
    return output;
  } catch (error) {
    logger?.warn({ error }, "Video faststart remux failed; uploading the original file");
    return input;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}
