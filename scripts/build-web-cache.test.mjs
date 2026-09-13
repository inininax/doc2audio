import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { serviceWorkerSource } from './build-web-cache.mjs';

const scope = 'https://fixture.invalid/app/';
const files = ['index.html', 'app.js', 'a.wasm', 'b.wasm', 'c.wasm', 'font.woff'];
const prefix = 'doc2audio-shell:%2Fapp%2F:';
const url = (path) => new URL(path, scope).href;

function worker(revision, data, failBatch = Infinity) {
  const listeners = {};
  let batches = 0;
  const notifications = [];
  const cacheApi = {
    keys: async () => [...data.keys()],
    delete: async (name) => data.delete(name),
    open: async (name) => {
      if (!data.has(name)) data.set(name, new Map());
      return {
        addAll: async (requests) => {
          if (++batches === failBatch) throw new Error('Injected failed static resource');
          for (const request of requests) data.get(name).set(request.url, `fixture:${request.url}`);
        },
        match: async (request) => data.get(name).get(String(request)),
      };
    },
  };
  vm.runInNewContext(serviceWorkerSource(files, revision), {
    URL, Request, caches: cacheApi,
    fetch: async () => { throw new Error('Unexpected network fallback'); },
    self: {
      registration: { scope },
      addEventListener: (name, callback) => { listeners[name] = callback; },
      clients: {
        claim: async () => { notifications.push('claimed'); },
        matchAll: async () => [{ postMessage: (message) => notifications.push(message.type) }],
      },
    },
  });
  async function event(name) {
    let pending;
    listeners[name]({ waitUntil: (promise) => { pending = promise; } });
    await pending;
  }
  async function request(path, mode = 'cors', method = 'GET') {
    let response;
    listeners.fetch({ request: { url: path, mode, method }, respondWith: (promise) => { response = promise; } });
    return response;
  }
  return { event, request, notifications, batches: () => batches };
}

test('failed new installations release every partial cache across different revisions', async () => {
  const data = new Map([[`${prefix}active`, new Map([[url('index.html'), 'working offline screen']])]]);
  for (const revision of ['failed-1', 'failed-2']) {
    await assert.rejects(worker(revision, data, 2).event('install'), /Injected failed/);
    assert.deepEqual([...data.keys()], [`${prefix}active`]);
    assert.equal(data.get(`${prefix}active`).get(url('index.html')), 'working offline screen');
  }
});

test('a complete existing revision remains byte-for-byte intact without refetching', async () => {
  const cached = new Map(files.map((file) => [url(file), `existing:${file}`]));
  const before = [...cached];
  const data = new Map([[`${prefix}same`, cached]]);
  const runtime = worker('same', data, 1);
  await runtime.event('install');
  assert.equal(runtime.batches(), 0);
  assert.deepEqual([...cached], before);
});

test('a failed retry never deletes a pre-existing cache that may still have an active owner', async () => {
  const cached = new Map([[url('index.html'), 'existing offline screen']]);
  const data = new Map([[`${prefix}partial-existing`, cached]]);
  await assert.rejects(worker('partial-existing', data, 1).event('install'), /Injected failed/);
  assert.equal(data.get(`${prefix}partial-existing`), cached);
  assert.equal(cached.get(url('index.html')), 'existing offline screen');
});

test('successful installation waits for activation before clearing the previous cache', async () => {
  const unrelated = 'doc2audio-shell-/another-app/-active';
  const data = new Map([[`${prefix}old`, new Map()], [unrelated, new Map()]]);
  const runtime = worker('new', data);
  await runtime.event('install');
  assert.equal(data.get(`${prefix}new`).size, files.length);
  assert.ok(data.has(`${prefix}old`));
  assert.deepEqual(runtime.notifications, []);
  await runtime.event('activate');
  assert.ok(!data.has(`${prefix}old`));
  assert.ok(data.has(unrelated));
  assert.deepEqual(runtime.notifications, ['claimed', 'offline-ready']);
});

test('activation only removes this exact scope, including legacy cache names', async () => {
  const ownLegacy = 'doc2audio-shell-/app/-0123456789abcdef';
  const childLegacy = 'doc2audio-shell-/app/-nested/-0123456789abcdef';
  const childCurrent = 'doc2audio-shell:%2Fapp%2F-nested%2F:0123456789abcdef';
  const unknownLegacy = 'doc2audio-shell-/app/-unknown-owner';
  const protectedNames = [childLegacy, childCurrent, unknownLegacy];
  const data = new Map([ownLegacy, ...protectedNames].map(name => [name, new Map([[url('index.html'), name]])]));
  const runtime = worker('new', data);
  await runtime.event('install');
  await runtime.event('activate');
  assert.equal(data.has(ownLegacy), false);
  for (const name of protectedNames) {
    assert.ok(data.has(name), `Unrelated cache was deleted: ${name}`);
    assert.equal(data.get(name).get(url('index.html')), name);
  }
});

test('offline routes use the scoped shell and leave model/API/mutation traffic alone', async () => {
  const runtime = worker('fetch', new Map());
  await runtime.event('install');
  assert.equal(await runtime.request(url('report'), 'navigate'), `fixture:${url('index.html')}`);
  assert.equal(await runtime.request(url('a.wasm')), `fixture:${url('a.wasm')}`);
  for (const [path, mode, method] of [
    [url('api/jobs'), 'cors', 'GET'],
    [url('app.js'), 'cors', 'POST'],
    ['https://huggingface.co/model/resolve/revision/model.onnx', 'cors', 'GET'],
    ['https://fixture.invalid/other/index.html', 'navigate', 'GET'],
  ]) assert.equal(await runtime.request(path, mode, method), undefined);
});
