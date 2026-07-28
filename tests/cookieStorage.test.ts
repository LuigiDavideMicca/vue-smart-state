import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { cookieStorage } from '../src/cookieStorage'
import { useState } from '../src/useState'

const clearCookies = () => {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
}

beforeEach(clearCookies)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cookieStorage', () => {
  it('round-trips values through document.cookie', () => {
    const storage = cookieStorage()
    storage.setItem('theme', '"dark"')
    expect(storage.getItem('theme')).toBe('"dark"')
    expect(document.cookie).toContain('theme=')
  })

  it('encodes keys and values safely', () => {
    const storage = cookieStorage()
    storage.setItem('user prefs', '{"a":"b; c=d"}')
    expect(storage.getItem('user prefs')).toBe('{"a":"b; c=d"}')
  })

  it('removeItem deletes the cookie', () => {
    const storage = cookieStorage()
    storage.setItem('theme', '"dark"')
    storage.removeItem('theme')
    expect(storage.getItem('theme')).toBeNull()
  })

  it('is a no-op on the server', () => {
    const storage = cookieStorage()
    vi.stubGlobal('document', undefined)
    expect(storage.getItem('theme')).toBeNull()
    expect(() => storage.setItem('theme', '"dark"')).not.toThrow()
    expect(() => storage.removeItem('theme')).not.toThrow()
  })

  it('persists useState values across instances', async () => {
    const [, set] = useState('light', {
      persist: true,
      storageKey: 'theme',
      storage: cookieStorage()
    })
    set('dark')
    await nextTick()

    const [restored] = useState('light', {
      persist: true,
      storageKey: 'theme',
      storage: cookieStorage()
    })
    expect(restored.value).toBe('dark')
  })
})
