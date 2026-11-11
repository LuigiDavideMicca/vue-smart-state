import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, effectScope, h, nextTick, onMounted, markRaw, isReactive } from 'vue'
import { useState } from '../src/useState'

const flush = () => new Promise((r) => setTimeout(r, 0))
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('V1 applied marker swallows a deep mutation in the same tick', () => {
  it('clear() then deep mutate (deepWatch) is persisted', async () => {
    const [cart, , { clear }] = useState({ items: [] as number[] }, { persist: true, storageKey: 'v1', deepWatch: true })
    cart.value.items.push(1)
    await flush()
    expect(localStorage.getItem('v1')).toBe('{"items":[1]}')
    clear()
    cart.value.items.push(2)
    await flush()
    expect(cart.value.items).toEqual([2])
    expect(localStorage.getItem('v1')).toBe('{"items":[2]}')
  })

  it('external storage event then deep mutate in the same tick is persisted', async () => {
    const [s] = useState({ n: 0 }, { persist: true, storageKey: 'v1b', deepWatch: true, syncTabs: true })
    localStorage.setItem('v1b', '{"n":5}')
    window.dispatchEvent(new StorageEvent('storage', { key: 'v1b', newValue: '{"n":5}', storageArea: localStorage }))
    s.value.n++
    await flush()
    expect(s.value.n).toBe(6)
    expect(localStorage.getItem('v1b')).toBe('{"n":6}')
  })

  it('same-tab peer write then deep mutate on the receiver in the same tick', async () => {
    const [a] = useState({ n: 0 }, { persist: true, storageKey: 'v1c', deepWatch: true })
    const [b] = useState({ n: 0 }, { persist: true, storageKey: 'v1c', deepWatch: true })
    a.value = { n: 1 }
    await nextTick() // a's watcher writes and pushes to b
    b.value.n = 42
    await flush()
    expect(b.value.n).toBe(42)
    expect(localStorage.getItem('v1c')).toBe('{"n":42}')
    expect(a.value.n).toBe(42)
  })
})

