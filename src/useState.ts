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
  /** Custom (de)serialization; defaults to JSON. */
  serializer?: Serializer<T>
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

/** Persisted envelope used when a TTL is set. Plain legacy values keep working. */
interface Envelope {
  __vss: 1
  value: string
  expires?: number
}

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
    serializer = defaultSerializer<T>(),
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
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object' && (parsed as Envelope).__vss === 1) {
        const envelope = parsed as Envelope
        if (envelope.expires !== undefined && Date.now() > envelope.expires) return undefined
        return serializer.read(envelope.value)
      }
    } catch {
      // not an envelope (or not JSON at all): fall through to the raw value
    }
    return serializer.read(raw)
  }

  const encode = (value: T): string => {
    const written = serializer.write(value)
    if (ttl === undefined) return written
    const envelope: Envelope = { __vss: 1, value: written, expires: Date.now() + ttl }
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

  if (storage) {
    watch(state, write, { deep: deepWatch })
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
      state.value = initialValue as UnwrapRef<T>
      write(initialValue)
    },
    clear: () => {
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
