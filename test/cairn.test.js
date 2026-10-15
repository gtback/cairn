'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../runtime/cairn.js');

const trail = {
  id: 'demo',
  version: 3,
  tasks: [
    { id: 'a', title: 'A', modes: ['read', 'explain'], prereqs: [] },
    { id: 'b', title: 'B', modes: ['do'], prereqs: ['a'] },
    { id: 'c', title: 'C', modes: ['do', 'explain'], prereqs: ['b'] },
    { id: 'd', title: 'D', modes: ['read'], prereqs: ['a'] },
  ],
};

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);

test('hash round-trips checkbox masks', () => {
  const state = C.emptyState();
  state.done.a = { read: 1, explain: 2 };
  state.done.c = { do: 3 };
  const hash = C.encodeHash(trail, state);
  assert.equal(hash, 'v1.3.a~5_c~2');
  const decoded = C.decodeHash('#' + hash);
  assert.deepEqual(decoded, { version: 3, masks: { a: 5, c: 2 } });
});

test('hash with no progress and malformed hashes', () => {
  assert.equal(C.encodeHash(trail, C.emptyState()), 'v1.3.');
  assert.deepEqual(C.decodeHash('v1.3.'), { version: 3, masks: {} });
  assert.equal(C.decodeHash(''), null);
  assert.equal(C.decodeHash('#nonsense'), null);
  assert.equal(C.decodeHash('v1.3.a~x'), null);
});

test('applyMasks keeps timestamps, stamps new checks, drops unchecked, counts unknown ids', () => {
  const state = C.emptyState();
  state.done.a = { read: 111, explain: 222 };
  const { state: next, unknown } = C.applyMasks(trail, state, { a: 1, b: 2, zzz: 1 }, NOW);
  assert.deepEqual(next.done.a, { read: 111 });
  assert.deepEqual(next.done.b, { do: NOW });
  assert.equal(unknown, 1);
  assert.ok(C.sameMasks(C.masksOf(trail, next), { a: 1, b: 2 }));
  assert.ok(!C.sameMasks({ a: 1 }, { a: 1, b: 2 }));
});

test('token round-trips done timestamps and notes, including unicode', async () => {
  const state = C.emptyState();
  state.done.a = { read: 1000, explain: 2000 };
  state.done.c = { do: 3000 };
  state.notes.a = ['in my words: café ☕ 日本語', '', 'q?'];
  const token = await C.encodeToken(trail, state);
  assert.ok(token.startsWith('cairn1:'));
  assert.match(token, /^cairn1:[A-Za-z0-9_-]+$/);
  const { state: back, unknown } = await C.decodeToken(trail, token);
  assert.equal(unknown, 0);
  assert.deepEqual(back, state);
});

test('token ignores unknown ids and rejects other trails and garbage', async () => {
  const other = Object.assign({}, trail, { tasks: trail.tasks.concat([{ id: 'z', title: 'Z', modes: ['read'] }]) });
  const state = C.emptyState();
  state.done.z = { read: 5 };
  state.done.a = { read: 6 };
  state.notes.z = ['x'];
  const token = await C.encodeToken(other, state);
  const { state: back, unknown } = await C.decodeToken(trail, token);
  assert.deepEqual(back.done, { a: { read: 6 } });
  assert.deepEqual(back.notes, {});
  assert.equal(unknown, 2);

  await assert.rejects(C.decodeToken({ id: 'different', version: 1, tasks: [] }, token), /different trail/);
  await assert.rejects(C.decodeToken(trail, 'hello'), /Not a cairn/);
  await assert.rejects(C.decodeToken(trail, 'cairn1:AAAA'), /damaged/);
});

test('progress counts checked modes', () => {
  const state = C.emptyState();
  state.done.a = { read: 1 };
  state.done.b = { do: 1 };
  assert.deepEqual(C.progress(trail, state), { done: 2, total: 6, pct: 33 });
  assert.ok(C.isTaskDone(trail.tasks[1], state));
  assert.ok(!C.isTaskDone(trail.tasks[0], state));
});

test('closure orders prerequisites first and de-duplicates', () => {
  assert.deepEqual(C.closure(trail, ['c']), ['a', 'b', 'c']);
  assert.deepEqual(C.closure(trail, ['c', 'd']), ['a', 'b', 'c', 'd']);
  assert.deepEqual(C.closure(trail, ['d', 'c']), ['a', 'd', 'b', 'c']);
  assert.deepEqual(C.closure(trail, ['missing']), []);
});

test('snapshot pruning thins automatic snapshots over a year and keeps manual ones', () => {
  const snaps = [];
  // One automatic snapshot every 5 minutes for 400 days.
  for (let t = NOW; t > NOW - 400 * 24 * 3600 * 1000; t -= 5 * 60 * 1000) {
    snaps.push({ t, name: '', manual: false, state: {} });
  }
  const ancient = { t: NOW - 500 * 24 * 3600 * 1000, name: 'keep me', manual: true, state: {} };
  snaps.push(ancient);
  const pruned = C.pruneSnapshots(snaps, NOW);
  const auto = pruned.filter((s) => !s.manual);
  assert.ok(auto.length <= 12 + 24 + 7 + 52 + 4, 'got ' + auto.length);
  assert.ok(auto.length >= 12 + 24 + 6 + 50, 'got ' + auto.length);
  assert.ok(pruned.includes(ancient));
  assert.ok(auto.every((s) => NOW - s.t < 52 * 7 * 24 * 3600 * 1000));
  assert.equal(pruned[0].t, NOW);
  for (let i = 1; i < pruned.length; i++) assert.ok(pruned[i - 1].t >= pruned[i].t);
  // Recent history is dense: at least 10 snapshots in the last hour.
  assert.ok(auto.filter((s) => NOW - s.t < 3600 * 1000).length >= 10);
});

