# vue-smart-state

A type-safe, reactive, persistent and cross-tab synced `useState` composable for Vue 3 — derived from React's `useState`, grown up for real apps: TTL expiry, versioned migrations, schema validation, custom storage (cookies included), SSR safety and zero dependencies.

[![npm](https://img.shields.io/npm/v/vue-smart-state)](https://www.npmjs.com/package/vue-smart-state)
[![ci](https://github.com/LuigiDavideMicca/vue-smart-state/actions/workflows/ci.yml/badge.svg)](https://github.com/LuigiDavideMicca/vue-smart-state/actions/workflows/ci.yml)
[![bundle size](https://img.shields.io/bundlephobia/minzip/vue-smart-state)](https://bundlephobia.com/package/vue-smart-state)
[![license](https://img.shields.io/npm/l/vue-smart-state)](./LICENSE)

If you searched for *"React useState for Vue"*, *"Vue localStorage composable"*, *"Vue persistent state with expiry"* or *"sync Vue state across tabs"* — this is that package, in one dependency-free call.

## Why

Vue gives you `ref`. Real apps also need the boring parts around it: persisting to storage, restoring on load, staying in sync across tabs, expiring stale values, migrating old shapes, validating what comes back, surviving SSR. `vue-smart-state` packs all of that behind one call, with full TypeScript inference.

## Installation

```bash
npm install vue-smart-state
# or
pnpm add vue-smart-state
# or
bun add vue-smart-state
```

Requires Vue `>= 3.2`.

## Quick start

```ts
import { useState } from 'vue-smart-state'

const [counter, setCounter] = useState(0)

setCounter(5)
setCounter((current) => current + 1) // functional updater, React-style
```

`counter` is a regular Vue `Ref` — use it in templates and computeds as usual.

## Persistence

```ts
const [user, setUser] = useState({ name: 'Alice' }, {
  persist: true,
  storageKey: 'user',
  storageType: 'local' // 'local' (default) or 'session'
})
```

The value is restored from storage on load and written back on every change. Plain values written by older versions of this library keep working.

### With an expiry (TTL)

```ts
const [token, setToken] = useState('', {
  persist: true,
  storageKey: 'auth-token',
  ttl: 15 * 60 * 1000 // 15 minutes: expired values fall back to the initial one
})
```

### With a custom serializer

```ts
const [tags, setTags] = useState(new Set<string>(), {
  persist: true,
  storageKey: 'tags',
  serializer: {
    read: (raw) => new Set(JSON.parse(raw)),
    write: (value) => JSON.stringify([...value])
  }
})
```

## Validation

Storage is user-editable — treat what comes back as untrusted. Pass any [Standard Schema](https://standardschema.dev) v1 schema (Zod 4, Valibot, ArkType, …) and invalid data falls back to the initial value, exactly like corrupt data would:

```ts
import { z } from 'zod'

const Prefs = z.object({ theme: z.enum(['light', 'dark']), fontSize: z.number() })

const [prefs, setPrefs] = useState({ theme: 'light', fontSize: 14 }, {
  persist: true,
  storageKey: 'prefs',
  schema: Prefs // the state type is inferred from the schema
})
```

The schema runs on hydration and on values arriving from other tabs. Only synchronous validation is supported — an async schema logs a `console.error` and keeps the initial value. No schema library? A plain guard works too:

```ts
const [count] = useState(0, {
  persist: true,
  storageKey: 'count',
  parse: (value) => {
    if (typeof value !== 'number') throw new Error('expected a number')
    return value
  }
})
```

When both are given, `schema` wins and `parse` is ignored.

## Versioned migrations

Shipped a new shape for a persisted value? Bump `version` and migrate old data instead of breaking on it:

```ts
const [settings, setSettings] = useState({ theme: 'light', locale: 'en' }, {
  persist: true,
  storageKey: 'settings',
  version: 2,
  migrate: (value, fromVersion) => {
    if (fromVersion === 0) return { theme: value as string, locale: 'en' } // pre-envelope
    if (fromVersion === 1) return { ...(value as { theme: string }), locale: 'en' }
    return undefined // unknown: discard and start fresh
  }
})
```

Values persisted before versioning existed are handed to `migrate` as version `0`. Without a `migrate` function, outdated values are discarded. Migration runs before validation, so your schema only ever sees the current shape.

## Merging with defaults

Added a new field to a persisted object? `mergeDefaults` fills the gaps in old data:

```ts
const [prefs] = useState({ theme: 'light', fontSize: 14 }, {
  persist: true,
  storageKey: 'prefs',
  mergeDefaults: true // shallow: { ...defaults, ...stored }
})
```

The merge is **shallow** and only happens when both the stored and the initial value are plain objects. Need deep or custom semantics? Pass a function: `mergeDefaults: (stored, defaults) => ({ ...defaults, ...stored, nested: { ...defaults.nested, ...stored.nested } })`. It runs after `parse`/`schema`/`migrate`.

## Custom storage & cookies

Anything with `getItem`/`setItem`/`removeItem` (synchronous) works as a backend via the `storage` option — it takes precedence over `storageType`:

```ts
import { useState, cookieStorage } from 'vue-smart-state'

const [theme, setTheme] = useState('light', {
  persist: true,
  storageKey: 'theme',
  storage: cookieStorage({ days: 365, sameSite: 'lax' }) // path, secure too
})
```

`cookieStorage()` is SSR-safe: on the server `getItem` returns `null` and writes are no-ops. TTL, versioning and validation all work the same on top of it.

### SSR without the flash (Nuxt recipe)

Cookies travel with the request, so the server can render the *persisted* value instead of the initial one — no flash on hydration:

```ts
// composables/useTheme.ts
import { useState as useSmartState, cookieStorage } from 'vue-smart-state'

export const useTheme = () => {
  // Server & client both start from the cookie Nuxt already parsed for us.
  const initial = useCookie<'light' | 'dark'>('theme').value ?? 'light'
  return useSmartState(initial, {
    persist: true,
    storageKey: 'theme',
    storage: cookieStorage()
  })
}
```

Plain Vue SSR works the same way: read the cookie from the incoming request on the server, pass it as the initial value, and let `cookieStorage()` take over on the client.

## Cross-tab sync

```ts
const [cart, setCart] = useState([], {
  persist: true,
  storageKey: 'cart',
  syncTabs: true
})
```

Changes in one tab appear in every other tab via the `storage` event. If another tab clears the key, the state falls back to the initial value. Listeners registered inside a component are removed with it; at module level (global stores) they live for the session — on purpose.

### BroadcastChannel

`storage` events only fire for `localStorage` writes. `syncTabs: 'broadcast'` syncs through a `BroadcastChannel` named `vss:<storageKey>` instead — it works with any storage backend (cookies included) and delivers the exact written payload:

```ts
const [cart, setCart] = useState([], {
  persist: true,
  storageKey: 'cart',
  syncTabs: 'broadcast'
})
```

The channel is closed when the owning component is unmounted. Where `BroadcastChannel` doesn't exist, it silently falls back to `storage` events. `syncTabs: 'storage'` is an explicit alias for `true`.

## Reset and clear

The third element of the tuple gives you lifecycle controls:

```ts
const [filters, setFilters, { reset, clear }] = useState(defaultFilters, {
  persist: true,
  storageKey: 'filters'
})

reset() // back to the initial value (and persists it)
clear() // removes the storage entry and restores the initial value
```

## SSR

Safe out of the box: on the server (Nuxt, SSG builds) storage and window listeners are skipped and the state starts from the initial value. No guards needed in your code.

## Options

| Option        | Type                                        | Default        | Description                                                             |
| ------------- | ------------------------------------------- | -------------- | ----------------------------------------------------------------------- |
| `shallow`     | `boolean`                                   | `false`        | Use `shallowRef` instead of a deep `ref`.                               |
| `persist`     | `boolean`                                   | `false`        | Persist to web storage (requires `storageKey`).                         |
| `storageKey`  | `string`                                    | `''`           | Storage key.                                                            |
| `storageType` | `'local' \| 'session'`                      | `'local'`      | Which storage to use. Cross-tab sync only works with `'local'`.         |
| `storage`     | `StorageLike`                               | —              | Custom storage backend (e.g. `cookieStorage()`); wins over `storageType`. |
| `deepWatch`   | `boolean`                                   | `false`        | Persist nested mutations too.                                           |
| `syncTabs`    | `boolean \| 'storage' \| 'broadcast'`       | `false`        | Sync across tabs via `storage` events or a `BroadcastChannel`.          |
| `ttl`         | `number`                                    | —              | Milliseconds a persisted value stays fresh.                             |
| `writeDebounce` | `number`                                  | —              | Debounce storage writes (pending writes flush on component unmount).    |
| `serializer`  | `{ read(raw): T; write(value): string }`    | JSON           | Custom (de)serialization.                                               |
| `schema`      | `StandardSchemaV1<unknown, T>`              | —              | Standard Schema (Zod 4, Valibot, ArkType…) validating restored data.    |
| `parse`       | `(value: unknown) => T`                     | —              | Manual validation: return the value or throw. Ignored when `schema` is set. |
| `version`     | `number`                                    | —              | Schema version of the persisted value.                                  |
| `migrate`     | `(value, fromVersion) => T \| undefined`    | —              | Upgrade older persisted values; `undefined` discards them.              |
| `mergeDefaults` | `boolean \| (stored, defaults) => T`      | `false`        | Shallow-merge stored plain objects over the defaults, or custom merge.  |
| `onError`     | `(error, context) => void`                  | `console.warn` | Called on read/write/sync failures (e.g. quota exceeded).               |

## Debounced writes

Persisting a text input? Don't hammer storage on every keystroke:

```ts
const [draft, setDraft] = useState('', {
  persist: true,
  storageKey: 'message-draft',
  writeDebounce: 300 // ms — a pending write is flushed if the component unmounts
})
```

## How it compares

| Capability                          | `vue-smart-state` | `@vueuse/core` `useStorage` | `pinia-plugin-persistedstate` |
| ----------------------------------- | :---------------: | :-------------------------: | :---------------------------: |
| Bundle size (min+gzip)              | ~2 kB, 0 deps     | tree-shakeable, part of a large suite | small, requires Pinia |
| React-style tuple + functional updater | ✅             | ❌ (single ref)             | ❌ (store plugin)             |
| TTL / expiry of persisted values    | ✅                | ❌                          | ❌                            |
| Versioned migrations                | ✅                | ❌                          | ❌                            |
| Schema validation (Standard Schema) | ✅                | ❌                          | ❌                            |
| Integrated debounced writes         | ✅ (unmount flush) | via extra composable       | ❌                            |
| Cross-tab sync                      | ✅ storage + BroadcastChannel | ✅ storage events | ❌                            |
| Custom storage backend              | ✅                | ✅                          | ✅                            |
| Custom serializers                  | ✅                | ✅                          | ✅                            |
| Cookie storage / SSR no-flash recipe | ✅ `cookieStorage()` | ❌ in core (Nuxt `useCookie` separately) | ✅ via its Nuxt module |
| `mergeDefaults`                     | ✅                | ✅                          | ❌ (hydration hooks instead)  |

`@vueuse/core` is a great toolbelt and `pinia-plugin-persistedstate` is the natural pick when your state already lives in Pinia stores. `vue-smart-state`'s edge is the combination: TTL, migrations, validation and debounced writes behind one React-style call, tiny and typed.

## Cross-framework interop

`vue-smart-state` shares its persisted format with its siblings [`smart-state`](https://github.com/LuigiDavideMicca/smart-state) (React) and [`nuxt-smart-state`](https://github.com/LuigiDavideMicca/nuxt-smart-state): plain JSON when no TTL/version is set, and the envelope `{ "__vss": 1, "value": "...", "expires": …, "v": … }` otherwise. That envelope is a hard invariant across the family — a React app and a Vue app on the same origin (say, during an incremental migration) can share persisted state, TTLs and versions out of the box, in both directions.

## As a plugin

```ts
import { SmartStatePlugin } from 'vue-smart-state'
import { createApp } from 'vue'

const app = createApp(App)
app.use(SmartStatePlugin)
```

Components can then call `this.$useSmartState(...)` (Options API). With `<script setup>`, importing `useState` directly is the recommended path.

## Development

Any package manager works:

```bash
bun install && bun run test        # or: npm / pnpm / yarn
bun run typecheck
bun run build                      # tsup → dist (ESM + CJS + d.ts)
```

Pull requests welcome — every PR runs typecheck, tests and build in CI.

## License

[MIT](./LICENSE) © [Luigi Davide Micca](https://luigimicca.com)
