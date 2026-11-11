import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, nextTick } from 'vue'
import { useState } from '../src/useState'

describe('hydration', () => {
  it('hydrate: mounted hydrates with the initial value, then shows the stored one', async () => {
    localStorage.setItem('theme', '"dark"')
    const el = document.createElement('div')
    el.innerHTML = '<p>light</p>' // what the server rendered (no window -> initial value)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const App = defineComponent({
      setup() {
        const [theme] = useState('light', { persist: true, storageKey: 'theme', hydrate: 'mounted' })
        return () => h('p', theme.value)
      }
    })
    createSSRApp(App).mount(el)
    const logs = [...warn.mock.calls, ...err.mock.calls].flat().join(' ')
    expect(logs).not.toMatch(/[Hh]ydration/)
    await nextTick()
    expect(el.innerHTML).toBe('<p>dark</p>')
    expect(localStorage.getItem('theme')).toBe('"dark"')
  })
})
