export type ParsedByteRange =
  | Readonly<{ kind: 'closed'; start: number; end: number; header: string }>
  | Readonly<{ kind: 'open'; start: number; header: string }>
  | Readonly<{ kind: 'suffix'; length: number; header: string }>;

export type ParsedSatisfiedContentRange = Readonly<{
  start: number;
  end: number;
  total: number | null;
  length: number;
}>;

export type ParsedUnsatisfiedContentRange = Readonly<{
  total: number;
}>;

export class ByteRangeError extends Error {
  constructor() {
    super('Byte range is invalid.');
    this.name = 'ByteRangeError';
  }
}

export class ByteRangeResponseError extends Error {
  constructor() {
    super('Provider byte range response is inconsistent.');
    this.name = 'ByteRangeResponseError';
  }
}

function safeInteger(value: string): number {
  if (!/^\d+$/u.test(value)) throw new ByteRangeError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ByteRangeError();
  return parsed;
}

function safeResponseInteger(value: string): number {
  if (!/^\d+$/u.test(value)) throw new ByteRangeResponseError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ByteRangeResponseError();
  return parsed;
}

export function parseSingleByteRange(value: string | undefined): ParsedByteRange | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128 || trimmed.includes(',')) throw new ByteRangeError();
  const match = /^bytes=(\d*)-(\d*)$/u.exec(trimmed);
  if (!match) throw new ByteRangeError();

  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (!startText && !endText) throw new ByteRangeError();

  if (!startText) {
    const length = safeInteger(endText);
    if (length === 0) throw new ByteRangeError();
    return Object.freeze({ kind: 'suffix', length, header: `bytes=-${length}` });
  }

  const start = safeInteger(startText);
  if (!endText) {
    return Object.freeze({ kind: 'open', start, header: `bytes=${start}-` });
  }

  const end = safeInteger(endText);
  if (end < start) throw new ByteRangeError();
  return Object.freeze({ kind: 'closed', start, end, header: `bytes=${start}-${end}` });
}

function parseSatisfiedContentRange(value: string | null): ParsedSatisfiedContentRange {
  if (value === null || value.length > 128) throw new ByteRangeResponseError();
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/u.exec(value);
  if (!match) throw new ByteRangeResponseError();
  const start = safeResponseInteger(match[1] ?? '');
  const end = safeResponseInteger(match[2] ?? '');
  if (end < start) throw new ByteRangeResponseError();
  const totalText = match[3] ?? '';
  const total = totalText === '*' ? null : safeResponseInteger(totalText);
  if (total !== null && (total === 0 || end >= total)) throw new ByteRangeResponseError();
  return Object.freeze({ start, end, total, length: end - start + 1 });
}

function parseUnsatisfiedContentRange(value: string | null): ParsedUnsatisfiedContentRange {
  if (value === null || value.length > 128) throw new ByteRangeResponseError();
  const match = /^bytes \*\/(\d+)$/u.exec(value);
  if (!match) throw new ByteRangeResponseError();
  return Object.freeze({ total: safeResponseInteger(match[1] ?? '') });
}

function matchesSatisfiedRequest(
  request: ParsedByteRange,
  response: ParsedSatisfiedContentRange,
): boolean {
  if (request.kind === 'closed') {
    if (response.start !== request.start) return false;
    if (response.total === null) return response.end === request.end;
    if (request.start >= response.total) return false;
    return response.end === Math.min(request.end, response.total - 1);
  }

  if (request.kind === 'open') {
    if (response.start !== request.start) return false;
    if (response.total === null) return true;
    if (request.start >= response.total) return false;
    return response.end === response.total - 1;
  }

  if (response.total === null || response.total === 0) return false;
  const expectedStart = Math.max(0, response.total - request.length);
  return response.start === expectedStart && response.end === response.total - 1;
}

export function validateSatisfiedRangeResponse(
  request: ParsedByteRange | null,
  contentRange: string | null,
  contentLength: string | null,
): ParsedSatisfiedContentRange {
  if (!request) throw new ByteRangeResponseError();
  const parsed = parseSatisfiedContentRange(contentRange);
  if (!matchesSatisfiedRequest(request, parsed)) throw new ByteRangeResponseError();
  if (contentLength !== null) {
    const length = safeResponseInteger(contentLength);
    if (length !== parsed.length) throw new ByteRangeResponseError();
  }
  return parsed;
}

export function validateUnsatisfiedRangeResponse(
  request: ParsedByteRange | null,
  contentRange: string | null,
): ParsedUnsatisfiedContentRange {
  if (!request) throw new ByteRangeResponseError();
  const parsed = parseUnsatisfiedContentRange(contentRange);
  const consistent = request.kind === 'suffix'
    ? parsed.total === 0
    : request.start >= parsed.total;
  if (!consistent) throw new ByteRangeResponseError();
  return parsed;
}

export function validContentRange(value: string | null, unsatisfied = false): boolean {
  try {
    if (unsatisfied) parseUnsatisfiedContentRange(value);
    else parseSatisfiedContentRange(value);
    return true;
  } catch {
    return false;
  }
}
