export type ProviderLoginRequest = Readonly<{
  host: string;
  username: string;
  password: string;
}>;

export type OpaqueSessionDescriptor = Readonly<{
  authenticated: true;
  expiresAt: string;
}>;

export type EpgCapability = 'supported' | 'unsupported' | 'unknown';

export type ProviderCapabilities = Readonly<{
  epg: EpgCapability;
  live: boolean;
  movies: boolean;
  series: boolean;
}>;

export type MediaDeliveryMode =
  | 'gateway-hls-pass-through'
  | 'gateway-mp4-range-pass-through'
  | 'gateway-remux'
  | 'gateway-selective-transcode';

export type SeriesEpisodeRef = Readonly<{
  id: string;
  seasonKey: string;
  episodeNumber: number | null;
}>;

export type SeriesEpisodeGroups = Readonly<Record<string, readonly SeriesEpisodeRef[]>>;

export type SeriesProviderShape = Readonly<{
  seasons?: readonly unknown[];
  episodes: SeriesEpisodeGroups;
}>;