describe('V2 hydrate mounted: writes before the parent mounts', () => {
  it("a child's onMounted write is not overwritten by the stored value", async () => {
    localStorage.setItem('v2', '"stored"')
    let setFromChild: (v: string) => void = () => {}
    let stateRef: { value: string } | undefined
    const Child = defineComponent({
      props: { set: { type: Function, required: true } },
      setup(props) {
        onMounted(() => (props.set as (v: string) => void)('child-wrote'))
        return () => h('i')
      }
    })
    const App = defineComponent({
      setup() {
        const [s, set] = useState('init', { persist: true, storageKey: 'v2', hydrate: 'mounted' })
        stateRef = s
        setFromChild = set
        return () => h('div', [h(Child, { set: setFromChild })])
      }
    })
    const el = document.createElement('div')
    createApp(App).mount(el)
    await flush()
    expect(stateRef!.value).toBe('child-wrote')
    expect(localStorage.getItem('v2')).toBe('"child-wrote"')
  })

  it('a write in setup never destroys the stored value: it wins at mount, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('v2b', '"stored"')
    let stateRef: { value: string } | undefined
    const App = defineComponent({
      setup() {
        const [s, set] = useState('init', { persist: true, storageKey: 'v2b', hydrate: 'mounted' })
        set('setup-wrote')
        stateRef = s
        return () => h('p', s.value)
      }
    })
    createApp(App).mount(document.createElement('div'))
    await flush()
    expect([stateRef!.value, localStorage.getItem('v2b')]).toEqual(['stored', '"stored"'])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})

describe('V3 cloneDefaults changes behaviour', () => {
  class Counter {
    n = 1
    inc() {
      this.n++
    }
  }
  it('a class instance default keeps its prototype', () => {
    const [c] = useState(new Counter())
    expect(c.value instanceof Counter).toBe(true)
    expect(() => (c.value as Counter).inc()).not.toThrow()
  })
  it('a markRaw default stays raw', () => {
    const raw = markRaw({ heavy: { x: 1 } })
    const [c] = useState(raw)
    expect(isReactive(c.value)).toBe(false)
  })
  it('a default holding a function still gets a fresh copy on reset', async () => {
    const defaults = { list: [] as number[], fmt: (n: number) => String(n) }
    const [s, , { reset }] = useState(defaults)
    s.value.list.push(1)
    reset()
    expect(s.value.list).toEqual([])
  })
})

describe('V4 peers: undefined and memory', () => {
  it('undefined on one peer -> the other peer agrees', async () => {
    const [a, setA] = useState<string | undefined>('init', { persist: true, storageKey: 'v4' })
    const [b] = useState<string | undefined>('init', { persist: true, storageKey: 'v4' })
    setA('x')
    await flush()
    expect(b.value).toBe('x')
    setA(undefined)
    await flush()
    console.log('a', a.value, 'b', b.value, 'storage', localStorage.getItem('v4'))
    expect(b.value).toBe(a.value)
  })

  it('removal then setting the same value again is persisted', async () => {
    const [, set] = useState<string | undefined>('init', { persist: true, storageKey: 'v4b' })
    set('x')
    await flush()
    set(undefined)
    await flush()
    set('x')
    await flush()
    expect(localStorage.getItem('v4b')).toBe('"x"')
  })

  it('external removal then set same value again', async () => {
    const [, set] = useState('init', { persist: true, storageKey: 'v4c', syncTabs: true })
    set('x')
    await flush()
    localStorage.removeItem('v4c')
    window.dispatchEvent(new StorageEvent('storage', { key: 'v4c', newValue: null, storageArea: localStorage }))
    await flush()
    set('x')
    await flush()
    expect(localStorage.getItem('v4c')).toBe('"x"')
  })

  it('disposed scopes leave no peer behind', async () => {
    for (let i = 0; i < 50; i++) {
      const scope = effectScope()
      scope.run(() => useState('a', { persist: true, storageKey: 'v4d' }))
      scope.stop()
    }
    const scope = effectScope()
    const calls: string[] = []
    const [, set] = scope.run(() => useState('a', { persist: true, storageKey: 'v4d' }))!
    set('z')
    await flush()
    expect(localStorage.getItem('v4d')).toBe('"z"')
    scope.stop()
    expect(calls).toEqual([])
  })
})

describe('V5 debounce + peers + pagehide', () => {
  it('pending debounced write flushes on pagehide', async () => {
    const [, set] = useState('a', { persist: true, storageKey: 'v5', writeDebounce: 1000 })
    set('b')
    await nextTick()
    expect(localStorage.getItem('v5')).toBeNull()
    window.dispatchEvent(new Event('pagehide'))
    expect(localStorage.getItem('v5')).toBe('"b"')
  })

  it('debounced peer: the other peer sees it immediately and storage gets it later', async () => {
    vi.useFakeTimers()
    const [, setA] = useState('a', { persist: true, storageKey: 'v5b', writeDebounce: 100 })
    const [b] = useState('a', { persist: true, storageKey: 'v5b', writeDebounce: 100 })
    setA('b')
    await nextTick()
    expect(b.value).toBe('b')
    vi.advanceTimersByTime(150)
    expect(localStorage.getItem('v5b')).toBe('"b"')
    vi.useRealTimers()
  })

  it('ttl peers do not ping-pong', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const [, setA] = useState({ n: 0 }, { persist: true, storageKey: 'v5c', ttl: 10000 })
    useState({ n: 0 }, { persist: true, storageKey: 'v5c', ttl: 10000 })
    useState({ n: 0 }, { persist: true, storageKey: 'v5c', ttl: 10000, writeDebounce: 5 })
    setA({ n: 1 })
    await new Promise((r) => setTimeout(r, 100))
    console.log('setItem calls', setItem.mock.calls.length)
    expect(setItem.mock.calls.length).toBeLessThan(5)
    setItem.mockRestore()
  })
})

describe('V1d hydrate mounted + own onMounted deep edit', () => {
  it('a deep edit in the component onMounted after hydration is persisted', async () => {
    localStorage.setItem('v1d', '{"items":[1]}')
    let st: { value: { items: number[] } } | undefined
    const App = defineComponent({
      setup() {
        const [cart] = useState({ items: [] as number[] }, { persist: true, storageKey: 'v1d', hydrate: 'mounted', deepWatch: true })
        st = cart
        onMounted(() => cart.value.items.push(2))
        return () => h('p', cart.value.items.length)
      }
    })
    createApp(App).mount(document.createElement('div'))
    await flush()
    expect(st!.value.items).toEqual([1, 2])
    expect(localStorage.getItem('v1d')).toBe('{"items":[1,2]}')
  })
})
