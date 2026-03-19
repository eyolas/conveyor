import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Conveyor',
  description: 'A multi-backend job queue for Deno, Node.js, and Bun',

  head: [
    ['link', { rel: 'icon', href: '/logo.jpeg' }],
  ],

  sitemap: {
    hostname: 'https://conveyor.run',
  },

  themeConfig: {
    logo: '/logo.jpeg',

    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'API', link: '/api/' },
      { text: 'Examples', link: '/examples/' },
      {
        text: 'v0.4.0',
        items: [
          { text: 'Changelog', link: '/changelog' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is Conveyor?', link: '/guide/' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Installation', link: '/guide/installation' },
          ],
        },
        {
          text: 'Concepts',
          items: [
            { text: 'Architecture', link: '/concepts/architecture' },
            { text: 'Job Lifecycle', link: '/concepts/job-lifecycle' },
            { text: 'Stores', link: '/concepts/stores' },
            { text: 'Multi-Runtime', link: '/concepts/multi-runtime' },
          ],
        },
        {
          text: 'Features',
          items: [
            { text: 'Scheduling', link: '/features/scheduling' },
            { text: 'Retry & Backoff', link: '/features/retry-backoff' },
            { text: 'Concurrency', link: '/features/concurrency' },
            { text: 'Rate Limiting', link: '/features/rate-limiting' },
            { text: 'Deduplication', link: '/features/deduplication' },
            { text: 'Priority & Ordering', link: '/features/priority-ordering' },
            { text: 'Pause / Resume', link: '/features/pause-resume' },
            { text: 'Flows', link: '/features/flows' },
            { text: 'Batching', link: '/features/batching' },
            { text: 'Observables', link: '/features/observables' },
            { text: 'Groups', link: '/features/groups' },
            { text: 'Events', link: '/features/events' },
            { text: 'Graceful Shutdown', link: '/features/graceful-shutdown' },
          ],
        },
      ],

      '/concepts/': [
        {
          text: 'Concepts',
          items: [
            { text: 'Architecture', link: '/concepts/architecture' },
            { text: 'Job Lifecycle', link: '/concepts/job-lifecycle' },
            { text: 'Stores', link: '/concepts/stores' },
            { text: 'Multi-Runtime', link: '/concepts/multi-runtime' },
          ],
        },
      ],

      '/features/': [
        {
          text: 'Features',
          items: [
            { text: 'Scheduling', link: '/features/scheduling' },
            { text: 'Retry & Backoff', link: '/features/retry-backoff' },
            { text: 'Concurrency', link: '/features/concurrency' },
            { text: 'Rate Limiting', link: '/features/rate-limiting' },
            { text: 'Deduplication', link: '/features/deduplication' },
            { text: 'Priority & Ordering', link: '/features/priority-ordering' },
            { text: 'Pause / Resume', link: '/features/pause-resume' },
            { text: 'Flows', link: '/features/flows' },
            { text: 'Batching', link: '/features/batching' },
            { text: 'Observables', link: '/features/observables' },
            { text: 'Groups', link: '/features/groups' },
            { text: 'Events', link: '/features/events' },
            { text: 'Graceful Shutdown', link: '/features/graceful-shutdown' },
          ],
        },
      ],

      '/stores/': [
        {
          text: 'Stores',
          items: [
            { text: 'Overview', link: '/stores/' },
            { text: 'Memory', link: '/stores/memory' },
            { text: 'PostgreSQL', link: '/stores/postgresql' },
            { text: 'SQLite', link: '/stores/sqlite' },
            { text: 'SQLite (Node)', link: '/stores/sqlite-node' },
            { text: 'SQLite (Bun)', link: '/stores/sqlite-bun' },
            { text: 'SQLite (Deno)', link: '/stores/sqlite-deno' },
            { text: 'Custom Store', link: '/stores/custom-store' },
          ],
        },
      ],

      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'Queue', link: '/api/queue' },
            { text: 'Worker', link: '/api/worker' },
            { text: 'Job', link: '/api/job' },
            { text: 'FlowProducer', link: '/api/flow-producer' },
            { text: 'JobObservable', link: '/api/job-observable' },
            { text: 'EventBus', link: '/api/event-bus' },
            { text: 'Types', link: '/api/types' },
            { text: 'StoreInterface', link: '/api/store-interface' },
          ],
        },
      ],

      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Overview', link: '/examples/' },
            { text: 'Basic (Memory)', link: '/examples/basic' },
            { text: 'PostgreSQL', link: '/examples/postgresql' },
            { text: 'SQLite', link: '/examples/sqlite' },
          ],
        },
      ],

      '/advanced/': [
        {
          text: 'Advanced',
          items: [
            { text: 'Benchmarks', link: '/advanced/benchmarks' },
            { text: 'Migration from BullMQ', link: '/advanced/migration-from-bullmq' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/eyolas/conveyor' },
    ],

    editLink: {
      pattern: 'https://github.com/eyolas/conveyor/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2026-present Conveyor contributors',
    },
  },
});
