export const providerNetworkPolicy = Object.freeze({
  allowedSchemes: ['http:', 'https:'] as const,
  rejectUrlUserInfo: true,
  rejectLocalhost: true,
  rejectLoopback: true,
  rejectPrivateAddressSpace: true,
  rejectLinkLocal: true,
  rejectMulticastAndReserved: true,
  rejectCloudMetadataDestinations: true,
  validateIpv4AndIpv6: true,
  defendAgainstDnsRebinding: true,
  bindConnectionToValidatedDestination: true,
  redirectPolicy: 'disabled' as const,
  boundedConnectTimeout: true,
  boundedReadTimeout: true,
  boundedTotalRequestTime: true,
  boundedResponseSize: true,
  restrictedMethods: ['GET'] as const,
  infrastructureEgressControlWhereAvailable: true,
  redactSensitiveUrlsAndLogs: true,
});

export const providerAuthenticationLimits = Object.freeze({
  connectTimeoutMs: 5_000,
  readTimeoutMs: 10_000,
  totalTimeoutMs: 15_000,
  maximumResponseBytes: 512 * 1024,
});

export type ProviderNetworkPolicy = typeof providerNetworkPolicy;
