export { Spotify } from "./spotify"
export { SpotifyConnections, type SpotifyConnection } from "./connections"
export {
  AccessDenied,
  CoverPermissionMissing,
  PlaybackPermissionMissing,
  PremiumRequired,
  PlaybackRefused,
  DeviceUnavailable,
  InvalidInput,
  InvalidResponse,
  NotConnected,
  RateLimited,
  ReconnectNeeded,
  Rejected,
  SpotifyError,
  spotifyError,
  type SpotifyErrorReason,
  Unavailable,
} from "./errors"
export { createSpotifyOAuthState, verifySpotifyOAuthState } from "./oauth-state"
export {
  spotifyScopes,
  type SpotifyConnectionStatus,
  type SpotifyPage,
  type SpotifyPlaylist,
  type SpotifySavedTrack,
} from "./schemas"

export type {
  PlayerStatus,
  PlayerDevice,
  Playback,
  NowPlaying,
} from "@mdoultremont/tools-contracts/music"
