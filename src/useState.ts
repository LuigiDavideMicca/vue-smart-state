import {
  ref,
  shallowRef,
  watch,
  toRaw,
  getCurrentScope,
  getCurrentInstance,
  onScopeDispose,
  onMounted,
  type Ref,
  type UnwrapRef
} from 'vue'

type StorageType = 'local' | 'session'

/** Anything with the synchronous subset of the Web Storage API. */
export interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export interface Serializer<T> {
  read: (raw: string) => T
  write: (value: T) => string
}

/** Minimal vendored Standard Schema v1 interface (https://standardschema.dev) — no dependency. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>
  }
}

export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string }> }

export interface UseStateOptions<T> {
  /** Use a shallowRef instead of a deep ref. */
  shallow?: boolean
  /** Persist the value to web storage (requires `storageKey`). */
  persist?: boolean
  storageKey?: string
  /** `local` (default) or `session`. Cross-tab sync only works with `local`. */
  storageType?: StorageType
  /** Custom storage (cookies, memory, …); takes precedence over `storageType`. */
  storage?: StorageLike
  /** Watch nested mutations and persist them too. */
  deepWatch?: boolean
  /**
   * Keep the value in sync across browser tabs: `true` or `'storage'` via the
   * `storage` event, `'broadcast'` via a `BroadcastChannel` named
   * `vss:<storageKey>` (falls back to storage events where unavailable).
   * Instances sharing a key in the same tab always stay in sync.
   */
  syncTabs?: boolean | 'storage' | 'broadcast'
  /** Milliseconds a persisted value stays fresh; expired values fall back to the initial value. */
  ttl?: number
  /**
   * Debounce persisted writes by this many ms (great for text inputs). Same-tab
   * instances and `'broadcast'` sync stay instant; `storage`-event sync follows
   * the write. A pending write is flushed when the page is hidden or closed.
   */
  writeDebounce?: number
  /** Custom (de)serialization; defaults to JSON. */
  serializer?: Serializer<T>
  /** Validate untrusted data from storage or other tabs: return the value or throw. */
  parse?: (value: unknown) => T
  /** Standard Schema (Zod 4, Valibot, ArkType…) validating hydrated data. Wins over `parse`. */
  schema?: StandardSchemaV1<unknown, T>
  /** Schema version of the persisted value. Bump it when the shape changes. */
  version?: number
  /** Upgrade values persisted with an older version; return undefined to discard them. */
  migrate?: (value: unknown, fromVersion: number) => T | undefined
  /**
   * Merge stored plain objects over the initial one after parse/schema/migrate:
   * `true` for a shallow `{ ...defaults, ...stored }`, or a custom merge function.
   */
  mergeDefaults?: boolean | ((stored: T, defaults: T) => T)
  /**
   * When the stored value is read: `'immediate'` (default) during setup, or
   * `'mounted'` after the component mounts, so a server-rendered page hydrates
   * with the initial value and switches to the stored one without a mismatch.
   */
  hydrate?: 'immediate' | 'mounted'
  /** Called instead of `console.warn` when reading, writing or syncing fails. */
  onError?: (error: unknown, context: 'read' | 'write' | 'sync') => void
}

export type SetState<T> = (next: T | ((current: T) => T)) => void

export interface UseStateControls {
  /** Back to the initial value (persisted too, when persistence is on). */
  reset: () => void
  /** Remove the persisted entry and go back to the initial value. */
  clear: () => void
  /** Write a pending debounced value now. */
  flush: () => void
}

export type UseStateReturn<T> = [Ref<UnwrapRef<T>>, SetState<T>, UseStateControls]

/** Persisted envelope used when a TTL or version is set. Plain legacy values keep working. */
interface Envelope {
  __vss: 1
  value: string
  expires?: number
  v?: number
}

const isEnvelope = (parsed: unknown): parsed is Envelope =>
  typeof parsed === 'object' &&
  parsed !== null &&
  (parsed as { __vss?: unknown }).__vss === 1 &&
  typeof (parsed as { value?: unknown }).value === 'string'

const isClient = typeof window !== 'undefined'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]'

const defaultSerializer = <T>(): Serializer<T> => ({
  read: (raw) => JSON.parse(raw) as T,
  write: (value) => JSON.stringify(value)
})

/**
 * A fresh copy of the defaults, so state never aliases the caller's object:
 * deep edits used to write into the defaults themselves, breaking `reset()`
 * and leaking between stores built from one constant.
 */
const cloneDefaults = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value
  try {
    return structuredClone(toRaw(value))
  } catch {
    return value
  }
}

/**
 * Instances persisting under the same storage and key in this tab. A `storage`
 * event never fires in the tab that wrote, so without this two components
 * using one key drifted apart. Client only: on the server it would outlive the
 * request.
 */
type Peer = (raw: string | null) => void
const peers = new WeakMap<StorageLike, Map<string, Set<Peer>>>()

