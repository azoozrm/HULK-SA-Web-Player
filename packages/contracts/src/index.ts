export type ProviderLoginRequest = Readonly<{
  host: string;
  username: string;
  password: string;
}>;

export type OpaqueSessionDescriptor = Readonly<{
  authenticated: true;
  expiresAt: string;
}>;

export type UnauthenticatedSessionDescriptor = Readonly<{
  authenticated: false;
}>;

export type BrowserSessionState = OpaqueSessionDescriptor | UnauthenticatedSessionDescriptor;

export type EpgCapability = 'supported' | 'unsupported' | 'unknown';

export type ProviderCapabilities = Readonly<{
  epg: EpgCapability;
  live: boolean;
  movies: boolean;
  series: boolean;
}>;

export type CatalogCategory = Readonly<{
  id: string;
  name: string;
}>;

export type LiveChannel = Readonly<{
  id: string;
  name: string;
  categoryId: string | null;
  imageUrl: string | null;
  epgChannelId: string | null;
}>;

export type MovieSummary = Readonly<{
  id: string;
  name: string;
  categoryId: string | null;
  posterUrl: string | null;
  year: number | null;
  rating: number | null;
  containerExtension: string | null;
}>;

export type MovieDetails = Readonly<{
  id: string;
  name: string | null;
  categoryId: string | null;
  posterUrl: string | null;
  year: number | null;
  rating: number | null;
  containerExtension: string | null;
  plot: string | null;
  durationSeconds: number | null;
  cast: string | null;
  director: string | null;
  genre: string | null;
  releasedAt: string | null;
}>;

export type SeriesSummary = Readonly<{
  id: string;
  name: string;
  categoryId: string | null;
  posterUrl: string | null;
  year: number | null;
  rating: number | null;
  plot: string | null;
}>;

export type SeriesEpisode = Readonly<{
  id: string;
  seriesId: string;
  seasonKey: string;
  episodeNumber: number | null;
  name: string | null;
  durationSeconds: number | null;
  containerExtension: string | null;
  imageUrl: string | null;
}>;

export type SeriesSeason = Readonly<{
  seasonKey: string;
  seasonNumber: number | null;
  name: string | null;
  episodes: readonly SeriesEpisode[];
}>;

export type SeriesDetails = Readonly<{
  id: string;
  name: string | null;
  categoryId: string | null;
  posterUrl: string | null;
  year: number | null;
  rating: number | null;
  plot: string | null;
  cast: string | null;
  director: string | null;
  genre: string | null;
  releasedAt: string | null;
  seasons: readonly SeriesSeason[];
}>;

export type CatalogCollection<T> = Readonly<{
  items: readonly T[];
}>;

export type MediaDeliveryMode =
  | 'gateway-hls-pass-through'
  | 'gateway-mp4-range-pass-through'
  | 'gateway-remux'
  | 'gateway-selective-transcode';

export type MediaLocatorRequest =
  | Readonly<{ kind: 'live'; id: string }>
  | Readonly<{ kind: 'movie'; id: string }>
  | Readonly<{ kind: 'episode'; id: string; seriesId: string }>;

export type MediaLocatorDescriptor = Readonly<{
  url: string;
  expiresAt: string;
}>;

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
