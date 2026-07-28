import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, isRef, nextTick } from 'vue'
import { useState, type StandardSchemaV1 } from '../src/useState'

const KEY = 'test-key'

const fireStorage = (key: string, newValue: string | null) => {
  window.dispatchEvent(
    new StorageEvent('storage', { key, newValue, storageArea: window.localStorage })
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('basics', () => {
  it('returns a reactive ref with the initial value', () => {
    const [count, setCount] = useState(0)
    expect(isRef(count)).toBe(true)
    expect(count.value).toBe(0)
    setCount(5)
    expect(count.value).toBe(5)
  })

  it('supports a functional updater', () => {
    const [count, setCount] = useState(10)
    setCount((current) => current + 1)
    expect(count.value).toBe(11)
  })

  it('supports shallow refs', async () => {
    const [state] = useState({ nested: { n: 1 } }, { shallow: true })
    expect(state.value.nested.n).toBe(1)
  })
})

describe('persistence', () => {
  it('writes to localStorage on change', async () => {
    const [, setName] = useState('anna', { persist: true, storageKey: KEY })
    setName('luca')
    await nextTick()
    expect(localStorage.getItem(KEY)).toBe('"luca"')
  })

  it('restores a persisted value over the initial one', () => {
    localStorage.setItem(KEY, '"stored"')
    const [name] = useState('initial', { persist: true, storageKey: KEY })
    expect(name.value).toBe('stored')
  })

  it('keeps reading legacy plain values written by 0.0.x', () => {
    localStorage.setItem(KEY, JSON.stringify({ from: 'v0' }))
    const [state] = useState({ from: 'init' }, { persist: true, storageKey: KEY, ttl: 1000 })
    expect(state.value).toEqual({ from: 'v0' })
  })

  it('uses sessionStorage when asked', async () => {
    const [, set] = useState(1, { persist: true, storageKey: KEY, storageType: 'session' })
    set(2)
    await nextTick()
    expect(sessionStorage.getItem(KEY)).toBe('2')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('persists deep mutations with deepWatch', async () => {
    const [state] = useState({ n: 1 }, { persist: true, storageKey: KEY, deepWatch: true })
    state.value.n = 2
    await nextTick()
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ n: 2 })
  })

  it('warns when persist is on without a storageKey', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useState(0, { persist: true })
    expect(warn).toHaveBeenCalledOnce()
  })

  it('reports storage failures through onError', async () => {
    const onError = vi.fn()
    const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const [, set] = useState(0, { persist: true, storageKey: KEY, onError })
    set(1)
    await nextTick()
    spy.mockRestore()
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'write')
  })
})

describe('ttl', () => {
  it('stores an envelope and honours a fresh value', async () => {
    vi.useFakeTimers()
    const [, set] = useState('a', { persist: true, storageKey: KEY, ttl: 60_000 })
    set('b')
    await nextTick()

    const [restored] = useState('init', { persist: true, storageKey: KEY, ttl: 60_000 })
    expect(restored.value).toBe('b')
  })

  it('falls back to the initial value once expired', async () => {
    vi.useFakeTimers()
    const [, set] = useState('a', { persist: true, storageKey: KEY, ttl: 60_000 })
    set('b')
    await nextTick()

    vi.advanceTimersByTime(61_000)
    const [restored] = useState('init', { persist: true, storageKey: KEY, ttl: 60_000 })
    expect(restored.value).toBe('init')
  })
})

