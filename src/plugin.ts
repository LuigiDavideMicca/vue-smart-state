import type { App } from 'vue'
import { useState } from './useState'

export const SmartStatePlugin = {
  install(app: App) {
    app.config.globalProperties.$useSmartState = useState
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $useSmartState: typeof useState
  }
}
