import type { App } from "@/shared/apps"
import { backOfficeActions } from "@/shared/back-office/actions"
import { flightsActions } from "@/shared/flights/actions"
import { musicActions } from "@/shared/music/actions"
import { type ActionTree, type AnyActionSpec, isActionSpec } from "./define"

/** Every app's actions, each app under its own key. */
export type Catalog = { readonly [A in App]: ActionTree<A> }

/**
 * Every business operation of tools. The path to an action is its name
 * (`flights.equipment.create`); oRPC routes, the public HTTP API, the
 * manifest, MCP tools and CLI commands are all derived from this tree.
 */
export const catalog = {
  flights: flightsActions,
  music: musicActions,
  backOffice: backOfficeActions,
} satisfies Catalog

export interface CatalogEntry<
  N extends string = string,
  S extends AnyActionSpec = AnyActionSpec,
> {
  readonly name: N
  /** The tree path, also the oRPC route under /api/rpc. */
  readonly path: readonly string[]
  readonly spec: S
}

type EntriesOf<T, Prefix extends string> = {
  [K in keyof T & string]: T[K] extends AnyActionSpec
    ? CatalogEntry<`${Prefix}${K}`, T[K]>
    : EntriesOf<T[K], `${Prefix}${K}.`>
}[keyof T & string]

export type ActionName = EntriesOf<typeof catalog, "">["name"]

/** Every action of a tree, depth first in declaration order. */
export const flatten = (
  tree: ActionTree,
  path: readonly string[] = []
): ReadonlyArray<CatalogEntry> =>
  Object.entries(tree).flatMap(([key, node]) =>
    isActionSpec(node)
      ? [{ name: [...path, key].join("."), path: [...path, key], spec: node }]
      : flatten(node, [...path, key])
  )

/** The action at a tree path, if there is one. */
export const actionAt = (
  tree: ActionTree,
  path: readonly string[]
): AnyActionSpec | undefined => {
  const [key, ...rest] = path
  const node = key === undefined ? undefined : tree[key]
  if (node === undefined) return undefined
  if (isActionSpec(node)) return rest.length === 0 ? node : undefined
  return actionAt(node, rest)
}