test('pruning is idempotent', () => {
  const snaps = [];
  for (let t = NOW; t > NOW - 30 * 24 * 3600 * 1000; t -= 5 * 60 * 1000) snaps.push({ t, manual: false, state: {} });
  const once = C.pruneSnapshots(snaps, NOW);
  const twice = C.pruneSnapshots(once, NOW);
  assert.deepEqual(twice.map((s) => s.t), once.map((s) => s.t));
});

test('markdown: block structure', () => {
  const html = C.renderMarkdown('# Title\n\nSome *emphasis* and **bold** and `code`.\n\n- one\n- two\n\n1. first\n2. second\n');
  assert.match(html, /<h3>Title<\/h3>/);
  assert.match(html, /<p>Some <em>emphasis<\/em> and <strong>bold<\/strong> and <code>code<\/code>\.<\/p>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
});

test('markdown: fenced code gets a copy button and keeps markup literal', () => {
  const html = C.renderMarkdown('```\necho "<b>hi</b>" && *not italic*\n```');
  assert.match(html, /class="code"/);
  assert.match(html, /<button type="button" class="copy">Copy<\/button>/);
  assert.match(html, /&lt;b&gt;hi&lt;\/b&gt;/);
  assert.ok(!html.includes('<em>'));
});

test('markdown: escapes html and blocks unsafe urls', () => {
  const html = C.renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://example.com/a?b=1&c=2) ![i](data:text/html;base64,AAAA)');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript'));
  assert.match(html, /href="https:\/\/example\.com\/a\?b=1&amp;c=2"/);
  assert.ok(!html.includes('<img'));
});

test('markdown: data-uri images are allowed, inline code protects markup', () => {
  const html = C.renderMarkdown('![alt text](data:image/png;base64,iVBORw0KGgo=) and `**not bold**`');
  assert.match(html, /<img alt="alt text" src="data:image\/png;base64,iVBORw0KGgo=">/);
  assert.match(html, /<code>\*\*not bold\*\*<\/code>/);
});

test('minutes parse and format', () => {
  assert.equal(C.parseMinutes('15m'), 15);
  assert.equal(C.parseMinutes('2h'), 120);
  assert.equal(C.parseMinutes(undefined), 0);
  assert.equal(C.parseMinutes('soon'), 0);
  assert.equal(C.formatMinutes(45), '45m');
  assert.equal(C.formatMinutes(120), '2h');
  assert.equal(C.formatMinutes(125), '2h5m');
});

test('routes: recommended plus one route per goal, prereqs flagged, time left excludes done', () => {
  const p = {
    id: 'r', version: 1,
    tasks: [
      { id: 'a', title: 'A', modes: ['do'], estimate: '10m' },
      { id: 'b', title: 'B', modes: ['do'], estimate: '20m', prereqs: ['a'] },
      { id: 'c', title: 'C', modes: ['do'], estimate: '1h', prereqs: ['b'] },
      { id: 'd', title: 'D', modes: ['do'], estimate: '5m' },
    ],
    goals: [{ id: 'g1', title: 'Goal one', tasks: ['c'] }, { id: 'g2', title: 'Goal two', tasks: ['d'] }],
    recommended: ['a', 'b', 'c', 'd'],
  };
  const state = C.emptyState();
  state.done.a = { do: 1 };
  const rs = C.routes(p, state);
  assert.deepEqual(rs.map((r) => r.id), ['recommended', 'g1', 'g2']);
  assert.equal(rs[0].minutes, 95);
  assert.equal(rs[0].left, 85);
  assert.deepEqual(rs[1].items, [
    { id: 'a', role: 'prereq' }, { id: 'b', role: 'prereq' }, { id: 'c', role: 'target' },
  ]);
  assert.equal(rs[1].minutes, 90);
  assert.equal(rs[1].left, 80);
  assert.deepEqual(rs[2].items, [{ id: 'd', role: 'target' }]);
  assert.ok(rs[0].items.every((i) => i.role === 'target'));
});

test('markdown: pipe tables render with inline markup, escaped pipes and code pipes', () => {
  const html = C.renderMarkdown('Before\n\n| A | **B** |\n|---|:---:|\n| `x | y` | a \\| b |\n| <i>raw</i> |\n\nAfter');
  assert.match(html, /<table class="md"><thead><tr><th>A<\/th><th><strong>B<\/strong><\/th><\/tr><\/thead>/);
  assert.match(html, /<td><code>x \| y<\/code><\/td><td>a \| b<\/td>/);
  assert.match(html, /<td>&lt;i&gt;raw&lt;\/i&gt;<\/td><td><\/td>/);
  assert.match(html, /<p>Before<\/p>/);
  assert.match(html, /<p>After<\/p>/);
});

test('markdown: a pipe line without a separator row is just a paragraph', () => {
  const html = C.renderMarkdown('| not | a table |');
  assert.ok(!html.includes('<table'));
});
