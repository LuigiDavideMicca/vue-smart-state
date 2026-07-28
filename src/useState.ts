import {
  ref,
  shallowRef,
  watch,
  toRaw,
  getCurrentScope,
  onScopeDispose,
  type Ref,
  type UnwrapRef
} from 'vue'

type StorageType = 'local' | 'session'

export interface Serializer<T> {
  read: (raw: string) => T
  write: (value: T) => string
}

export interface UseStateOptions<T> {
  /** Use a shallowRef instead of a deep ref. */
  shallow?: boolean
  /** Persist the value to web storage (requires `storageKey`). */
  persist?: boolean
  storageKey?: string
  /** `local` (default) or `session`. Cross-tab sync only works with `local`. */
  storageType?: StorageType
  /** Watch nested mutations and persist them too. */
  deepWatch?: boolean
  /** Keep the value in sync across browser tabs via the `storage` event. */
  syncTabs?: boolean
  /** Milliseconds a persisted value stays fresh; expired values fall back to the initial value. */
  ttl?: number
  /** Debounce persisted writes by this many ms (great for text inputs). Sync stays instant. */
  writeDebounce?: number
  /** Custom (de)serialization; defaults to JSON. */
  serializer?: Serializer<T>
  /** Validate untrusted data from storage or other tabs: return the value or throw. */
  parse?: (value: unknown) => T
  /** Schema version of the persisted value. Bump it when the shape changes. */
  version?: number
  /** Upgrade values persisted with an older version; return undefined to discard them. */
  migrate?: (value: unknown, fromVersion: number) => T | undefined
  /** Called instead of `console.warn` when reading, writing or syncing fails. */
  onError?: (error: unknown, context: 'read' | 'write' | 'sync') => void
}

export type SetState<T> = (next: T | ((current: T) => T)) => void

export interface UseStateControls {
  /** Back to the initial value (persisted too, when persistence is on). */
  reset: () => void
  /** Remove the persisted entry and go back to the initial value. */
  clear: () => void
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

const defaultSerializer = <T>(): Serializer<T> => ({
  read: (raw) => JSON.parse(raw) as T,
  write: (value) => JSON.stringify(value)
})

export function useState<T>(initialValue: T, options: UseStateOptions<T> = {}): UseStateReturn<T> {
  const {
    shallow = false,
    persist = false,
    storageKey = '',
    storageType = 'local',
    deepWatch = false,
    syncTabs = false,
    ttl,
    writeDebounce,
    serializer = defaultSerializer<T>(),
    parse,
    version,
    migrate,
    onError = (error, context) =>
      console.warn(`[vue-smart-state] ${context} failed for key "${storageKey}"`, error)
  } = options

  const persisting = persist && storageKey !== '' && isClient
  if (persist && storageKey === '' && isClient) {
    console.warn(
      '[vue-smart-state] `persist` is on but `storageKey` is empty — nothing will be stored'
    )
  }

  const storage = persisting
    ? storageType === 'local'
      ? window.localStorage
      : window.sessionStorage
    : undefined

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
    return parse ? parse(value) : (value as T)
  }

  const encode = (value: T): string => {
    const written = serializer.write(value)
    if (ttl === undefined && version === undefined) return written
    const envelope: Envelope = { __vss: 1, value: written }
    if (ttl !== undefined) envelope.expires = Date.now() + ttl
    if (version !== undefined) envelope.v = version
    return JSON.stringify(envelope)
  }

  let value = initialValue
  if (storage) {
    try {
      const stored = storage.getItem(storageKey)
      if (stored !== null) {
        const decoded = decode(stored)
        if (decoded !== undefined) value = decoded
      }
    } catch (error) {
      onError(error, 'read')
    }
  }

  const state = (shallow ? shallowRef(value) : ref(value)) as Ref<UnwrapRef<T>>

  let lastWritten: string | undefined

  const write = (val: unknown) => {
    if (!storage) return
    try {
      const raw = encode(toRaw(val) as T)
      if (raw === lastWritten) return
      lastWritten = raw
      storage.setItem(storageKey, raw)
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

  if (storage) {
    watch(
      state,
      (val) => {
        if (writeDebounce === undefined) {
          write(val)
          return
        }
        cancelPendingWrite()
        writeTimer = setTimeout(() => {
          writeTimer = undefined
          write(state.value)
        }, writeDebounce)
      },
      { deep: deepWatch }
    )
    if (writeDebounce !== undefined && getCurrentScope()) {
      // flush a pending debounced write instead of losing it with the component
      onScopeDispose(() => {
        if (writeTimer !== undefined) {
          cancelPendingWrite()
          write(state.value)
        }
      })
    }
  }

  if (storage && syncTabs) {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || event.storageArea !== storage) return
      if (event.newValue === null) {
        state.value = initialValue as UnwrapRef<T>
        return
      }
      if (event.newValue === lastWritten) return
      try {
        const decoded = decode(event.newValue)
        lastWritten = event.newValue
        state.value = (decoded === undefined ? initialValue : decoded) as UnwrapRef<T>
      } catch (error) {
        onError(error, 'sync')
      }
    }
    window.addEventListener('storage', onStorage)
    // Inside a component/effect scope the listener dies with it; at module
    // level (global stores) it intentionally lives for the session.
    if (getCurrentScope()) {
      onScopeDispose(() => window.removeEventListener('storage', onStorage))
    }
  }

  const setState: SetState<T> = (next) => {
    const current = toRaw(state.value) as T
    const resolved = typeof next === 'function' ? (next as (current: T) => T)(current) : next
    state.value = resolved as UnwrapRef<T>
  }

  const controls: UseStateControls = {
    reset: () => {
      cancelPendingWrite()
      state.value = initialValue as UnwrapRef<T>
      write(initialValue)
    },
    clear: () => {
      cancelPendingWrite()
      try {
        storage?.removeItem(storageKey)
      } catch (error) {
        onError(error, 'write')
      }
      lastWritten = undefined
      state.value = initialValue as UnwrapRef<T>
    }
  }

  return [state, setState, controls]
}
