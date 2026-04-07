/**
 * @module @conveyor/dashboard/assets
 *
 * Serves pre-built UI assets from the `dist/` directory.
 */

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** In-memory cache of loaded assets. */
const assetCache = new Map<string, { content: Uint8Array; contentType: string }>();

/** Resolve the dist directory path relative to this module. */
function getDistDir(): string {
  const moduleDir = new URL('.', import.meta.url).pathname;
  return moduleDir.replace(/\/$/, '') + '/../dist';
}

/**
 * Try to load a static asset from `dist/`. Returns a Response or null.
 */
export async function serveAsset(pathname: string): Promise<Response | null> {
  // Normalize: strip leading slash, default to index.html
  const filePath = pathname.replace(/^\/+/, '') || 'index.html';

  // Security: prevent directory traversal
  if (filePath.includes('..') || filePath.includes('\0')) return null;

  // Check cache
  const cached = assetCache.get(filePath);
  if (cached) {
    return new Response(cached.content as BodyInit, {
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': filePath.includes('.') && filePath !== 'index.html'
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      },
    });
  }

  // Determine MIME type
  const ext = '.' + (filePath.split('.').pop() ?? '');
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

  // Try to read the file
  const distDir = getDistDir();
  const fullPath = `${distDir}/${filePath}`;

  try {
    // Use Deno.readFile if available, fall back to Node fs
    let content: Uint8Array;
    if (typeof Deno !== 'undefined') {
      content = await Deno.readFile(fullPath);
    } else {
      // Node.js / Bun fallback
      const fs = await import('node:fs/promises');
      content = await fs.readFile(fullPath);
    }

    // Cache the asset
    assetCache.set(filePath, { content, contentType });

    return new Response(content as BodyInit, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': filePath !== 'index.html'
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      },
    });
  } catch {
    return null;
  }
}

/** Serve the SPA index.html (for client-side routing fallback). */
export async function serveIndex(): Promise<Response> {
  const response = await serveAsset('index.html');
  return response ??
    new Response('Dashboard UI not built. Run: cd packages/dashboard/ui && npm run build', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
}