describe('versioned migrations', () => {
  it('writes an envelope carrying the version', async () => {
    const [, set] = useState('a', { persist: true, storageKey: KEY, version: 2 })
    set('b')
    await nextTick()
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ __vss: 1, value: '"b"', v: 2 })
  })

  it('migrates values persisted with an older version', () => {
    localStorage.setItem(KEY, JSON.stringify({ __vss: 1, value: '"old"', v: 1 }))
    const [state] = useState('init', {
      persist: true,
      storageKey: KEY,
      version: 2,
      migrate: (value, fromVersion) => `${value as string}@${fromVersion}`
    })
    expect(state.value).toBe('old@1')
  })

  it('treats plain legacy values as version 0', () => {
    localStorage.setItem(KEY, '"legacy"')
    const [state] = useState('init', {
      persist: true,
      storageKey: KEY,
      version: 1,
      migrate: (value, fromVersion) => (fromVersion === 0 ? `${value as string}!` : undefined)
    })
    expect(state.value).toBe('legacy!')
  })

  it('discards outdated values without a migrate function', () => {
    localStorage.setItem(KEY, JSON.stringify({ __vss: 1, value: '"old"', v: 1 }))
    const [state] = useState('init', { persist: true, storageKey: KEY, version: 2 })
    expect(state.value).toBe('init')
  })

  it('discards values the migration refuses', () => {
    localStorage.setItem(KEY, JSON.stringify({ __vss: 1, value: '"old"', v: 1 }))
    const [state] = useState('init', {
      persist: true,
      storageKey: KEY,
      version: 2,
      migrate: () => undefined
    })
    expect(state.value).toBe('init')
  })
})

describe('parse', () => {
  const asNumber = (value: unknown): number => {
    if (typeof value !== 'number') throw new Error('not a number')
    return value
  }

  it('accepts values the parser returns', () => {
    localStorage.setItem(KEY, '5')
    const [state] = useState(0, { persist: true, storageKey: KEY, parse: asNumber })
    expect(state.value).toBe(5)
  })

  it('falls back to the initial value when the parser throws', () => {
    const onError = vi.fn()
    localStorage.setItem(KEY, '"nope"')
    const [state] = useState(0, { persist: true, storageKey: KEY, parse: asNumber, onError })
    expect(state.value).toBe(0)
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'read')
  })
})

describe('schema', () => {
  const stringSchema: StandardSchemaV1<unknown, string> = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) =>
        typeof value === 'string' ? { value } : { issues: [{ message: 'expected a string' }] }
    }
  }

  it('restores values the schema accepts', () => {
    localStorage.setItem(KEY, '"stored"')
    const [state] = useState('init', { persist: true, storageKey: KEY, schema: stringSchema })
    expect(state.value).toBe('stored')
  })

  it('falls back to the initial value on schema issues', () => {
    localStorage.setItem(KEY, '42')
    const [state] = useState('init', { persist: true, storageKey: KEY, schema: stringSchema })
    expect(state.value).toBe('init')
  })

  it('uses the value the schema returns (transforms included)', () => {
    const trimming: StandardSchemaV1<unknown, string> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) =>
          typeof value === 'string'
            ? { value: value.trim() }
            : { issues: [{ message: 'expected a string' }] }
      }
    }
    localStorage.setItem(KEY, '"  padded  "')
    const [state] = useState('init', { persist: true, storageKey: KEY, schema: trimming })
    expect(state.value).toBe('padded')
  })

  it('rejects async validation with a console.error and keeps the initial value', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const asyncSchema: StandardSchemaV1<unknown, string> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => Promise.resolve({ value: value as string })
      }
    }
    localStorage.setItem(KEY, '"stored"')
    const [state] = useState('init', { persist: true, storageKey: KEY, schema: asyncSchema })
    expect(state.value).toBe('init')
    expect(error).toHaveBeenCalledOnce()
  })

  it('wins over parse when both are given', () => {
    const parse = vi.fn()
    localStorage.setItem(KEY, '"stored"')
    const [state] = useState('init', {
      persist: true,
      storageKey: KEY,
      schema: stringSchema,
      parse
    })
    expect(state.value).toBe('stored')
    expect(parse).not.toHaveBeenCalled()
  })

  it('validates values coming from other tabs', () => {
    const [state] = useState('init', {
      persist: true,
      storageKey: KEY,
      syncTabs: true,
      schema: stringSchema
    })
    fireStorage(KEY, '42')
    expect(state.value).toBe('init')
    fireStorage(KEY, '"ok"')
    expect(state.value).toBe('ok')
  })
})

