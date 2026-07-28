import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useState } from '../src/useState'

const KEY = 'interop-key'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

// Hard-coded strings matching what smart-state (React) writes: the envelope
// `{__vss:1,value,expires,v}` is a cross-framework invariant.
describe('envelope interop with smart-state (react)', () => {
  it('hydrates a ttl+version envelope written by the react package', () => {
    localStorage.setItem(
      KEY,
      '{"__vss":1,"value":"{\\"theme\\":\\"dark\\"}","expires":4102444800000,"v":2}'
    )
    const [state] = useState(
      { theme: 'light' },
      { persist: true, storageKey: KEY, ttl: 60_000, version: 2 }
    )
    expect(state.value).toEqual({ theme: 'dark' })
  })

  it('hydrates a version-only envelope written by the react package', () => {
    localStorage.setItem(KEY, '{"__vss":1,"value":"\\"react\\"","v":3}')
    const [state] = useState('init', { persist: true, storageKey: KEY, version: 3 })
    expect(state.value).toBe('react')
  })

  it('discards an expired envelope written by the react package', () => {
    localStorage.setItem(KEY, '{"__vss":1,"value":"\\"stale\\"","expires":1000}')
    const [state] = useState('init', { persist: true, storageKey: KEY, ttl: 60_000 })
    expect(state.value).toBe('init')
  })

  it('writes the exact ttl+version envelope the react package reads', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const [, set] = useState('a', { persist: true, storageKey: KEY, ttl: 60_000, version: 2 })
    set('b')
    await nextTick()
    expect(localStorage.getItem(KEY)).toBe('{"__vss":1,"value":"\\"b\\"","expires":60000,"v":2}')
  })

  it('writes the exact version-only envelope the react package reads', async () => {
    const [, set] = useState('a', { persist: true, storageKey: KEY, version: 3 })
    set('b')
    await nextTick()
    expect(localStorage.getItem(KEY)).toBe('{"__vss":1,"value":"\\"b\\"","v":3}')
  })

  it('writes the plain value both packages read when no ttl or version is set', async () => {
    const [, set] = useState({ n: 0 }, { persist: true, storageKey: KEY })
    set({ n: 1 })
    await nextTick()
    expect(localStorage.getItem(KEY)).toBe('{"n":1}')
  })
})
