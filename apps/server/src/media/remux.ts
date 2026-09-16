import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';

const MAXIMUM_PROBE_INPUT_BYTES = 8 * 1024 * 1024;
const MAXIMUM_PROBE_OUTPUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 8_000;
const REMUX_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const DEFAULT_MEDIA_PROCESS_CONCURRENCY = 2;

type MediaChildProcess = ChildProcess & Readonly<{ stdin: Writable; stdout: Readable }>;

export type MediaProbeEvidence = Readonly<{
  videoCodecs: readonly string[];
  audioCodecs: readonly string[];
}>;

export type RemuxSelection =
  | Readonly<{ kind: 'stream-copy-remux' }>
  | Readonly<{ kind: 'unsupported' }>;

export type RemuxStream = Readonly<{
  output: Readable;
  abort: () => void;
}>;

export interface MediaAdaptationAdapter {
  probe(input: Readable, signal: AbortSignal): Promise<MediaProbeEvidence>;
  remux(input: Readable, signal: AbortSignal): Promise<RemuxStream>;
}

export class MediaProcessError extends Error {
  readonly code: 'process_unavailable' | 'probe_failed' | 'remux_failed' | 'cancelled' | 'busy';

  constructor(code: MediaProcessError['code']) {
    super('Media adaptation process failed.');
    this.name = 'MediaProcessError';
    this.code = code;
  }
}

export const mediaProcessPolicy = Object.freeze({
  shell: false,
  providerUrlInArguments: false,
  inheritProcessEnvironment: false,
  probeInput: 'pipe:0' as const,
  remuxInput: 'pipe:0' as const,
  remuxOutput: 'pipe:1' as const,
  maximumProbeInputBytes: MAXIMUM_PROBE_INPUT_BYTES,
  maximumConcurrency: DEFAULT_MEDIA_PROCESS_CONCURRENCY,
  maximumQueue: DEFAULT_MEDIA_PROCESS_CONCURRENCY * 4,
});

export function ffprobeArguments(): readonly string[] {
  return Object.freeze([
    '-v',
    'error',
    '-protocol_whitelist',
    'pipe',
    '-show_entries',
    'stream=codec_type,codec_name',
    '-of',
    'json',
    '-i',
    'pipe:0',
  ]);
}

export function ffmpegStreamCopyArguments(): readonly string[] {
  return Object.freeze([
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-protocol_whitelist',
    'pipe',
    '-i',
    'pipe:0',
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-c',
    'copy',
    '-f',
    'mp4',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  ]);
}

export function selectRemuxPath(evidence: MediaProbeEvidence): RemuxSelection {
  const compatible =
    evidence.videoCodecs.length === 1 &&
    evidence.videoCodecs[0] === 'h264' &&
    evidence.audioCodecs.length >= 1 &&
    evidence.audioCodecs.every((codec) => codec === 'aac');
  return Object.freeze({ kind: compatible ? 'stream-copy-remux' : 'unsupported' });
}

type Waiter = Readonly<{
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  onAbort: () => void;
}>;

export class BoundedProcessPool {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(
    private readonly limit = DEFAULT_MEDIA_PROCESS_CONCURRENCY,
    private readonly maximumQueue = limit * 4,
  ) {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 16 ||
      !Number.isInteger(maximumQueue) ||
      maximumQueue < 0 ||
      maximumQueue > 128
    ) {
      throw new MediaProcessError('process_unavailable');
    }
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new MediaProcessError('cancelled'));
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.releaseFunction());
    }
    if (this.waiters.length >= this.maximumQueue) {
      return Promise.reject(new MediaProcessError('busy'));
    }
    return new Promise<() => void>((resolve, reject) => {
      const onAbort = (): void => {
        const index = this.waiters.findIndex((waiter) => waiter.onAbort === onAbort);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new MediaProcessError('cancelled'));
      };
      const waiter: Waiter = Object.freeze({ resolve, reject, signal, onAbort });
      this.waiters.push(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  snapshot(): Readonly<{ active: number; queued: number; limit: number; maximumQueue: number }> {
    return Object.freeze({
      active: this.active,
      queued: this.waiters.length,
      limit: this.limit,
      maximumQueue: this.maximumQueue,
    });
  }

  private releaseFunction(): () => void {
    let released = false;
    return (): void => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.drain();
    };
  }

  private drain(): void {
    while (this.active < this.limit && this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (!waiter) return;
      waiter.signal.removeEventListener('abort', waiter.onAbort);
      if (waiter.signal.aborted) {
        waiter.reject(new MediaProcessError('cancelled'));
        continue;
      }
      this.active += 1;
      waiter.resolve(this.releaseFunction());
    }
  }
}

function processEnvironment(): NodeJS.ProcessEnv {
  const pathValue = process.env.PATH;
  return pathValue ? { PATH: pathValue } : {};
}

