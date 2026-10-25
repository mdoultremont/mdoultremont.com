import { Effect, Option, Schema } from "effect"
import { HttpClientRequest, type HttpClientResponse } from "effect/http"
import {
  DeviceIdSchema,
  type Playback,
  type PlayerDevice,
  type PlayerStatus,
} from "@mdoultremont/tools-contracts/music"
import type { SpotifyConnection } from "./connections"
import {
  DeviceUnavailable,
  InvalidResponse,
  PlaybackPermissionMissing,
  PlaybackRefused,
  PremiumRequired,
  type SpotifyError,
  spotifyError,
} from "./errors"
import * as Api from "./schemas"

const Device = Schema.Struct({
  id: Schema.NullOr(Schema.String),
  name: Schema.String,
  type: Schema.String,
  is_active: Schema.Boolean,
  is_restricted: Schema.Boolean,
})
const Restrictions = {
  pausing: Schema.optional(Schema.Boolean),
  resuming: Schema.optional(Schema.Boolean),
  skipping_next: Schema.optional(Schema.Boolean),
}
const CurrentPlayback = Schema.Struct({
  is_playing: Schema.Boolean,
  device: Device,
  currently_playing_type: Schema.String,
  item: Schema.NullOr(Schema.Unknown),
  actions: Schema.optional(
    Schema.Struct({
      ...Restrictions,
      disallows: Schema.optional(Schema.Struct(Restrictions)),
    })
  ),
})
const Track = Schema.Struct({
  id: Schema.NullOr(Schema.String),
  name: Schema.String,
  artists: Schema.Array(Schema.Struct({ name: Schema.String })),
  linked_from: Schema.optional(Schema.Unknown),
  album: Schema.optional(
    Schema.Struct({
      images: Schema.Array(Schema.Struct({ url: Schema.String })),
    })
  ),
})
const Refusal = Schema.Struct({
  error: Schema.Struct({ reason: Schema.optional(Schema.String) }),
})

type Response = HttpClientResponse.HttpClientResponse

type Dependencies<E> = {
  readonly authorized: <A>(
    ownerId: string,
    call: (
      token: string,
      connection: SpotifyConnection
    ) => Effect.Effect<A, SpotifyError | E>
  ) => Effect.Effect<A, SpotifyError>
  readonly execute: (
    request: HttpClientRequest.HttpClientRequest
  ) => Effect.Effect<Response, SpotifyError>
  readonly checkStatus: (
    response: Response
  ) => Effect.Effect<Response, SpotifyError | E>
  readonly requireId: (
    id: string,
    kind: string
  ) => Effect.Effect<void, SpotifyError>
  readonly originalTrackId: (
    track: typeof Api.Track.Type
  ) => Effect.Effect<string | null, SpotifyError>
}

const decode = <S extends Schema.Top>(schema: S, response: Response) =>
  response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError((cause) =>
      spotifyError(
        new InvalidResponse({
          message: "Spotify returned invalid playback data",
          cause,
        })
      )
    )
  ) as Effect.Effect<S["Type"], SpotifyError>

const deviceId = (id: string | null) =>
  Option.getOrNull(Schema.decodeUnknownOption(DeviceIdSchema)(id))

const permitted = (connection: SpotifyConnection) => {
  const granted = new Set(connection.scopes.split(/\s+/u))
  return Api.spotifyPlaybackScopes.every((scope) => granted.has(scope))
}

const endpoint = (path: "play" | "pause" | "next") =>
  `https://api.spotify.com/v1/me/player/${path}`