describe('writeDebounce', () => {
  it('delays the write and coalesces rapid changes', async () => {
    vi.useFakeTimers()
    const [, set] = useState('a', { persist: true, storageKey: KEY, writeDebounce: 200 })
    set('b')
    await nextTick()
    set('c')
    await nextTick()
    expect(localStorage.getItem(KEY)).toBeNull()
    vi.advanceTimersByTime(200)
    expect(localStorage.getItem(KEY)).toBe('"c"')
  })

  it('flushes a pending write when the scope is disposed', async () => {
    vi.useFakeTimers()
    const scope = effectScope()
    await scope.run(async () => {
      const [, set] = useState('a', { persist: true, storageKey: KEY, writeDebounce: 200 })
      set('pending')
      await nextTick()
    })
    expect(localStorage.getItem(KEY)).toBeNull()
    scope.stop()
    expect(localStorage.getItem(KEY)).toBe('"pending"')
  })
})

describe('mergeDefaults', () => {
  it('shallow-merges stored objects over the defaults with `true`', () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: 'dark' }))
    const [state] = useState(
      { theme: 'light', fontSize: 14 },
      { persist: true, storageKey: KEY, mergeDefaults: true }
    )
    expect(state.value).toEqual({ theme: 'dark', fontSize: 14 })
  })

  it('accepts a custom merge function', () => {
    localStorage.setItem(KEY, JSON.stringify({ tags: ['b'] }))
    const [state] = useState(
      { tags: ['a'] },
      {
        persist: true,
        storageKey: KEY,
        mergeDefaults: (stored, defaults) => ({ tags: [...defaults.tags, ...stored.tags] })
      }
    )
    expect(state.value).toEqual({ tags: ['a', 'b'] })
  })

  it('skips merging when the stored value is not a plain object', () => {
    localStorage.setItem(KEY, JSON.stringify(['not', 'an', 'object']))
    const [state] = useState<unknown>(
      { theme: 'light' },
      { persist: true, storageKey: KEY, mergeDefaults: true }
    )
    expect(state.value).toEqual(['not', 'an', 'object'])
  })

  it('runs after migrate', () => {
    localStorage.setItem(KEY, JSON.stringify({ __vss: 1, value: '{"theme":"dark"}', v: 1 }))
    const [state] = useState(
      { theme: 'light', fontSize: 14 },
      {
        persist: true,
        storageKey: KEY,
        version: 2,
        migrate: (value) => value as { theme: string; fontSize: number },
        mergeDefaults: true
      }
    )
    expect(state.value).toEqual({ theme: 'dark', fontSize: 14 })
  })
})

