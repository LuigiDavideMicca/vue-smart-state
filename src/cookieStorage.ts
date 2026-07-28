import type { StorageLike } from './useState'

export interface CookieStorageOptions {
  /** Days until the cookie expires. Defaults to 365. */
  days?: number
  /** Cookie path. Defaults to `/`. */
  path?: string
  /** SameSite attribute. Defaults to `lax`. */
  sameSite?: 'lax' | 'strict' | 'none'
  /** Add the Secure attribute (always added with `sameSite: 'none'`). */
  secure?: boolean
}

/**
 * A `StorageLike` over `document.cookie`, so persisted state travels with
 * requests and SSR can render the real value — no flash of the initial one.
 * SSR-safe: on the server `getItem` returns `null` and writes are no-ops.
 */
export function cookieStorage(options: CookieStorageOptions = {}): StorageLike {
  const { days = 365, path = '/', sameSite = 'lax', secure = false } = options

  const write = (key: string, value: string, maxAgeDays: number): void => {
    if (typeof document === 'undefined') return
    const expires = new Date(Date.now() + maxAgeDays * 86_400_000).toUTCString()
    let cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; expires=${expires}; path=${path}; samesite=${sameSite}`
    if (secure || sameSite === 'none') cookie += '; secure'
    document.cookie = cookie
  }

  return {
    getItem: (key) => {
      if (typeof document === 'undefined') return null
      const prefix = `${encodeURIComponent(key)}=`
      for (const part of document.cookie.split(';')) {
        const trimmed = part.trim()
        if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length))
      }
      return null
    },
    setItem: (key, value) => write(key, value, days),
    removeItem: (key) => write(key, '', -1)
  }
}
