---
'@gabrielhicks/solv': patch
---

Only append the Jito patch suffix (e.g. `.0`) to the pinned default version, so `solv i -v <version>` no longer builds a non-existent `-jito.0` tag. Abort install if the jito-solana tag checkout fails instead of silently building `master`.