export function makePlayer<E>(dependencies: Dependencies<E>) {
  const { authorized, execute, checkStatus, requireId, originalTrackId } =
    dependencies
  const checkPlayerStatus = (response: Response) =>
    Effect.gen(function* () {
      if (response.status === 403) {
        const body = yield* response.json.pipe(Effect.orElseSucceed(() => null))
        const refusal = Schema.decodeUnknownOption(Refusal)(body)
        return yield* Effect.fail(
          spotifyError(
            Option.isSome(refusal) &&
              refusal.value.error.reason === "PREMIUM_REQUIRED"
              ? new PremiumRequired()
              : new PlaybackRefused()
          )
        )
      }
      if (response.status === 404)
        return yield* Effect.fail(spotifyError(new DeviceUnavailable()))
      return yield* checkStatus(response)
    })
  const send = (request: HttpClientRequest.HttpClientRequest) =>
    execute(request).pipe(Effect.flatMap(checkPlayerStatus))
  const get = (path: string, token: string) =>
    HttpClientRequest.get(`https://api.spotify.com/v1/me/player${path}`).pipe(
      HttpClientRequest.bearerToken(token),
      send
    )
  const readPlayback = (
    token: string
  ): Effect.Effect<Playback | null, SpotifyError | E> =>
    Effect.gen(function* () {
      const response = yield* get("", token)
      if (response.status === 204) return null
      const value = yield* decode(CurrentPlayback, response)
      let item: Playback["item"] = { kind: "other" }
      if (value.currently_playing_type === "track" && value.item !== null) {
        const track = yield* Schema.decodeUnknownEffect(Track)(value.item).pipe(
          Effect.mapError((cause) =>
            spotifyError(
              new InvalidResponse({
                message: "Spotify returned an invalid playing track",
                cause,
              })
            )
          )
        )
        const identity = Schema.decodeUnknownOption(Api.Track)(track)
        const id = Option.isSome(identity)
          ? yield* originalTrackId(identity.value).pipe(
              Effect.orElseSucceed(() => null)
            )
          : null
        item = {
          kind: "track",
          id,
          name: track.name,
          artistNames: track.artists.map((artist) => artist.name),
          imageUrl: track.album?.images[0]?.url ?? null,
        }
      }
      const actions = value.actions
      return {
        playing: value.is_playing,
        device: {
          id: deviceId(value.device.id),
          name: value.device.name,
          restricted: value.device.is_restricted,
        },
        item,
        allows: {
          pause:
            actions?.pausing !== true && actions?.disallows?.pausing !== true,
          resume:
            actions?.resuming !== true && actions?.disallows?.resuming !== true,
          next:
            actions?.skipping_next !== true &&
            actions?.disallows?.skipping_next !== true,
        },
      }
    })
  const readDevices = (token: string) =>
    Effect.gen(function* () {
      const response = yield* get("/devices", token)
      const value = yield* decode(
        Schema.Struct({ devices: Schema.Array(Device) }),
        response
      )
      return value.devices.map((device): PlayerDevice => {
        const common = {
          name: device.name,
          type: device.type,
          active: device.is_active,
        }
        const id = deviceId(device.id)
        if (device.is_restricted || id === null)
          return {
            ...common,
            controllable: false,
            why: device.is_restricted ? "restricted" : "unidentified",
          }
        return { ...common, controllable: true, id }
      })
    })
  const playerStatus = Effect.fn("Spotify.playerStatus")((ownerId: string) =>
    authorized(
      ownerId,
      (token, connection): Effect.Effect<PlayerStatus, SpotifyError | E> =>
        !permitted(connection)
          ? Effect.succeed({ status: "needs_permission" })
          : Effect.all(
              { playback: readPlayback(token), devices: readDevices(token) },
              { concurrency: "unbounded" }
            ).pipe(
              Effect.map((value): PlayerStatus => ({
                status: "ready",
                ...value,
              }))
            )
    )
  )
  const command = (
    ownerId: string,
    run: (token: string) => Effect.Effect<void, SpotifyError | E>
  ) =>
    authorized(ownerId, (token, connection) =>
      permitted(connection)
        ? run(token)
        : Effect.fail(spotifyError(new PlaybackPermissionMissing()))
    )
  const control = (
    token: string,
    device: string,
    request: HttpClientRequest.HttpClientRequest
  ) =>
    send(
      request.pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.setUrlParam("device_id", device)
      )
    ).pipe(Effect.asVoid)
  const play = Effect.fn("Spotify.play")(function* (
    ownerId: string,
    device: string,
    trackIds: readonly [string, ...string[]]
  ) {
    for (const trackId of trackIds) yield* requireId(trackId, "track")
    yield* command(ownerId, (token) =>
      control(
        token,
        device,
        HttpClientRequest.put(endpoint("play")).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            uris: trackIds.map((trackId) => `spotify:track:${trackId}`),
          })
        )
      )
    )
  })
  const onCurrentDevice = (
    ownerId: string,
    device: string,
    run: (
      token: string,
      current: Playback
    ) => Effect.Effect<void, SpotifyError | E>
  ) =>
    command(ownerId, (token) =>
      Effect.gen(function* () {
        const current = yield* readPlayback(token)
        if (!current || current.device.id !== device)
          return yield* Effect.fail(spotifyError(new DeviceUnavailable()))
        if (current.device.restricted)
          return yield* Effect.fail(spotifyError(new PlaybackRefused()))
        yield* run(token, current)
      })
    )
  const changePlayback = (ownerId: string, device: string, playing: boolean) =>
    onCurrentDevice(ownerId, device, (token, current) =>
      Effect.gen(function* () {
        if (current.playing === playing) return
        if (!(playing ? current.allows.resume : current.allows.pause))
          return yield* Effect.fail(spotifyError(new PlaybackRefused()))
        yield* control(
          token,
          device,
          HttpClientRequest.put(endpoint(playing ? "play" : "pause"))
        )
      })
    )
  const pause = Effect.fn("Spotify.pause")((ownerId: string, device: string) =>
    changePlayback(ownerId, device, false)
  )
  const resume = Effect.fn("Spotify.resume")(
    (ownerId: string, device: string) => changePlayback(ownerId, device, true)
  )
  const next = Effect.fn("Spotify.next")((ownerId: string, device: string) =>
    onCurrentDevice(ownerId, device, (token, current) =>
      current.allows.next
        ? control(token, device, HttpClientRequest.post(endpoint("next")))
        : Effect.fail(spotifyError(new PlaybackRefused()))
    )
  )
  const playbackToken = Effect.fn("Spotify.playbackToken")((ownerId: string) =>
    authorized(ownerId, (accessToken, connection) =>
      permitted(connection)
        ? Effect.succeed({ accessToken })
        : Effect.fail(spotifyError(new PlaybackPermissionMissing()))
    )
  )
  return { playerStatus, playbackToken, play, pause, resume, next }
}