describe('custom storage', () => {
  const memoryStorage = () => {
    const data = new Map<string, string>()
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      data
    }
  }

  it('reads and writes through the provided storage instead of web storage', async () => {
    const storage = memoryStorage()
    storage.setItem(KEY, '"stored"')
    const [state, set] = useState('init', { persist: true, storageKey: KEY, storage })
    expect(state.value).toBe('stored')
    set('next')
    await nextTick()
    expect(storage.getItem(KEY)).toBe('"next"')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('clear() removes the entry from the provided storage', async () => {
    const storage = memoryStorage()
    const [, set, { clear }] = useState('init', { persist: true, storageKey: KEY, storage })
    set('next')
    await nextTick()
    expect(storage.data.size).toBe(1)
    clear()
    expect(storage.data.size).toBe(0)
  })
})

describe('custom serializer', () => {
  it('round-trips through the provided serializer', async () => {
    const serializer = {
      read: (raw: string) => new Set(JSON.parse(raw) as number[]),
      write: (value: Set<number>) => JSON.stringify([...value])
    }
    const [, set] = useState(new Set<number>(), { persist: true, storageKey: KEY, serializer })
    set(new Set([1, 2]))
    await nextTick()

    const [restored] = useState(new Set<number>(), { persist: true, storageKey: KEY, serializer })
    expect([...restored.value]).toEqual([1, 2])
  })
})

describe('cross-tab sync', () => {
  it('applies values written by another tab', () => {
    const [name] = useState('a', { persist: true, storageKey: KEY, syncTabs: true })
    fireStorage(KEY, '"from-other-tab"')
    expect(name.value).toBe('from-other-tab')
  })

  it('resets to the initial value when another tab clears the key', () => {
    const [name] = useState('a', { persist: true, storageKey: KEY, syncTabs: true })
    fireStorage(KEY, '"other"')
    expect(name.value).toBe('other')
    fireStorage(KEY, null)
    expect(name.value).toBe('a')
  })

  it('ignores unrelated keys', () => {
    const [name] = useState('a', { persist: true, storageKey: KEY, syncTabs: true })
    fireStorage('another-key', '"x"')
    expect(name.value).toBe('a')
  })

  it('removes its listener when the effect scope is disposed', () => {
    const scope = effectScope()
    let update: (() => void) | undefined
    scope.run(() => {
      const [name] = useState('a', { persist: true, storageKey: KEY, syncTabs: true })
      update = () => {
        fireStorage(KEY, '"late"')
        expect(name.value).toBe('a')
      }
    })
    scope.stop()
    update!()
  })
})

describe('broadcast sync', () => {
  class FakeBroadcastChannel {
    static instances: FakeBroadcastChannel[] = []
    onmessage: ((event: { data: unknown }) => void) | null = null
    closed = false
    constructor(readonly name: string) {
      FakeBroadcastChannel.instances.push(this)
    }
    postMessage(data: unknown) {
      for (const other of FakeBroadcastChannel.instances) {
        if (other === this || other.closed || other.name !== this.name) continue
        other.onmessage?.({ data })
      }
    }
    close() {
      this.closed = true
    }
  }

  beforeEach(() => {
    FakeBroadcastChannel.instances = []
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  })

  it('opens a channel named after the storage key', () => {
    useState('a', { persist: true, storageKey: KEY, syncTabs: 'broadcast' })
    expect(FakeBroadcastChannel.instances.map((c) => c.name)).toEqual([`vss:${KEY}`])
  })

  it('propagates writes to other instances on the same channel', async () => {
    const [, set] = useState('a', { persist: true, storageKey: KEY, syncTabs: 'broadcast' })
    const [other] = useState('a', { persist: true, storageKey: `${KEY}-2`, syncTabs: 'broadcast' })
    const [peer] = useState('a', { persist: true, storageKey: KEY, syncTabs: 'broadcast' })
    set('b')
    await nextTick()
    expect(peer.value).toBe('b')
    expect(other.value).toBe('a')
  })

  it('resets peers to the initial value on clear()', async () => {
    const [, set, { clear }] = useState('a', {
      persist: true,
      storageKey: KEY,
      syncTabs: 'broadcast'
    })
    const [peer] = useState('a', { persist: true, storageKey: KEY, syncTabs: 'broadcast' })
    set('b')
    await nextTick()
    expect(peer.value).toBe('b')
    clear()
    expect(peer.value).toBe('a')
  })

  it('closes the channel when the effect scope is disposed', () => {
    const scope = effectScope()
    scope.run(() => {
      useState('a', { persist: true, storageKey: KEY, syncTabs: 'broadcast' })
    })
    expect(FakeBroadcastChannel.instances[0]!.closed).toBe(false)
    scope.stop()
    expect(FakeBroadcastChannel.instances[0]!.closed).toBe(true)
  })

  it('falls back to storage events when BroadcastChannel is unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const [name] = useState('a', { persist: true, storageKey: KEY, syncTabs: 'broadcast' })
    fireStorage(KEY, '"from-other-tab"')
    expect(name.value).toBe('from-other-tab')
  })

  it("treats syncTabs 'storage' like true and opens no channel", () => {
    const [name] = useState('a', { persist: true, storageKey: KEY, syncTabs: 'storage' })
    fireStorage(KEY, '"other"')
    expect(name.value).toBe('other')
    expect(FakeBroadcastChannel.instances).toHaveLength(0)
  })
})

describe('controls', () => {
  it('reset() restores and persists the initial value', async () => {
    const [name, setName, { reset }] = useState('init', { persist: true, storageKey: KEY })
    setName('changed')
    await nextTick()
    reset()
    expect(name.value).toBe('init')
    expect(localStorage.getItem(KEY)).toBe('"init"')
  })

  it('clear() removes the persisted entry and restores the initial value', async () => {
    const [name, setName, { clear }] = useState('init', { persist: true, storageKey: KEY })
    setName('changed')
    await nextTick()
    clear()
    expect(name.value).toBe('init')
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
