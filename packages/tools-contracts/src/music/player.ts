import { Schema } from "effect"

export const DeviceIdSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(1024)
)

export const PlayerDeviceSchema = Schema.Union([
  Schema.Struct({
    controllable: Schema.Literal(true),
    id: DeviceIdSchema,
    name: Schema.String,
    type: Schema.String,
    active: Schema.Boolean,
  }),
  Schema.Struct({
    controllable: Schema.Literal(false),
    why: Schema.Literals(["restricted", "unidentified"]),
    name: Schema.String,
    type: Schema.String,
    active: Schema.Boolean,
  }),
])
export type PlayerDevice = typeof PlayerDeviceSchema.Type

export const NowPlayingSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("track"),
    id: Schema.NullOr(Schema.String),
    name: Schema.String,
    artistNames: Schema.Array(Schema.String),
    imageUrl: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("other") }),
])
export type NowPlaying = typeof NowPlayingSchema.Type

export const PlaybackSchema = Schema.Struct({
  playing: Schema.Boolean,
  device: Schema.Struct({
    id: Schema.NullOr(DeviceIdSchema),
    name: Schema.String,
    restricted: Schema.Boolean,
  }),
  item: Schema.NullOr(NowPlayingSchema),
  allows: Schema.Struct({ pause: Schema.Boolean, resume: Schema.Boolean }),
})
export type Playback = typeof PlaybackSchema.Type

export const PlayerStatusSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("needs_permission") }),
  Schema.Struct({
    status: Schema.Literal("ready"),
    devices: Schema.Array(PlayerDeviceSchema),
    playback: Schema.NullOr(PlaybackSchema),
  }),
])
export type PlayerStatus = typeof PlayerStatusSchema.Type

export const CommandAcceptedSchema = Schema.Struct({
  status: Schema.Literal("accepted"),
})
export type CommandAccepted = typeof CommandAcceptedSchema.Type
