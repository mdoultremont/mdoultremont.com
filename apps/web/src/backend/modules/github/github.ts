import { Config, Context, Data, Effect, Layer, Redacted, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http"

export interface GitHubIdentity {
  readonly id: string
  readonly login: string
  readonly name: string | null
  readonly avatarUrl: string | null
}

export class GitHubError extends Data.TaggedError("GitHubError")<{
  readonly reason: "CodeRejected" | "Unavailable" | "InvalidResponse"
  readonly cause?: unknown
}> {
  override get message() {
    switch (this.reason) {
      case "CodeRejected":
        return "GitHub rejected the authorization code"
      case "Unavailable":
        return "GitHub is temporarily unavailable"
      case "InvalidResponse":
        return "GitHub returned a response that could not be read"
    }
  }
}

const TokenResponse = Schema.Struct({ access_token: Schema.NonEmptyString })

const Profile = Schema.Struct({
  id: Schema.Union([Schema.Finite, Schema.NonEmptyString]),
  login: Schema.NonEmptyString,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
})

/** GitHub OAuth for signing in to the app. */
export class GitHub extends Context.Service<
  GitHub,
  {
    readonly authorizationUrl: (state: string) => string
    /** Exchanges an OAuth code for the signed-in account. */
    readonly identify: (
      code: string
    ) => Effect.Effect<GitHubIdentity, GitHubError>
  }
>()("backend/modules/GitHub") {
  static readonly layer = Layer.effect(
    GitHub,
    Effect.gen(function* () {
      const clientId = yield* Config.NonEmptyString("GITHUB_CLIENT_ID")
      const clientSecret = yield* Config.schema(
        Schema.Redacted(Schema.NonEmptyString),
        "GITHUB_CLIENT_SECRET"
      )
      const redirectUri = yield* Config.NonEmptyString("GITHUB_REDIRECT_URI")
      const http = yield* HttpClient.HttpClient

      const decode =
        <S extends Schema.Top>(schema: S) =>
        (response: HttpClientResponse.HttpClientResponse) =>
          response.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema)),
            Effect.mapError(
              (cause) => new GitHubError({ reason: "InvalidResponse", cause })
            )
          ) as Effect.Effect<S["Type"], GitHubError>

      const send = (
        request: HttpClientRequest.HttpClientRequest,
        rejected: GitHubError["reason"]
      ) =>
        http.execute(request).pipe(
          Effect.mapError(
            (cause) => new GitHubError({ reason: "Unavailable", cause })
          ),
          Effect.flatMap((response) =>
            response.status >= 200 && response.status < 300
              ? Effect.succeed(response)
              : Effect.fail(
                  new GitHubError({
                    reason: response.status >= 500 ? "Unavailable" : rejected,
                    cause: `GitHub returned ${response.status}`,
                  })
                )
          )
        )

      const authorizationUrl = (state: string) => {
        const url = new URL("https://github.com/login/oauth/authorize")
        url.searchParams.set("client_id", clientId)
        url.searchParams.set("redirect_uri", redirectUri)
        url.searchParams.set("scope", "read:user")
        url.searchParams.set("state", state)
        return url.toString()
      }

      const identify = Effect.fn("GitHub.identify")(function* (code: string) {
        const token = yield* send(
          HttpClientRequest.post(
            "https://github.com/login/oauth/access_token"
          ).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bodyJsonUnsafe({
              client_id: clientId,
              client_secret: Redacted.value(clientSecret),
              code,
              redirect_uri: redirectUri,
            })
          ),
          "CodeRejected"
        ).pipe(
          Effect.flatMap(decode(TokenResponse)),
          // GitHub reports a bad code as 200 without an access token.
          Effect.catchIf(
            (error) => error.reason === "InvalidResponse",
            (error) =>
              Effect.fail(
                new GitHubError({ reason: "CodeRejected", cause: error })
              )
          )
        )
        const profile = yield* send(
          HttpClientRequest.get("https://api.github.com/user").pipe(
            HttpClientRequest.setHeaders({
              Accept: "application/vnd.github+json",
              "User-Agent": "mdoultremont.com",
            }),
            HttpClientRequest.bearerToken(token.access_token)
          ),
          "InvalidResponse"
        ).pipe(Effect.flatMap(decode(Profile)))
        return {
          id: String(profile.id),
          login: profile.login,
          name: profile.name ?? null,
          avatarUrl: profile.avatar_url ?? null,
        } satisfies GitHubIdentity
      })

      return GitHub.of({ authorizationUrl, identify })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
