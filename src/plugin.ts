import { App } from 'vue'
import { useState, UseStateOptions } from './useState'

export const SmartStatePlugin = {
  install(app: App) {
    app.config.globalProperties.$useSmartState = useState
  }
}

declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    $useSmartState: typeof useState
  }
}
