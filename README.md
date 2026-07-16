# vue-smart-state

A type-safe, reactive, persistent and cross-tab synced `useState` composable for Vue 3 — derived from React's `useState`, grown up for real apps: TTL expiry, custom serializers, SSR safety and zero dependencies.

[![npm](https://img.shields.io/npm/v/vue-smart-state)](https://www.npmjs.com/package/vue-smart-state)
[![license](https://img.shields.io/npm/l/vue-smart-state)](./LICENSE)

## Why

Vue gives you `ref`. Real apps also need the boring parts around it: persisting to storage, restoring on load, staying in sync across tabs, expiring stale values, surviving SSR. `vue-smart-state` packs all of that behind one call, with full TypeScript inference.

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

## Cross-tab sync

```ts
const [cart, setCart] = useState([], {
  persist: true,
  storageKey: 'cart',
  syncTabs: true
})
```

Changes in one tab appear in every other tab via the `storage` event. If another tab clears the key, the state falls back to the initial value. Listeners registered inside a component are removed with it; at module level (global stores) they live for the session — on purpose.

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
| `deepWatch`   | `boolean`                                   | `false`        | Persist nested mutations too.                                           |
| `syncTabs`    | `boolean`                                   | `false`        | Sync the value across tabs.                                             |
| `ttl`         | `number`                                    | —              | Milliseconds a persisted value stays fresh.                             |
| `serializer`  | `{ read(raw): T; write(value): string }`    | JSON           | Custom (de)serialization.                                               |
| `onError`     | `(error, context) => void`                  | `console.warn` | Called on read/write/sync failures (e.g. quota exceeded).               |

## As a plugin

```ts
import { SmartStatePlugin } from 'vue-smart-state'
import { createApp } from 'vue'

const app = createApp(App)
app.use(SmartStatePlugin)
```

Components can then call `this.$useSmartState(...)` (Options API). With `<script setup>`, importing `useState` directly is the recommended path.

## License

[MIT](./LICENSE) © Luigi Davide Micca
