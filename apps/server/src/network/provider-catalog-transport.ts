import { isIP } from 'node:net';
import type {
  ProviderCatalogOperation,
  ProviderCatalogTransport,
  ProviderTransportResponse,
  ServerHeldProviderCredentials,
} from '../control-plane.js';
import {
  type BoundProviderRequest,
  type BoundProviderRequestExecutor,
  type ProviderTransportLimits,
  executeBoundProviderRequest,
} from './provider-authentication-transport.js';
import {
  approveProviderDestination,
  type ApprovedProviderDestination,
  type ProviderDnsResolver,
} from '../security/provider-url.js';
import { providerCatalogLimits } from '../security/provider-network-policy.js';

const SAFE_PROVIDER_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/u;

export class ProviderCatalogOperationError extends Error {
  constructor() {
    super('Provider catalog operation is invalid.');
    this.name = 'ProviderCatalogOperationError';
  }
}

function requireIdentifier(value: string): string {
  if (!SAFE_PROVIDER_IDENTIFIER.test(value)) throw new ProviderCatalogOperationError();
  return value;
}

function configureOperation(
  endpoint: URL,
  operation: ProviderCatalogOperation,
): ProviderTransportLimits {
  switch (operation.kind) {
    case 'live-categories':
      endpoint.searchParams.set('action', 'get_live_categories');
      return providerCatalogLimits.categories;
    case 'live-streams':
      endpoint.searchParams.set('action', 'get_live_streams');
      if (operation.categoryId !== null) {
        endpoint.searchParams.set('category_id', requireIdentifier(operation.categoryId));
      }
      return providerCatalogLimits.listings;
    case 'movie-categories':
      endpoint.searchParams.set('action', 'get_vod_categories');
      return providerCatalogLimits.categories;
    case 'movie-streams':
      endpoint.searchParams.set('action', 'get_vod_streams');
      if (operation.categoryId !== null) {
        endpoint.searchParams.set('category_id', requireIdentifier(operation.categoryId));
      }
      return providerCatalogLimits.listings;
    case 'movie-info':
      endpoint.searchParams.set('action', 'get_vod_info');
      endpoint.searchParams.set('vod_id', requireIdentifier(operation.id));
      return providerCatalogLimits.details;
    case 'series-categories':
      endpoint.searchParams.set('action', 'get_series_categories');
      return providerCatalogLimits.categories;
    case 'series':
      endpoint.searchParams.set('action', 'get_series');
      if (operation.categoryId !== null) {
        endpoint.searchParams.set('category_id', requireIdentifier(operation.categoryId));
      }
      return providerCatalogLimits.listings;
    case 'series-info':
      endpoint.searchParams.set('action', 'get_series_info');
      endpoint.searchParams.set('series_id', requireIdentifier(operation.id));
      return providerCatalogLimits.details;
    default:
      throw new ProviderCatalogOperationError();
  }
}

export class NodeProviderCatalogTransport implements ProviderCatalogTransport {
  constructor(
    private readonly resolver: ProviderDnsResolver,
    private readonly executor: BoundProviderRequestExecutor = executeBoundProviderRequest,
  ) {}

  async request(
    credentials: ServerHeldProviderCredentials,
    operation: ProviderCatalogOperation,
  ): Promise<ProviderTransportResponse> {
    const approved = await approveProviderDestination(credentials.host, this.resolver);
    const endpoint = new URL('player_api.php', approved.baseUrl);
    endpoint.searchParams.set('username', credentials.username);
    endpoint.searchParams.set('password', credentials.password);
    const limits = configureOperation(endpoint, operation);
    return await this.executor(this.createBoundRequest(approved, endpoint), limits);
  }

  private createBoundRequest(
    approved: ApprovedProviderDestination,
    endpoint: URL,
  ): BoundProviderRequest {
    return Object.freeze({
      protocol: approved.baseUrl.protocol as 'http:' | 'https:',
      hostname: approved.hostname,
      port: approved.port,
      connectAddress: approved.connectAddress,
      family: approved.family,
      tlsServername:
        approved.baseUrl.protocol === 'https:' && isIP(approved.hostname) === 0
          ? approved.hostname
          : null,
      hostHeader: approved.baseUrl.host,
      pathWithQuery: `${endpoint.pathname}${endpoint.search}`,
    });
  }
}
