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
  redirectPolicy: 'disabled-by-default-revalidate-every-hop' as const,
  boundedConnectTimeout: true,
  boundedReadTimeout: true,
  boundedTotalRequestTime: true,
  boundedResponseSize: true,
  restrictedMethods: true,
  infrastructureEgressControlWhereAvailable: true,
  redactSensitiveUrlsAndLogs: true,
});

export type ProviderNetworkPolicy = typeof providerNetworkPolicy;
