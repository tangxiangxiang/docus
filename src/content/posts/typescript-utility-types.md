---
title: TypeScript utility types I use most
date: "2026-01-05"
tags: [typescript, reference]
summary: Partial, Pick, Omit, Readonly, Record — the workhorses.
---

- `Partial<T>` — all properties optional
- `Required<T>` — all required
- `Pick<T, K>` — subset by key
- `Omit<T, K>` — remove keys
- `Readonly<T>` — immutable
- `Record<K, T>` — keyed map

```ts
type User = { id: string; name: string; email: string }
type PublicUser = Pick<User, 'id' | 'name'>
```
