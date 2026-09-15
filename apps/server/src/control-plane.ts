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

export type ProviderAuthenticationTransportResponse = Readonly<{
  status: number;
  body: Uint8Array;
}>;

export interface ProviderAuthenticationTransport {
  authenticate(
    credentials: ServerHeldProviderCredentials,
  ): Promise<ProviderAuthenticationTransportResponse>;
}
