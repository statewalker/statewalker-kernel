---
"@statewalker/platform.browser": minor
---

Add `createBrowserHostServices()`: the browser's clipboard, file picker and URL state (the hash) as one object, over the existing `platform:copy-to-clipboard` and `platform:pick-file` handlers, for system.host's `host-services` defaults.

Fix `buildHash` and `parseHash` (and so `bindUrlState`) for paths with characters the hash escapes: the path's segments are now percent-encoded and decoded, so a space, a non-ASCII character, `?`, `#` or `%` round-trips instead of reading back escaped or spilling into the query. Plain paths are written as before.
