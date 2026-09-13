// Run: node scripts/verify-web-metadata.mjs
// Validate production HTML in memory; do not modify the running site's dist/.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, resolveConfig } from 'vite';
import { JSDOM } from 'jsdom';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/web');
const manifest = JSON.parse(await readFile(resolve(root, 'public/site.webmanifest'), 'utf8'));

for (const [name, base, site] of [
  ['root', '/', ''],
  ['subpath', '/doc2audio/', ''],
  ['site-root', '/', 'https://fixture.invalid/'],
  ['site-subpath', '/doc2audio/', 'https://fixture.invalid/doc2audio'],
]) {
  process.env.DOC2AUDIO_BASE = base;
  process.env.DOC2AUDIO_SITE_URL = site;
  const result = await build({ root, logLevel: 'error', build: { write: false } });
  const output = Array.isArray(result) ? result.flatMap(item => item.output) : result.output;
  const html = output.find(item => item.fileName === 'index.html').source;
  const dom = new JSDOM(String(html));
  const document = dom.window.document;
  const content = selector => document.querySelector(selector)?.getAttribute('content');
  assert.equal(document.title, 'DOC2AUDIO — 나만의 오디오 서재');
  assert.equal(
    document.querySelector('link[rel=manifest]').getAttribute('href'),
    `${base}site.webmanifest`,
  );
  assert.equal(
    document.querySelector('link[rel=apple-touch-icon]').getAttribute('href'),
    `${base}apple-touch-icon.png`,
  );
  assert.equal(document.querySelector('link[rel=icon]').getAttribute('href'), `${base}favicon.ico`);
  assert.equal(
    content('meta[property="og:image"]'),
    site ? `https://fixture.invalid${base}brand/social-card.png` : `${base}brand/social-card.png`,
  );
  assert.equal(content('meta[name="twitter:image"]'), content('meta[property="og:image"]'));
  assert.equal(content('meta[name="twitter:card"]'), 'summary_large_image');
  assert.equal(content('meta[property="og:image:width"]'), '1200');
  assert.equal(content('meta[property="og:image:height"]'), '630');
  if (site) {
    assert.equal(content('meta[property="og:url"]'), `https://fixture.invalid${base}`);
    assert.equal(
      document.querySelector('link[rel=canonical]').getAttribute('href'),
      `https://fixture.invalid${base}`,
    );
  } else {
    assert.equal(content('meta[property="og:url"]'), undefined);
    assert.equal(document.querySelector('link[rel=canonical]'), null);
  }
  assert(!String(html).includes('%BASE_URL%'));
  dom.window.close();

  const manifestUrl = `https://fixture.invalid${base}site.webmanifest`;
  assert.equal(manifest.name, 'DOC2AUDIO');
  assert.equal(manifest.short_name, 'DOC2AUDIO');
  assert.equal(manifest.display, 'standalone');
  const start = new URL(manifest.start_url, manifestUrl);
  const scope = new URL(manifest.scope, manifestUrl);
  // The manifest specification uses start_url when id is absent or empty.
  const id = manifest.id ? new URL(manifest.id, start.origin).href : start.href;
  assert.equal(start.href, `https://fixture.invalid${base}`);
  assert.equal(scope.href, start.href);
  assert.equal(id, start.href);
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512', '512x512']);
  for (const icon of manifest.icons) {
    assert(new URL(icon.src, manifestUrl).pathname.startsWith(`${base}brand/`));
  }
  console.log(`${name}: built HTML metadata, scoped asset links, manifest start/scope/id passed`);
}

for (const [base, site, message] of [
  ['/', 'not a URL', /absolute HTTPS/],
  ['/', 'http://fixture.invalid/', /must use HTTPS/],
  ['/', 'https://user:pass@fixture.invalid/', /without credentials/],
  ['/', 'https://fixture.invalid/?tracking=1', /without credentials/],
  ['/', 'https://fixture.invalid/#new', /without credentials/],
  ['/doc2audio/', 'https://fixture.invalid/', /path must match/],
]) {
  process.env.DOC2AUDIO_BASE = base;
  process.env.DOC2AUDIO_SITE_URL = site;
  await assert.rejects(resolveConfig({ root, logLevel: 'silent' }, 'build'), message);
}
console.log('6 invalid deployment URL configurations rejected with actionable errors');
