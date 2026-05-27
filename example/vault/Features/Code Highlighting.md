---
title: Code Highlighting
tags: [feature, demo, code]
---

# Code Highlighting

Powered by highlight.js with auto-detection. Theme colours follow the
active light/dark mode via CSS variables.

## TypeScript

```ts
import { z } from "zod";

const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  createdAt: z.coerce.date(),
});

type User = z.infer<typeof userSchema>;

export async function loadUser(id: string): Promise<User> {
  const raw = await fetch(`/api/users/${id}`).then((r) => r.json());
  return userSchema.parse(raw);
}
```

## Rust

```rust
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Counter(Arc<Mutex<u64>>);

impl Counter {
    pub async fn incr(&self) -> u64 {
        let mut g = self.0.lock().await;
        *g += 1;
        *g
    }
}
```

## Python

```python
from dataclasses import dataclass
from typing import Iterator

@dataclass(frozen=True)
class Chunk:
    text: str
    line_start: int
    line_end: int

def chunk(body: str, target: int = 512) -> Iterator[Chunk]:
    cur, start = [], 1
    for ln, line in enumerate(body.splitlines(), 1):
        cur.append(line)
        if sum(len(l) for l in cur) >= target:
            yield Chunk("\n".join(cur), start, ln)
            cur, start = [], ln + 1
    if cur:
        yield Chunk("\n".join(cur), start, ln)
```

## Bash

```sh
# Quick local dev
bun install
bun run dev:server   # backend on :3000
bun run dev:web      # vite on :5173
```

## JSON

```json
{
  "mcpServers": {
    "brain.md": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```