const peersOf = (storage: StorageLike, key: string): Set<Peer> => {
  let byKey = peers.get(storage)
  if (!byKey) peers.set(storage, (byKey = new Map()))
  let set = byKey.get(key)
  if (!set) byKey.set(key, (set = new Set()))
  return set
}

export function useState<T>(initialValue: T, options: UseStateOptions<T> = {}): UseStateReturn<T> {
  const {
    shallow = false,
    persist = false,
    storageKey = '',
    storageType = 'local',
    storage: customStorage,
    deepWatch = false,
    syncTabs = false,
    ttl,
    writeDebounce,
    serializer = defaultSerializer<T>(),
    parse,
    schema,
    version,
    migrate,
    mergeDefaults = false,
    hydrate = 'immediate',
    onError = (error, context) =>
      console.warn(`[vue-smart-state] ${context} failed for key "${storageKey}"`, error)
  } = options

  const defaults = cloneDefaults(initialValue)
  const freshDefaults = (): T => cloneDefaults(defaults)

  const persisting = persist && storageKey !== '' && (customStorage !== undefined || isClient)
  if (persist && storageKey === '' && isClient) {
    console.warn(
      '[vue-smart-state] `persist` is on but `storageKey` is empty — nothing will be stored'
    )
  }

  // reading window.localStorage throws where storage is blocked (Safari with
  // cookies off, sandboxed iframes): the state then lives in memory
  let storage: StorageLike | undefined
  if (persisting) {
    try {
      storage =
        customStorage ?? (storageType === 'local' ? window.localStorage : window.sessionStorage)
    } catch (error) {
      onError(error, 'read')
    }
  }

  const withDefaults = (stored: T): T => {
    if (!mergeDefaults || !isPlainObject(stored) || !isPlainObject(defaults)) return stored
    if (mergeDefaults === true) return { ...freshDefaults(), ...stored } as T
    return mergeDefaults(stored, freshDefaults())
  }

  const decode = (raw: string): T | undefined => {
    let payload = raw
    let fromVersion = 0
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isEnvelope(parsed)) {
        if (parsed.expires !== undefined && Date.now() > parsed.expires) return undefined
        payload = parsed.value
        fromVersion = parsed.v ?? 0
      }
    } catch {
      // not an envelope (or not JSON at all): fall through with version 0
    }
    let value: unknown = serializer.read(payload)
    if (version !== undefined && fromVersion !== version) {
      if (!migrate) return undefined
      value = migrate(value, fromVersion)
      if (value === undefined) return undefined
    }
    if (schema) {
      const result = schema['~standard'].validate(value)
      if (result instanceof Promise) {
        onError(
          new Error(
            `async schema validation is not supported for key "${storageKey}" — keeping the initial value`
          ),
          'read'
        )
        return undefined
      }
      if (result.issues) return undefined
      return withDefaults(result.value)
    }
    return withDefaults(parse ? parse(value) : (value as T))
  }

  const encode = (value: T): string => {
    const written = serializer.write(value)
    if (ttl === undefined && version === undefined) return written
    const envelope: Envelope = { __vss: 1, value: written }
    if (ttl !== undefined) envelope.expires = Date.now() + ttl
    if (version !== undefined) envelope.v = version
    return JSON.stringify(envelope)
  }

  const readStored = (): T | undefined => {
    if (!storage) return undefined
    try {
      const stored = storage.getItem(storageKey)
      return stored === null ? undefined : decode(stored)
    } catch (error) {
      onError(error, 'read')
      return undefined
    }
  }

  const deferRead = hydrate === 'mounted' && getCurrentInstance() !== null
  let value = freshDefaults()
  if (!deferRead) {
    const stored = readStored()
    if (stored !== undefined) value = stored
  }

  const state = (shallow ? shallowRef(value) : ref(value)) as Ref<UnwrapRef<T>>

  // what storage holds as far as this instance knows: a string written or
  // read, null once removed, undefined before anything happened
  let lastWritten: string | null | undefined
  let channel: BroadcastChannel | undefined
  const samePeers = isClient && storage ? peersOf(storage, storageKey) : undefined

  // A value that came from outside - another tab, a same-tab peer, clear(),
  // a removal - is already what storage holds. The watcher must not write it
  // back: that re-created removed keys, undid clear(), and with a TTL (whose
  // envelope differs on every encode) bounced between tabs forever.
  let applied: { value: unknown } | undefined
  const applyQuietly = (next: unknown) => {
    applied = { value: next }
    state.value = next as UnwrapRef<T>
  }

  const notify = (raw: string | null) => {
    channel?.postMessage(raw)
    samePeers?.forEach((peer) => peer !== onPeer && peer(raw))
  }

  const write = (val: unknown) => {
    if (!storage) return
    try {
      if (val === undefined) {
        // JSON has no undefined: storing it wrote the string "undefined",
        // which failed to parse on the next load
        if (lastWritten === null) return
        lastWritten = null
        storage.removeItem(storageKey)
        notify(null)
        return
      }
      const raw = encode(toRaw(val) as T)
      if (raw === lastWritten) return
      lastWritten = raw
      storage.setItem(storageKey, raw)
      notify(raw)
    } catch (error) {
      onError(error, 'write')
    }
  }

  let writeTimer: ReturnType<typeof setTimeout> | undefined
  const cancelPendingWrite = () => {
    if (writeTimer !== undefined) {
      clearTimeout(writeTimer)
      writeTimer = undefined
    }
  }
  const flush = () => {
    if (writeTimer === undefined) return
    cancelPendingWrite()
    write(state.value)
  }

  const applyExternal = (raw: string | null) => {
    if (raw === null) {
      lastWritten = null
      applyQuietly(freshDefaults())
      return
    }
    if (raw === lastWritten) return
    try {
      const decoded = decode(raw)
      lastWritten = raw
      applyQuietly(decoded === undefined ? freshDefaults() : decoded)
    } catch (error) {
      onError(error, 'sync')
    }
  }

  function onPeer(raw: string | null) {
    cancelPendingWrite()
    applyExternal(raw)
  }

  if (storage) {
    watch(
      state,
      (val) => {
        if (applied && Object.is(toRaw(val), toRaw(applied.value))) {
          applied = undefined
          return
        }
        applied = undefined
        if (writeDebounce === undefined) {
          write(val)
          return
        }
        cancelPendingWrite()
        writeTimer = setTimeout(() => {
          writeTimer = undefined
          write(state.value)
        }, writeDebounce)
        // broadcast and same-tab peers do not wait for the debounced write
        if (val !== undefined) {
          try {
            const raw = encode(toRaw(val) as T)
            channel?.postMessage(raw)
            samePeers?.forEach((peer) => peer !== onPeer && peer(raw))
          } catch (error) {
            onError(error, 'sync')
          }
        }
      },
      { deep: deepWatch }
    )

    samePeers?.add(onPeer)

    if (writeDebounce !== undefined && isClient) {
      // a pending write died with the tab: only scope disposal flushed it
      const onHide = () => {
        if (document.visibilityState === 'hidden') flush()
      }
      window.addEventListener('pagehide', flush)
      document.addEventListener('visibilitychange', onHide)
      if (getCurrentScope()) {
        onScopeDispose(() => {
          window.removeEventListener('pagehide', flush)
          document.removeEventListener('visibilitychange', onHide)
        })
      }
    }

    if (getCurrentScope()) {
      onScopeDispose(() => {
        flush()
        samePeers?.delete(onPeer)
      })
    }

    if (deferRead) {
      onMounted(() => {
        const stored = readStored()
        if (stored !== undefined) applyQuietly(stored)
      })
    }
  }

  // Cross-tab sync is a browser feature: on the server a BroadcastChannel
  // opened per request was never closed, leaking and keeping Node alive
  if (isClient && storage && syncTabs !== false && syncTabs !== undefined) {
    // Inside a component/effect scope the listener/channel dies with it; at
    // module level (global stores) it intentionally lives for the session.
    if (syncTabs === 'broadcast' && typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(`vss:${storageKey}`)
      channel = bc
      bc.onmessage = (event: MessageEvent<string | null>) => applyExternal(event.data)
      if (getCurrentScope()) {
        onScopeDispose(() => bc.close())
      }
    } else {
      const onStorage = (event: StorageEvent) => {
        if (event.storageArea !== storage) return
        // key null: the other tab called storage.clear()
        if (event.key === null) applyExternal(null)
        else if (event.key === storageKey) applyExternal(event.newValue)
      }
      window.addEventListener('storage', onStorage)
      if (getCurrentScope()) {
        onScopeDispose(() => window.removeEventListener('storage', onStorage))
      }
    }
  }

  const setState: SetState<T> = (next) => {
    const current = toRaw(state.value) as T
    let resolved = typeof next === 'function' ? (next as (current: T) => T)(current) : next
    // an updater that mutated and returned the raw object changed it behind
    // the proxy: same identity, so nothing re-rendered and nothing persisted
    if (typeof next === 'function' && resolved === current) {
      if (Array.isArray(resolved)) resolved = [...resolved] as T
      else if (isPlainObject(resolved)) resolved = { ...resolved } as T
    }
    state.value = resolved as UnwrapRef<T>
  }

  const controls: UseStateControls = {
    reset: () => {
      cancelPendingWrite()
      const fresh = freshDefaults()
      state.value = fresh as UnwrapRef<T>
      write(fresh)
    },
    clear: () => {
      cancelPendingWrite()
      try {
        storage?.removeItem(storageKey)
        if (storage) {
          lastWritten = null
          notify(null)
        }
      } catch (error) {
        onError(error, 'write')
      }
      applyQuietly(freshDefaults())
    },
    flush
  }

  return [state, setState, controls]
}
