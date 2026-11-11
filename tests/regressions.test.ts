import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, watch } from 'vue'
import { useState } from '../src/useState'
import { cookieStorage } from '../src/cookieStorage'

const KEY = 'hunt-key'
const flush = () => new Promise((r) => setTimeout(r, 0))

const fireStorage = (key: string | null, newValue: string | null) => {
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

describe('B1 clear() re-persists the initial value on the next tick', () => {
  it('entry stays removed after the watcher flushes', async () => {
    const [, set, { clear }] = useState('init', { persist: true, storageKey: KEY })
    set('changed')
    await nextTick()
    clear()
    expect(localStorage.getItem(KEY)).toBeNull() // passes (what the repo test checks)
    await nextTick()
    expect(localStorage.getItem(KEY)).toBeNull() 
  })
})

describe('B2 a peer tab re-creates the key removed by another tab', () => {
  it('storage event with newValue null must not write the initial value back', async () => {
    localStorage.setItem(KEY, '"other"')
    const [name] = useState('a', { persist: true, storageKey: KEY, syncTabs: true })
    expect(name.value).toBe('other')
    localStorage.removeItem(KEY) // the other tab removed it
    fireStorage(KEY, null)
    await nextTick()
    expect(name.value).toBe('a')
    expect(localStorage.getItem(KEY)).toBeNull() 
  })

  it('localStorage.clear() in another tab (key === null) is ignored', async () => {
    localStorage.setItem(KEY, '"other"')
    const [name] = useState('a', { persist: true, storageKey: KEY, syncTabs: true })
    localStorage.clear()
    fireStorage(null, null)
    expect(name.value).toBe('a') 
  })
})

describe('B3 initialValue object is mutated through the reactive proxy', () => {
  it('reset() restores the original defaults after deep mutation', () => {
    const defaults = { count: 0, items: [] as string[] }
    const [state, , { reset }] = useState(defaults)
    state.value.count = 5
    state.value.items.push('x')
    expect(defaults).toEqual({ count: 0, items: [] }) 
    reset()
    expect(state.value.count).toBe(0) 
  })

  it('two stores sharing one defaults constant leak into each other', () => {
    const DEFAULTS = { filter: '' }
    const [a] = useState(DEFAULTS)
    const [b] = useState(DEFAULTS)
    a.value.filter = 'leak'
    expect(b.value.filter).toBe('') 
  })
})

describe('B4 TTL + cross-tab sync ping-pongs forever', () => {
  it('two broadcast peers keep rewriting each other', async () => {
    let posts = 0
    const Native = globalThis.BroadcastChannel
    class Counting extends Native {
      postMessage(m: unknown) {
        posts++
        super.postMessage(m)
      }
    }
    vi.stubGlobal('BroadcastChannel', Counting)
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 3)) // cross-tab latency > 1ms
    const scope = effectScope()
    let set!: (v: { n: number }) => void
    scope.run(() => {
      ;[, set] = useState({ n: 0 }, { persist: true, storageKey: KEY, syncTabs: 'broadcast', ttl: 60_000 })
      useState({ n: 0 }, { persist: true, storageKey: KEY, syncTabs: 'broadcast', ttl: 60_000 })
    })
    set({ n: 1 })
    await new Promise((r) => setTimeout(r, 300))
    scope.stop()
    expect(posts).toBeLessThanOrEqual(2) 
  })
})

describe('B5 writeDebounce also delays cross-tab sync ("Sync stays instant")', () => {
  it('peer sees the change immediately', async () => {
    const scope = effectScope()
    let set!: (v: string) => void
    let peer!: { value: string }
    scope.run(() => {
      ;[, set] = useState('a', { persist: true, storageKey: KEY, syncTabs: 'broadcast', writeDebounce: 200 })
      ;[peer] = useState('a', { persist: true, storageKey: KEY, syncTabs: 'broadcast' })
    })
    set('b')
    await new Promise((r) => setTimeout(r, 50))
    const seen = peer.value
    scope.stop()
    expect(seen).toBe('b') 
  })
})

describe('B6 debounced write lost on tab close (no pagehide flush)', () => {
  it('flushes on pagehide for a module-level store', async () => {
    const [, set] = useState('', { persist: true, storageKey: KEY, writeDebounce: 300 })
    set('typed')
    await nextTick()
    window.dispatchEvent(new Event('pagehide'))
    expect(localStorage.getItem(KEY)).toBe('"typed"') 
  })
})

describe('B7 storage access that throws crashes useState', () => {
  it('window.localStorage getter throwing (Safari, cookies blocked) goes to onError', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    const onError = vi.fn()
    expect(() => useState(1, { persist: true, storageKey: KEY, onError })).not.toThrow() 
  })
})

describe('B8 setting undefined persists unreadable garbage', () => {
  it('round-trips undefined (or removes the entry)', async () => {
    const [, set] = useState<string | undefined>('x', { persist: true, storageKey: KEY })
    set('y')
    await nextTick()
    set(undefined)
    await nextTick()
    const onError = vi.fn()
    useState<string | undefined>('x', { persist: true, storageKey: KEY, onError })
    expect(localStorage.getItem(KEY)).not.toBe('undefined') 
    expect(onError).not.toHaveBeenCalled() 
  })

  it('first-ever set(undefined) is silently not persisted (lastWritten starts undefined)', async () => {
    localStorage.setItem(KEY, '"stale"')
    const [, set] = useState<string | undefined>('x', { persist: true, storageKey: KEY })
    set(undefined)
    await nextTick()
    expect(localStorage.getItem(KEY)).not.toBe('"stale"') 
  })
})

describe('B9 functional updater receives the raw object', () => {
  it('mutate-and-return updater neither triggers nor persists', async () => {
    const [state, set] = useState({ items: [] as number[] }, { persist: true, storageKey: KEY })
    const seen: number[] = []
    const scope = effectScope()
    scope.run(() => watch(() => state.value.items.length, (n) => seen.push(n)))
    set((cur) => {
      cur.items.push(1)
      return cur
    })
    await nextTick()
    scope.stop()
    expect(seen).toEqual([1]) 
    expect(localStorage.getItem(KEY)).toBe('{"items":[1]}') 
  })
})

describe('B10 same key in one tab: instances do not share state', () => {
  it('second component sees updates from the first', async () => {
    const [a, setA] = useState(0, { persist: true, storageKey: KEY, syncTabs: true })
    const [b] = useState(0, { persist: true, storageKey: KEY, syncTabs: true })
    setA(3)
    await nextTick()
    expect(localStorage.getItem(KEY)).toBe('3')
    expect(b.value).toBe(3) 
    expect(a.value).toBe(3)
  })
})

describe('B11 cookieStorage', () => {
  afterEach(() => {
    for (const part of document.cookie.split(';')) {
      const name = part.split('=')[0]?.trim()
      if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
    }
  })

  it('a malformed foreign cookie value does not break reads', () => {
    document.cookie = `${KEY}=%E0%A4%A; path=/`
    expect(() => cookieStorage().getItem(KEY)).not.toThrow() 
  })

})