function waitForSpawn(child: MediaChildProcess): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onSpawn = (): void => {
      child.removeListener('error', onError);
      resolve();
    };
    const onError = (): void => {
      child.removeListener('spawn', onSpawn);
      reject(new MediaProcessError('process_unavailable'));
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

async function writeInput(
  input: Readable,
  child: MediaChildProcess,
  maximumBytes: number | null,
  signal: AbortSignal,
): Promise<void> {
  let bytes = 0;
  try {
    for await (const value of input) {
      if (signal.aborted) throw new MediaProcessError('cancelled');
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      if (maximumBytes !== null && bytes >= maximumBytes) break;
      const remaining = maximumBytes === null ? chunk.length : Math.max(0, maximumBytes - bytes);
      const written = remaining < chunk.length ? chunk.subarray(0, remaining) : chunk;
      if (written.length === 0) break;
      bytes += written.length;
      if (!child.stdin.write(written)) await once(child.stdin, 'drain');
      if (maximumBytes !== null && bytes >= maximumBytes) break;
    }
    child.stdin.end();
  } catch (error) {
    child.stdin.destroy();
    throw error;
  }
}

async function readBoundedOutput(input: Readable, maximumBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of input) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    bytes += chunk.length;
    if (bytes > maximumBytes) throw new MediaProcessError('probe_failed');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

function parseProbeEvidence(body: Buffer): MediaProbeEvidence {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new MediaProcessError('probe_failed');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new MediaProcessError('probe_failed');
  }
  const streams = (parsed as Readonly<Record<string, unknown>>).streams;
  if (!Array.isArray(streams)) throw new MediaProcessError('probe_failed');
  const videoCodecs: string[] = [];
  const audioCodecs: string[] = [];
  for (const stream of streams) {
    if (typeof stream !== 'object' || stream === null || Array.isArray(stream)) continue;
    const record = stream as Readonly<Record<string, unknown>>;
    if (typeof record.codec_type !== 'string' || typeof record.codec_name !== 'string') continue;
    const codec = record.codec_name.toLowerCase();
    if (!/^[a-z0-9._-]{1,64}$/u.test(codec)) continue;
    if (record.codec_type === 'video') videoCodecs.push(codec);
    if (record.codec_type === 'audio') audioCodecs.push(codec);
  }
  if (videoCodecs.length === 0) throw new MediaProcessError('probe_failed');
  return Object.freeze({
    videoCodecs: Object.freeze(videoCodecs),
    audioCodecs: Object.freeze(audioCodecs),
  });
}

function terminate(child: MediaChildProcess): void {
  if (!child.killed) child.kill('SIGKILL');
}

function guardStdin(child: MediaChildProcess): void {
  child.stdin.once('error', () => terminate(child));
}

export class NodeFfmpegMediaAdapter implements MediaAdaptationAdapter {
  constructor(
    private readonly ffprobePath = 'ffprobe',
    private readonly ffmpegPath = 'ffmpeg',
    private readonly pool = new BoundedProcessPool(),
  ) {}

  async probe(input: Readable, signal: AbortSignal): Promise<MediaProbeEvidence> {
    const release = await this.pool.acquire(signal);
    const child = spawn(this.ffprobePath, [...ffprobeArguments()], {
      shell: false,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: processEnvironment(),
    });
    guardStdin(child);
    const abort = (): void => terminate(child);
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, PROBE_TIMEOUT_MS);
    timeout.unref();

    try {
      await waitForSpawn(child);
      const outputPromise = readBoundedOutput(child.stdout, MAXIMUM_PROBE_OUTPUT_BYTES);
      const inputPromise = writeInput(input, child, MAXIMUM_PROBE_INPUT_BYTES, signal);
      const [closeResult, output] = await Promise.all([
        once(child, 'close'),
        outputPromise,
        inputPromise,
      ]).then(([close, captured]) => [close, captured] as const);
      const exitCode = closeResult[0];
      if (signal.aborted) throw new MediaProcessError('cancelled');
      if (exitCode !== 0) throw new MediaProcessError('probe_failed');
      return parseProbeEvidence(output);
    } catch (error) {
      if (error instanceof MediaProcessError) throw error;
      throw new MediaProcessError('probe_failed');
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      terminate(child);
      release();
    }
  }

  async remux(input: Readable, signal: AbortSignal): Promise<RemuxStream> {
    const release = await this.pool.acquire(signal);
    const child = spawn(this.ffmpegPath, [...ffmpegStreamCopyArguments()], {
      shell: false,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: processEnvironment(),
    });
    guardStdin(child);
    const abort = (): void => terminate(child);
    const timeout = setTimeout(abort, REMUX_TIMEOUT_MS);
    timeout.unref();
    signal.addEventListener('abort', abort, { once: true });

    try {
      await waitForSpawn(child);
    } catch (error) {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      terminate(child);
      release();
      if (error instanceof MediaProcessError) throw error;
      throw new MediaProcessError('process_unavailable');
    }

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      release();
    };
    child.once('exit', (code) => {
      if (code !== 0 && code !== null && !signal.aborted) {
        child.stdout.destroy(new MediaProcessError('remux_failed'));
      }
    });
    child.once('close', cleanup);
    child.once('error', cleanup);
    void writeInput(input, child, null, signal).catch(() => terminate(child));

    return Object.freeze({
      output: child.stdout,
      abort,
    });
  }
}
