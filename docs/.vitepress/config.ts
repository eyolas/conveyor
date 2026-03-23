import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

interface VersionEntry {
  text: string;
  link: string;
}

interface VersionsConfig {
  current: string;
  fullVersion: string;
  versions: VersionEntry[];
}

function loadVersions(): VersionsConfig {
  const raw = readFileSync(resolve(__dirname, '../versions.json'), 'utf-8');
  return JSON.parse(raw);
}

function versionNav() {
  const { current, versions } = loadVersions();
  const items = [
    { text: 'Changelog', link: '/changelog' },
  ];

  if (versions.length > 0) {
    items.push(
      ...versions.map((v) => ({
        text: `${v.text} (old)`,
        link: v.link,
      })),
    );
  }

  return { text: current, items };
}

function guideSidebar() {
  return [
    {
      text: 'Introduction',
      collapsed: true,
      items: [
        { text: 'What is Conveyor?', link: '/guide/' },
        { text: 'Getting Started', link: '/guide/getting-started' },
        { text: 'Installation', link: '/guide/installation' },
      ],
    },
    {
      text: 'Concepts',
      collapsed: true,
      items: [
        { text: 'Architecture', link: '/concepts/architecture' },
        { text: 'Job Lifecycle', link: '/concepts/job-lifecycle' },
        { text: 'Stores', link: '/concepts/stores' },
        { text: 'Multi-Runtime', link: '/concepts/multi-runtime' },
      ],
    },
    {
      text: 'Features',
      collapsed: true,
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
        { text: 'Job Mutations', link: '/features/job-mutations' },
        { text: 'Queue Management', link: '/features/queue-management' },
        { text: 'Wait Until Finished', link: '/features/wait-until-finished' },
        { text: 'Observables', link: '/features/observables' },
        { text: 'Groups', link: '/features/groups' },
        { text: 'Events', link: '/features/events' },
        { text: 'Graceful Shutdown', link: '/features/graceful-shutdown' },
      ],
    },
  ];
}

export default withMermaid(defineConfig({
  title: 'Conveyor',
  description: 'A multi-backend job queue for Deno, Node.js, and Bun',

  head: [
    ['link', { rel: 'icon', href: '/logo.jpeg' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Conveyor' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'A multi-backend job queue for Deno, Node.js, and Bun',
      },
    ],
    ['meta', { property: 'og:image', content: 'https://conveyor.run/logo.jpeg' }],
    ['meta', { property: 'og:url', content: 'https://conveyor.run' }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
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
      versionNav(),
    ],

    sidebar: {
      '/guide/': guideSidebar(),
      '/concepts/': guideSidebar(),
      '/features/': guideSidebar(),

      '/stores/': [
        {
          text: 'Stores',
          collapsed: true,
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
          collapsed: true,
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
          collapsed: true,
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
          collapsed: true,
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
      copyright: 'Copyright 2026-present David Touzet & Conveyor contributors',
    },
  },

  mermaid: {
    theme: 'base',
    themeVariables: {
      fontSize: '16px',
    },
  },
}));
