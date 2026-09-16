export type ParsedByteRange =
  | Readonly<{ kind: 'closed'; start: number; end: number; header: string }>
  | Readonly<{ kind: 'open'; start: number; header: string }>
  | Readonly<{ kind: 'suffix'; length: number; header: string }>;

export class ByteRangeError extends Error {
  constructor() {
    super('Byte range is invalid.');
    this.name = 'ByteRangeError';
  }
}

function safeInteger(value: string): number {
  if (!/^\d+$/u.test(value)) throw new ByteRangeError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ByteRangeError();
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

export function validContentRange(value: string | null, unsatisfied = false): boolean {
  if (value === null || value.length > 128) return false;
  if (unsatisfied) return /^bytes \*\/\d+$/u.test(value);
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/u.exec(value);
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    return false;
  }
  const totalText = match[3] ?? '';
  if (totalText === '*') return true;
  const total = Number(totalText);
  return Number.isSafeInteger(total) && total > end;
}
