import type { OpaqueSessionDescriptor, ProviderLoginRequest } from '../../../packages/contracts/src/index.js';

export type ServerHeldProviderCredentials = Readonly<{
  host: string;
  username: string;
  password: string;
}>;

export type AuthenticatedProviderAccount = Readonly<{
  providerExpiresAtEpochMs: number | null;
}>;

export interface ProviderAuthenticator {
  authenticate(input: ProviderLoginRequest): Promise<AuthenticatedProviderAccount>;
}

export interface ProviderCredentialLease {
  readonly credentials: ServerHeldProviderCredentials;
  readonly expiresAtEpochMs: number;
}

export interface ProviderSessionBoundary {
  establish(
    input: ProviderLoginRequest,
    providerExpiresAtEpochMs: number | null,
  ): Promise<Readonly<{ descriptor: OpaqueSessionDescriptor; bearerToken: string }>>;
  resolve(sessionToken: string): Promise<OpaqueSessionDescriptor | null>;
  acquireProviderCredentials(sessionToken: string): Promise<ProviderCredentialLease | null>;
  revoke(sessionToken: string): Promise<void>;
}

export type ProviderTransportResponse = Readonly<{
  status: number;
  body: Uint8Array;
}>;

export type ProviderAuthenticationTransportResponse = ProviderTransportResponse;

export interface ProviderAuthenticationTransport {
  authenticate(credentials: ServerHeldProviderCredentials): Promise<ProviderTransportResponse>;
}

export type ProviderCatalogOperation =
  | Readonly<{ kind: 'live-categories' }>
  | Readonly<{ kind: 'live-streams'; categoryId: string | null }>
  | Readonly<{ kind: 'movie-categories' }>
  | Readonly<{ kind: 'movie-streams'; categoryId: string | null }>
  | Readonly<{ kind: 'movie-info'; id: string }>
  | Readonly<{ kind: 'series-categories' }>
  | Readonly<{ kind: 'series'; categoryId: string | null }>
  | Readonly<{ kind: 'series-info'; id: string }>;

export interface ProviderCatalogTransport {
  request(
    credentials: ServerHeldProviderCredentials,
    operation: ProviderCatalogOperation,
  ): Promise<ProviderTransportResponse>;
}
