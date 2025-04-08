import {
  ref,
  shallowRef,
  watch,
  toRaw,
  Ref,
  UnwrapRef
} from 'vue'

type StorageType = 'local' | 'session'

export interface UseStateOptions<T> {
  shallow?: boolean
  persist?: boolean
  storageKey?: string
  storageType?: StorageType
  deepWatch?: boolean
  syncTabs?: boolean
}

export function useState<T>(
  initialValue: T,
  options: UseStateOptions<T> = {}
): [Ref<UnwrapRef<T>>, (newValue: T) => void] {
  const {
    shallow = false,
    persist = false,
    storageKey = '',
    storageType = 'local',
    deepWatch = false,
    syncTabs = false
  } = options

  const storage = storageType === 'local' ? localStorage : sessionStorage

  let value = initialValue
  if (persist && storageKey) {
    try {
      const stored = storage.getItem(storageKey)
      if (stored) value = JSON.parse(stored)
    } catch (err) {
      console.warn(`[useState] Invalid stored JSON for key "${storageKey}"`)
    }
  }

  const state = shallow ? shallowRef(value) : ref(value)

  if (persist && storageKey) {
    watch(
      state,
      (val) => {
        try {
          storage.setItem(storageKey, JSON.stringify(toRaw(val)))
        } catch (err) {
          console.warn(`[useState] Failed to persist "${storageKey}"`)
        }
      },
      { deep: deepWatch }
    )
  }

  if (persist && syncTabs && storageKey) {
    window.addEventListener('storage', (e) => {
      if (e.key === storageKey && e.newValue) {
        try {
          const newVal = JSON.parse(e.newValue)
          state.value = newVal
        } catch (err) {
          console.warn(`[useState] Sync failed for key "${storageKey}"`)
        }
      }
    })
  }

  const setState = (newValue: T) => {
    state.value = newValue as UnwrapRef<T>
  }

  return [state as Ref<UnwrapRef<T>>, setState]
}
