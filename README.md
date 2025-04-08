
# vue-smart-state

`vue-smart-state` is a powerful, type-safe, reactive, persistent, and cross-tab synced state management solution for Vue 3+. It provides a `useState` composable function, which combines reactivity, local or session storage persistence, and cross-tab synchronization, making it ideal for modern Vue applications. It was mainly derived from React useState

## 📦 Installation

To install `vue-smart-state` via npm or pnpm:

### Using npm:
```bash
npm install vue-smart-state
```

### Using pnpm:
```bash
pnpm add vue-smart-state
```

## 🧠 Usage

The `vue-smart-state` library provides a simple `useState` function that can be used to create reactive state in Vue 3. It supports multiple advanced features such as localStorage persistence, cross-tab synchronization, and custom options like shallow references.

### Basic Usage

```ts
import { useState } from 'vue-smart-state'

const [counter, setCounter] = useState(0)
```

This will create a reactive state `counter` with an initial value of `0`. The state will be a `ref` and will be reactive within the component.

### Usage with Persistence (localStorage or sessionStorage)

To persist the state across browser sessions, you can use the `persist` option along with a `storageKey`:

```ts
const [user, setUser] = useState({ name: 'Alice' }, {
  persist: true,
  storageKey: 'user',  // The key used in localStorage or sessionStorage
  storageType: 'local',  // 'local' or 'session'
})
```

In this example, the user state will be persisted in the browser’s `localStorage` with the key `user`.

### Usage with Cross-Tab Synchronization

You can also sync state across different tabs by enabling the `syncTabs` option:

```ts
const [counter, setCounter] = useState(0, {
  persist: true,
  storageKey: 'counter',
  syncTabs: true  // Enables state sync across browser tabs
})
```

When `syncTabs` is set to `true`, the state will automatically synchronize across tabs using the `storage` event.

### Usage with Shallow State

If you only need shallow reactivity (i.e., you don't want deeply nested objects to trigger updates), you can use the `shallow` option:

```ts
const [user, setUser] = useState({ name: 'Alice', age: 30 }, {
  shallow: true  // Only the top-level properties are reactive
})
```

### Complete Example

```ts
import { useState } from 'vue-smart-state'

export default {
  setup() {
    // Basic state
    const [counter, setCounter] = useState(0)

    // Persistent state with localStorage
    const [user, setUser] = useState({ name: 'Alice' }, {
      persist: true,
      storageKey: 'user',
      storageType: 'local', // Use localStorage
      syncTabs: true  // Sync state across tabs
    })

    // Shallow state
    const [product, setProduct] = useState({ name: 'Laptop', price: 1000 }, {
      shallow: true
    })

    return { counter, setCounter, user, setUser, product, setProduct }
  }
}
```

---

## 🔌 As Plugin

You can install `vue-smart-state` as a global plugin in your Vue application to easily use the `useState` composable in all components.

### Installing the Plugin

```ts
import { SmartStatePlugin } from 'vue-smart-state'
import { createApp } from 'vue'

const app = createApp(App)
app.use(SmartStatePlugin)
app.mount('#app')
```

### Using the Plugin in Components

Once the plugin is installed, you can use the `$useSmartState` property directly inside your components:

```ts
export default {
  setup() {
    const [counter, setCounter] = this.$useSmartState(0)

    return { counter, setCounter }
  }
}
```

---

## 📄 Options

### `persist`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: If set to `true`, the state will be persisted in the browser's `localStorage` or `sessionStorage`.

### `storageKey`
- **Type**: `string`
- **Default**: `''`
- **Description**: The key used in `localStorage` or `sessionStorage` to store the state.

### `storageType`
- **Type**: `'local' | 'session'`
- **Default**: `'local'`
- **Description**: Choose between `localStorage` or `sessionStorage` for state persistence.

### `syncTabs`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: If set to `true`, the state will sync across browser tabs using the `storage` event.

### `shallow`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: If set to `true`, only the top-level properties of the state will be reactive (shallow reactivity).

### `deepWatch`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: If set to `true`, the state will be deeply watched for changes.

---

## 🧑‍💻 Development

To run the development environment for `vue-smart-state` locally:

1. Clone the repository.

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Start the TypeScript compiler in watch mode:

   ```bash
   pnpm run dev
   ```

4. Build the package for production:

   ```bash
   pnpm run build
   ```

---

## 🎉 Contributing

We welcome contributions! If you have any suggestions, improvements, or bug fixes, feel free to open an issue or submit a pull request.

---

## 📜 License

MIT License. See the [LICENSE](LICENSE) file for details.
