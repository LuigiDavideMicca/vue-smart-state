# Changelog

## [0.3.0](https://github.com/LuigiDavideMicca/vue-smart-state/compare/v0.2.1...v0.3.0) (2026-11-11)


### ⚠ BREAKING CHANGES

* setting undefined removes the persisted entry; the initial value is copied, so the object passed in is no longer the state; instances persisting under the same storage and key in one tab now share every change; an async schema is reported to onError instead of console.error.

### Features

* same-tab instances share state, hydrate after mount, and the sync bugs fixed ([bd085c4](https://github.com/LuigiDavideMicca/vue-smart-state/commit/bd085c40877d30327a45ce36c38a6a7a3ff5e83a))


### Bug Fixes

* an edit made in the same tick as an outside value is persisted ([0c4ee5f](https://github.com/LuigiDavideMicca/vue-smart-state/commit/0c4ee5ff29d5422b68e2a74dc13a4993b8a0a0bd))
* the write guard no longer slows mutations, drops reverts or stops ttl renewals ([2cab6c6](https://github.com/LuigiDavideMicca/vue-smart-state/commit/2cab6c6661fcec3e73bcd0fd1fb9d847a526ed7d))

## [0.2.1](https://github.com/LuigiDavideMicca/vue-smart-state/compare/v0.2.0...v0.2.1) (2026-07-28)


### Bug Fixes

* **ci:** upgrade npm for the oidc token exchange ([9c2c6a7](https://github.com/LuigiDavideMicca/vue-smart-state/commit/9c2c6a7987e2b8838443d8fec4e0a366a4199add))

## [0.2.0](https://github.com/LuigiDavideMicca/vue-smart-state/compare/vue-smart-state-v0.1.0...vue-smart-state-v0.2.0) (2026-07-28)


### Features

* broadcastchannel cross-tab sync with storage-event fallback ([4ea1c76](https://github.com/LuigiDavideMicca/vue-smart-state/commit/4ea1c767b1289f3b2857a50dca9acca2d49c0db1))
* mergeDefaults for stored plain objects ([1f970d0](https://github.com/LuigiDavideMicca/vue-smart-state/commit/1f970d0ca57c6d8b148786c5efbaa9abb613a5bd))
* pluggable storage backend and ssr-safe cookieStorage ([7c95650](https://github.com/LuigiDavideMicca/vue-smart-state/commit/7c956503765332515849e70cb2a78e839f0ffd71))
* standard schema validation for hydrated and synced values ([6e54048](https://github.com/LuigiDavideMicca/vue-smart-state/commit/6e540489194fc0ee851a8fb47ae146dd539d852b))
* versioned envelopes with migrate and runtime parse validation ([4aaaf3f](https://github.com/LuigiDavideMicca/vue-smart-state/commit/4aaaf3f6372a851eb97cecb82ca61f1793707494))
