import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { useState } from '../src/useState'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
beforeEach(() => {
  localStorage.clear()
})

// found by the second verifier of the payload-based write guard
describe('second verification round', () => {
  it('an edit reverted before its debounced write reaches the peers too', async () => {
    localStorage.setItem('a1', '1')
    const [c] = useState(1, { persist: true, storageKey: 'a1', writeDebounce: 30 })
    const [d] = useState(1, { persist: true, storageKey: 'a1', writeDebounce: 30 })
    c.value = 2
    await nextTick()
    expect(d.value).toBe(2)
    c.value = 1
    await nextTick()
    await tick(60)
    expect([localStorage.getItem('a1'), c.value, d.value]).toEqual(['1', 1, 1])
  })

  it('with a ttl, setting an equal value again renews the expiry', async () => {
    const [, set] = useState({ n: 0 }, { persist: true, storageKey: 'c1', ttl: 1000 })
    set({ n: 1 })
    await tick()
    const first = JSON.parse(localStorage.getItem('c1')!).expires
    await tick(20)
    set({ n: 1 })
    await tick()
    expect(JSON.parse(localStorage.getItem('c1')!).expires).toBeGreaterThan(first)
  })

  it('a serializer whose write throws is reported, not thrown, at setup', () => {
    localStorage.setItem('d3', '{"n":1}')
    const onError = vi.fn()
    const serializer = {
      read: (raw: string) => JSON.parse(raw),
      write: (): string => {
        throw new Error('nowrite')
      }
    }
    expect(() =>
      useState({ n: 0 }, { persist: true, storageKey: 'd3', serializer, onError })
    ).not.toThrow()
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'write')
  })

  it('a serializer whose write throws is reported on a removal from another tab', () => {
    const onError = vi.fn()
    const serializer = {
      read: (raw: string) => JSON.parse(raw),
      write: (): string => {
        throw new Error('nowrite')
      }
    }
    useState({ n: 0 }, { persist: true, storageKey: 'd4', serializer, onError, syncTabs: true })
    expect(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'd4', newValue: null, storageArea: localStorage })
      )
    ).not.toThrow()
    expect(onError).toHaveBeenCalled()
  })

  it('hydrate: mounted with deepWatch stays fast after mount', async () => {
    const big = { a: Array.from({ length: 20000 }, (_, i) => ({ i })) }
    let s: { value: typeof big } | undefined
    const app = createApp(
      defineComponent({
        setup() {
          s = useState(big, { persist: true, storageKey: 'i1', hydrate: 'mounted', deepWatch: true })[0]
          return () => h('div')
        }
      })
    )
    app.mount(document.createElement('div'))
    await tick()
    const start = performance.now()
    for (let k = 0; k < 50; k++) s!.value.a[k]!.i = -k
    // the sync tracking watcher used to walk the whole state per mutation: ~5.5 s
    expect(performance.now() - start).toBeLessThan(500)
    app.unmount()
  })
})
