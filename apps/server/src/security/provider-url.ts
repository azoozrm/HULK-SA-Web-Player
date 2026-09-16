import { isIP } from 'node:net';
import { isPublicProviderAddress, normalizeIpAddress, type IpFamily } from './ip-address.js';

export type ResolvedProviderAddress = Readonly<{
  address: string;
  family: IpFamily;
}>;

export type ApprovedProviderDestination = Readonly<{
  baseUrl: URL;
  hostname: string;
  connectAddress: string;
  family: IpFamily;
  port: number;
}>;

export type ApprovedProviderRequestDestination = Readonly<{
  requestUrl: URL;
  hostname: string;
  connectAddress: string;
  family: IpFamily;
  port: number;
}>;

export interface ProviderDnsResolver {
  resolve(hostname: string): Promise<readonly ResolvedProviderAddress[]>;
}

export class ProviderNetworkPolicyError extends Error {
  readonly code:
    | 'invalid_provider_url'
    | 'prohibited_provider_destination'
    | 'provider_dns_failed';

  constructor(code: ProviderNetworkPolicyError['code']) {
    super('Provider destination is not permitted.');
    this.name = 'ProviderNetworkPolicyError';
    this.code = code;
  }
}

function normalizedHostname(url: URL): string {
  const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname;
  return hostname.replace(/\.$/u, '').toLowerCase();
}

function isLocalhostName(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost');
}

function normalizeHttpUrl(input: string | URL, allowQuery: boolean, maximumLength: number): URL {
  const candidate = typeof input === 'string' ? input.trim() : input.toString();
  if (!candidate || candidate.length > maximumLength) {
    throw new ProviderNetworkPolicyError('invalid_provider_url');
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ProviderNetworkPolicyError('invalid_provider_url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderNetworkPolicyError('invalid_provider_url');
  }
  if (url.username || url.password || url.hash || (!allowQuery && url.search)) {
    throw new ProviderNetworkPolicyError('invalid_provider_url');
  }

  const hostname = normalizedHostname(url);
  if (!hostname || isLocalhostName(hostname)) {
    throw new ProviderNetworkPolicyError('prohibited_provider_destination');
  }

  const normalized = new URL(url.toString());
  normalized.hostname = hostname.includes(':') ? `[${hostname}]` : hostname;
  return normalized;
}

async function approveNormalizedUrl(
  url: URL,
  resolver: ProviderDnsResolver,
): Promise<Readonly<{ hostname: string; connectAddress: string; family: IpFamily; port: number }>> {
  const hostname = normalizedHostname(url);
  let candidates: readonly ResolvedProviderAddress[];

  const literal = normalizeIpAddress(hostname);
  if (literal) {
    candidates = [literal];
  } else {
    try {
      candidates = await resolver.resolve(hostname);
    } catch {
      throw new ProviderNetworkPolicyError('provider_dns_failed');
    }
  }

  if (candidates.length === 0) {
    throw new ProviderNetworkPolicyError('provider_dns_failed');
  }

  const normalizedCandidates = candidates.map((candidate) => {
    const normalized = normalizeIpAddress(candidate.address);
    if (!normalized || normalized.family !== candidate.family) {
      throw new ProviderNetworkPolicyError('provider_dns_failed');
    }
    return normalized;
  });

  if (normalizedCandidates.some((candidate) => !isPublicProviderAddress(candidate.address))) {
    throw new ProviderNetworkPolicyError('prohibited_provider_destination');
  }

  const selected = normalizedCandidates[0];
  if (!selected) throw new ProviderNetworkPolicyError('provider_dns_failed');
  const explicitPort = url.port ? Number(url.port) : null;
  const port = explicitPort ?? (url.protocol === 'https:' ? 443 : 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ProviderNetworkPolicyError('invalid_provider_url');
  }

  return Object.freeze({
    hostname,
    connectAddress: selected.address,
    family: selected.family,
    port,
  });
}

export function normalizeProviderUrl(input: string): URL {
  const normalized = normalizeHttpUrl(input, false, 2048);
  const pathname = /\/player_api\.php$/iu.test(normalized.pathname)
    ? normalized.pathname.slice(0, -'player_api.php'.length)
    : normalized.pathname;
  normalized.pathname = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return normalized;
}

export function normalizeProviderRequestUrl(input: string | URL): URL {
  return normalizeHttpUrl(input, true, 8192);
}

export async function approveProviderDestination(
  input: string,
  resolver: ProviderDnsResolver,
): Promise<ApprovedProviderDestination> {
  const baseUrl = normalizeProviderUrl(input);
  const approved = await approveNormalizedUrl(baseUrl, resolver);
  return Object.freeze({ baseUrl, ...approved });
}

export async function approveProviderRequestUrl(
  input: string | URL,
  resolver: ProviderDnsResolver,
): Promise<ApprovedProviderRequestDestination> {
  const requestUrl = normalizeProviderRequestUrl(input);
  const approved = await approveNormalizedUrl(requestUrl, resolver);
  return Object.freeze({ requestUrl, ...approved });
}

export function isIpLiteralHostname(hostname: string): boolean {
  return isIP(hostname) !== 0;
}
