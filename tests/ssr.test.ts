// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { useState } from '../src/useState'
import { cookieStorage } from '../src/cookieStorage'

afterEach(() => vi.unstubAllGlobals())

describe('SSR', () => {
  it('renders the initial value without window', async () => {
    const App = defineComponent({
      setup() {
        const [v] = useState('init', { persist: true, storageKey: 'k', syncTabs: true })
        return () => h('p', v.value)
      }
    })
    expect(await renderToString(createSSRApp(App))).toBe('<p>init</p>')
  })

  it('S1 does not open a BroadcastChannel per request on the server (never closed)', async () => {
    const opened: string[] = []
    class Spy {
      onmessage = null
      constructor(name: string) {
        opened.push(name)
      }
      postMessage() {}
      close() {
        opened.pop()
      }
    }
    vi.stubGlobal('BroadcastChannel', Spy)
    const App = defineComponent({
      setup() {
        const [v] = useState('light', {
          persist: true,
          storageKey: 'theme',
          storage: cookieStorage(),
          syncTabs: 'broadcast'
        })
        return () => h('p', v.value)
      }
    })
    for (let i = 0; i < 3; i++) await renderToString(createSSRApp(App))
    expect(opened).toHaveLength(0) 
  })

  it("a store created in setup belongs to one request", async () => {
    const App = (user: string) =>
      defineComponent({
        setup() {
          const [cart, setCart] = useState<string[]>([])
          if (user === "alice") setCart(["alice-secret"])
          return () => h("p", cart.value.join(","))
        }
      })
    expect(await renderToString(createSSRApp(App("alice")))).toBe("<p>alice-secret</p>")
    expect(await renderToString(createSSRApp(App("bob")))).toBe("<p></p>")
  })
})
