import type { OpaqueSessionDescriptor, ProviderLoginRequest } from '../../../packages/contracts/src/index.js';

export type ServerHeldProviderCredentials = Readonly<{
  host: string;
  username: string;
  password: string;
}>;

export interface ProviderCredentialLease {
  readonly credentials: ServerHeldProviderCredentials;
  readonly expiresAtEpochMs: number;
  revoke(): Promise<void>;
}

export interface ProviderSessionBoundary {
  establish(input: ProviderLoginRequest): Promise<OpaqueSessionDescriptor>;
  revoke(sessionId: string): Promise<void>;
}

export interface ProviderTransportRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
}

export interface ProviderTransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface ProviderTransport {
  request(request: ProviderTransportRequest): Promise<ProviderTransportResponse>;
}

// Phase 1 intentionally defines boundaries only. Authentication/session and Provider networking
// implementations belong to later authorized phases.
