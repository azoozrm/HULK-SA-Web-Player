import { isIP } from 'node:net';

export type IpFamily = 4 | 6;

export type NormalizedIpAddress = Readonly<{
  address: string;
  family: IpFamily;
}>;

const ipv4BlockedRanges: readonly Readonly<{ base: number; prefix: number }>[] = [
  { base: 0x00000000, prefix: 8 },
  { base: 0x0a000000, prefix: 8 },
  { base: 0x64400000, prefix: 10 },
  { base: 0x7f000000, prefix: 8 },
  { base: 0xa9fe0000, prefix: 16 },
  { base: 0xac100000, prefix: 12 },
  { base: 0xc0000000, prefix: 24 },
  { base: 0xc0000200, prefix: 24 },
  { base: 0xc01fc400, prefix: 24 },
  { base: 0xc034c100, prefix: 24 },
  { base: 0xc0586300, prefix: 24 },
  { base: 0xc0a80000, prefix: 16 },
  { base: 0xc0af3000, prefix: 24 },
  { base: 0xc6120000, prefix: 15 },
  { base: 0xc6336400, prefix: 24 },
  { base: 0xcb007100, prefix: 24 },
  { base: 0xe0000000, prefix: 4 },
  { base: 0xf0000000, prefix: 4 },
];

function parseIpv4(address: string): number | null {
  if (isIP(address) !== 4) return null;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (
    (((parts[0] ?? 0) << 24) >>> 0) |
    ((parts[1] ?? 0) << 16) |
    ((parts[2] ?? 0) << 8) |
    (parts[3] ?? 0)
  ) >>> 0;
}

function ipv4InRange(value: number, base: number, prefix: number): boolean {
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function ipv4IsPublic(address: string): boolean {
  const value = parseIpv4(address);
  if (value === null) return false;
  return !ipv4BlockedRanges.some((range) => ipv4InRange(value, range.base, range.prefix));
}

function expandIpv6(address: string): Uint8Array | null {
  if (isIP(address) !== 6 || address.includes('%')) return null;
  let source = address.toLowerCase();

  const dottedIndex = source.lastIndexOf(':');
  const dottedTail = dottedIndex >= 0 ? source.slice(dottedIndex + 1) : source;
  if (dottedTail.includes('.')) {
    const ipv4 = parseIpv4(dottedTail);
    if (ipv4 === null) return null;
    source = `${source.slice(0, dottedIndex + 1)}${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const halves = source.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index] ?? '';
    if (!/^[0-9a-f]{1,4}$/u.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >>> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function matchesPrefix(address: Uint8Array, prefix: readonly number[], bits: number): boolean {
  const wholeBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;
  for (let index = 0; index < wholeBytes; index += 1) {
    if (address[index] !== (prefix[index] ?? 0)) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return ((address[wholeBytes] ?? 0) & mask) === ((prefix[wholeBytes] ?? 0) & mask);
}

function ipv6IsPublic(address: string): boolean {
  const bytes = expandIpv6(address);
  if (!bytes) return false;

  const mappedV4Prefix = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff] as const;
  if (matchesPrefix(bytes, mappedV4Prefix, 96)) {
    const mapped = `${bytes[12] ?? 0}.${bytes[13] ?? 0}.${bytes[14] ?? 0}.${bytes[15] ?? 0}`;
    return ipv4IsPublic(mapped);
  }

  const blocked: readonly Readonly<{ prefix: readonly number[]; bits: number }>[] = [
    { prefix: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bits: 128 },
    { prefix: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], bits: 128 },
    { prefix: [0, 100, 0xff, 0x9b], bits: 96 },
    { prefix: [0, 100, 0xff, 0x9b, 0, 1], bits: 48 },
    { prefix: [1, 0], bits: 64 },
    { prefix: [1, 0, 0, 0, 0, 0, 0, 1], bits: 64 },
    { prefix: [0x20, 0x01, 0x00, 0x00], bits: 23 },
    { prefix: [0x20, 0x01, 0x0d, 0xb8], bits: 32 },
    { prefix: [0x20, 0x02], bits: 16 },
    { prefix: [0x3f, 0xff], bits: 20 },
    { prefix: [0x5f, 0x00], bits: 16 },
    { prefix: [0xfc], bits: 7 },
    { prefix: [0xfe, 0x80], bits: 10 },
    { prefix: [0xfe, 0xc0], bits: 10 },
    { prefix: [0xff], bits: 8 },
  ];

  return !blocked.some((range) => matchesPrefix(bytes, range.prefix, range.bits));
}

export function normalizeIpAddress(address: string): NormalizedIpAddress | null {
  const unwrapped = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  const family = isIP(unwrapped);
  if (family !== 4 && family !== 6) return null;
  return Object.freeze({ address: unwrapped.toLowerCase(), family });
}

export function isPublicProviderAddress(address: string): boolean {
  const normalized = normalizeIpAddress(address);
  if (!normalized) return false;
  return normalized.family === 4
    ? ipv4IsPublic(normalized.address)
    : ipv6IsPublic(normalized.address);
}
