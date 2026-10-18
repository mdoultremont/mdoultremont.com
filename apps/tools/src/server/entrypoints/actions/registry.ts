import {
  type ActionDescriptor,
  type ActionTree,
  type AnyActionSpec,
  type CatalogEntry,
  catalog,
  describeAction,
  flatten,
} from "@/shared/actions"
import type { App } from "@/shared/apps"
import { backOfficeHandlers } from "./back-office"
import { type BoundAction, invokeAction, type PlatformLayer } from "./bind"
import type { Caller } from "./caller"
import { ActionError } from "./errors"
import { flightsHandlers } from "./flights"
import { musicHandlers } from "./music"

/** One handler per action of `T`, at the same path. Missing or extra ones do not compile. */
export type HandlersFor<T> = {
  readonly [K in keyof T]: T[K] extends AnyActionSpec
    ? BoundAction<T[K]>
    : HandlersFor<T[K]>
}

export interface RegisteredAction extends CatalogEntry {
  readonly action: BoundAction
}

/** Every action with its handler: what the transports serve. */
export interface ActionRegistry {
  readonly actions: ReadonlyArray<RegisteredAction>
  readonly get: (name: string) => RegisteredAction | undefined
  /** The manifest entries of the actions of `apps`. */
  readonly describe: (
    apps: ReadonlyArray<App>
  ) => ReadonlyArray<ActionDescriptor>
}

const isBound = (value: unknown): value is BoundAction =>
  typeof value === "object" &&
  value !== null &&
  "spec" in value &&
  "execute" in value &&
  typeof value.execute === "function"

const handlerAt = (handlers: unknown, path: readonly string[]) =>
  path.reduce<unknown>(
    (node, key) =>
      typeof node === "object" && node !== null
        ? Reflect.get(node, key)
        : undefined,
    handlers
  )

/**
 * Pairs every action of `tree` with its handler. Fails at once when a handler
 * is bound to another action, or two actions share an HTTP method and path.
 */
export const createRegistry = <T extends ActionTree>(
  tree: T,
  handlers: HandlersFor<T>
): ActionRegistry => {
  const routes = new Map<string, string>()
  const actions = flatten(tree).map((entry): RegisteredAction => {
    const action = handlerAt(handlers, entry.path)
    if (!isBound(action) || action.spec !== entry.spec)
      throw new Error(`Action ${entry.name} is not bound to its own handler`)
    const route = `${entry.spec.http.method} ${entry.spec.http.path.replaceAll(/:[^/]+/g, ":")}`
    const existing = routes.get(route)
    if (existing !== undefined)
      throw new Error(`Actions ${existing} and ${entry.name} share ${route}`)
    routes.set(route, entry.name)
    return { ...entry, action }
  })
  const byName = new Map(actions.map((entry) => [entry.name, entry]))
  let descriptors: ReadonlyArray<ActionDescriptor> | undefined
  return {
    actions,
    get: (name) => byName.get(name),
    describe: (apps) => {
      descriptors ??= actions.map(describeAction)
      return descriptors.filter((descriptor) => apps.includes(descriptor.app))
    },
  }
}

/** The handler of every action in the catalog. */
export const handlers = {
  flights: flightsHandlers,
  music: musicHandlers,
  backOffice: backOfficeHandlers,
} satisfies HandlersFor<typeof catalog>

/** The production actions of tools. */
export const actionRegistry = createRegistry(catalog, handlers)

/**
 * Calls an action by name, as MCP and other transports do: the same access
 * check, validation, error mapping and output encoding as every route.
 */
export const invoke = (
  name: string,
  input: unknown,
  caller: Caller,
  platform: PlatformLayer,
  registry: ActionRegistry = actionRegistry
) => {
  const entry = registry.get(name)
  return entry === undefined
    ? Promise.resolve({
        _tag: "Failure" as const,
        error: new ActionError({
          code: "NOT_FOUND",
          message: `Unknown action ${name}`,
        }),
      })
    : invokeAction(entry.action, input, caller, platform)
}
