---
layout: home

hero:
  name: Conveyor
  text: Multi-Backend Job Queue
  tagline: BullMQ-like API for Deno, Node.js, and Bun — no Redis required
  image:
    src: /logo.jpeg
    alt: Conveyor
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/eyolas/conveyor

features:
  - icon: "\U0001F50C"
    title: Zero Lock-in
    details: Switch between PostgreSQL, SQLite, and in-memory stores by changing one line of config.
  - icon: "\U0001F3AF"
    title: Familiar API
    details: If you know BullMQ, you know Conveyor. Same patterns, no Redis dependency.
  - icon: "\U0001F30D"
    title: Runtime Agnostic
    details: First-class support for Deno 2, Node.js 18+, and Bun 1.1+.
  - icon: "\U0001F512"
    title: Type-Safe
    details: Full TypeScript with generics on job payloads — catch errors at compile time.
  - icon: "\U0001F680"
    title: Feature Rich
    details: Scheduling, retry, priority, rate limiting, flows, batching, observables, and more.
  - icon: "\U0001F9EA"
    title: Testable
    details: In-memory store makes tests fast and deterministic — no external services needed.
---
