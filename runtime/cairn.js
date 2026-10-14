/*
 * cairn runtime: renders a learning path and tracks progress.
 *
 * Pure helpers are exported for tests (node --test test/). The browser UI
 * starts automatically when a <script id="cairn-path" type="application/json">
 * element is present.
 */
(function (root) {
  'use strict';

  const MODES = ['read', 'do', 'explain'];
  const BIT = { read: 1, do: 2, explain: 4 };
  const MODE_LABEL = { read: 'Read', do: 'Do', explain: 'Explain' };
  const DEFAULT_NOTE_PROMPTS = ['In my words', 'What surprised me', 'Open question'];
  const TOKEN_PREFIX = 'cairn1:';
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;

  // ---------------------------------------------------------------- escaping

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------- markdown

  // Small markdown subset: headings, paragraphs, flat lists, fenced code,
  // inline code, bold, italic, links, images. Everything is escaped first.

  function safeUrl(u, allowData) {
    if (/^(https?:|mailto:|#)/i.test(u)) return u;
    if (allowData && /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(u)) return u;
    return null;
  }

  function inline(raw) {
    const codes = [];
    let s = raw.replace(/`([^`]+)`/g, (m, c) => {
      codes.push(c);
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
      const u = safeUrl(src, true);
      return u ? '<img alt="' + alt + '" src="' + u + '">' : alt;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
      const u = safeUrl(href, false);
      return u ? '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + text + '</a>' : text;
    });
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\s][^*]*?)\*/g, '<em>$1</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + esc(codes[Number(i)]) + '</code>');
  }

  function codeBlock(code) {
    return '<div class="code"><pre><code>' + esc(code) + '</code></pre>' +
      '<button type="button" class="copy">Copy</button></div>';
  }

  const BLOCK_START = /^(```|#{1,3}\s|\s*[-*]\s+|\s*\d+\.\s+|\s*\|)/;
  const TABLE_ROW = /^\s*\|.*\|\s*$/;
  const TABLE_SEP = /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/;

  // Split a pipe-table row into cells. `\|` and pipes inside inline code stay in the cell.
  function tableCells(line) {
    const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells = [];
    let cur = '';
    let code = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
      if (c === '`') code = !code;
      if (c === '|' && !code) { cells.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }

  function renderMarkdown(src) {
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++;
        out.push(codeBlock(buf.join('\n')));
        continue;
      }
      if (!line.trim()) {
        i++;
        continue;
      }
      let m = /^(#{1,3})\s+(.*)$/.exec(line);
      if (m) {
        const level = m[1].length + 2; // h3..h5 sit below the task title
        out.push('<h' + level + '>' + inline(m[2]) + '</h' + level + '>');
        i++;
        continue;
      }
      if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        const head = tableCells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && TABLE_ROW.test(lines[i])) {
          rows.push(tableCells(lines[i]));
          i++;
        }
        out.push('<div class="tablewrap"><table class="md"><thead><tr>' +
          head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + head.map((_, k) => '<td>' + inline(r[k] || '') + '</td>').join('') + '</tr>').join('') +
          '</tbody></table></div>');
        continue;
      }
      const ulRe = /^\s*[-*]\s+(.*)$/;
      const olRe = /^\s*\d+\.\s+(.*)$/;
      const listRe = ulRe.test(line) ? ulRe : olRe.test(line) ? olRe : null;
      if (listRe) {
        const tag = listRe === olRe ? 'ol' : 'ul';
        const items = [];
        while (i < lines.length && (m = listRe.exec(lines[i]))) {
          items.push('<li>' + inline(m[1]) + '</li>');
          i++;
        }
        out.push('<' + tag + '>' + items.join('') + '</' + tag + '>');
        continue;
      }
      const buf = [];
      while (i < lines.length && lines[i].trim() && (buf.length === 0 || !BLOCK_START.test(lines[i]))) {
        buf.push(lines[i]);
        i++;
      }
      out.push('<p>' + inline(buf.join(' ')) + '</p>');
    }
    return out.join('\n');
  }

  // ------------------------------------------------------------------- state

  // state = { done: { taskId: { mode: timestampMs } }, notes: { taskId: [string] } }

  function emptyState() {
    return { done: {}, notes: {} };
  }

  function cloneState(s) {
    return JSON.parse(JSON.stringify(s));
  }

  function maskOf(doneForTask) {
    let m = 0;
    if (doneForTask) {
      for (const mode of MODES) if (doneForTask[mode]) m |= BIT[mode];
    }
    return m;
  }

  function taskModes(task) {
    return task.modes || [];
  }

  function isTaskDone(task, state) {
    const d = state.done[task.id] || {};
    return taskModes(task).every((m) => d[m]);
  }

  function progress(path, state) {
    let total = 0;
    let done = 0;
    for (const t of path.tasks) {
      for (const m of taskModes(t)) {
        total++;
        if ((state.done[t.id] || {})[m]) done++;
      }
    }
    return { done, total, pct: total ? Math.round((100 * done) / total) : 0 };
  }

  // -------------------------------------------------------------------- hash

  function encodeHash(path, state) {
    const parts = [];
    for (const t of path.tasks) {
      const m = maskOf(state.done[t.id]);
      if (m) parts.push(t.id + '~' + m);
    }
    return 'v1.' + path.version + '.' + parts.join('_');
  }

  function decodeHash(hash) {
    const h = String(hash || '').replace(/^#/, '');
    const m = /^v1\.(\d+)\.(.*)$/.exec(h);
    if (!m) return null;
    const masks = {};
    for (const part of m[2].split('_')) {
      if (!part) continue;
      const p = /^([a-z0-9-]+)~(\d+)$/.exec(part);
      if (!p) return null;
      masks[p[1]] = Number(p[2]);
    }
    return { version: Number(m[1]), masks };
  }

  // Apply checkbox masks from a hash to a state. Existing timestamps are kept
  // for modes that stay checked; newly checked modes get `now`.
  function applyMasks(path, state, masks, now) {
    const next = cloneState(state);
    const known = new Set(path.tasks.map((t) => t.id));
    let unknown = 0;
    for (const id of Object.keys(masks)) if (!known.has(id)) unknown++;
    for (const t of path.tasks) {
      const mask = masks[t.id] || 0;
      const cur = next.done[t.id] || {};
      const upd = {};
      for (const mode of MODES) {
        if (mask & BIT[mode]) upd[mode] = cur[mode] || now;
      }
      if (Object.keys(upd).length) next.done[t.id] = upd;
      else delete next.done[t.id];
    }
    return { state: next, unknown };
  }

  function masksOf(path, state) {
    const masks = {};
    for (const t of path.tasks) {
      const m = maskOf(state.done[t.id]);
      if (m) masks[t.id] = m;
    }
    return masks;
  }

  function sameMasks(a, b) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => a[k] === b[k]);
  }

  // ------------------------------------------------------------------- token

  function toB64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64Url(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function pipeBytes(stream, bytes) {
    const w = stream.writable.getWriter();
    // Errors surface through the readable side; silence the writer's copies.
    w.write(bytes).catch(() => {});
    w.close().catch(() => {});
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  }

  async function encodeToken(path, state) {
    const json = JSON.stringify({ p: path.id, v: path.version, d: state.done, n: state.notes });
    const bytes = await pipeBytes(new CompressionStream('deflate-raw'), new TextEncoder().encode(json));
    return TOKEN_PREFIX + toB64Url(bytes);
  }

  // Returns { state, unknown } or throws an Error with a user-facing message.
  async function decodeToken(path, token) {
    const t = String(token || '').trim();
    if (!t.startsWith(TOKEN_PREFIX)) throw new Error('Not a cairn progress token.');
    let obj;
    try {
      const bytes = await pipeBytes(new DecompressionStream('deflate-raw'), fromB64Url(t.slice(TOKEN_PREFIX.length)));
      obj = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      throw new Error('Token is damaged or incomplete.');
    }
    if (!obj || obj.p !== path.id) throw new Error('Token is for a different path.');
    const known = new Map(path.tasks.map((t2) => [t2.id, t2]));
    const state = emptyState();
    let unknown = 0;
    for (const id of Object.keys(obj.d || {})) {
      if (!known.has(id)) {
        unknown++;
        continue;
      }
      const cur = {};
      for (const mode of MODES) {
        const ts = obj.d[id] && obj.d[id][mode];
        if (typeof ts === 'number' && ts > 0) cur[mode] = ts;
      }
      if (Object.keys(cur).length) state.done[id] = cur;
    }
    for (const id of Object.keys(obj.n || {})) {
      if (!known.has(id)) {
        unknown++;
        continue;
      }
      const arr = obj.n[id];
      if (Array.isArray(arr) && arr.some((x) => typeof x === 'string' && x)) {
        state.notes[id] = arr.map((x) => (typeof x === 'string' ? x : ''));
      }
    }
    return { state, unknown };
  }

  // --------------------------------------------------------------- snapshots

  // snap = { t: ms, name: string, manual: bool, state }
  // Automatic snapshots are thinned: newest per 5-min bucket for the last
  // hour, per hour for 24 h, per day for 7 d, per week for 52 w. Manual
  // snapshots are never pruned.
  function bucketKey(age, t) {
    if (age < HOUR) return '5m:' + Math.floor(t / (5 * MIN));
    if (age < DAY) return '1h:' + Math.floor(t / HOUR);
    if (age < WEEK) return '1d:' + Math.floor(t / DAY);
    if (age < 52 * WEEK) return '1w:' + Math.floor(t / WEEK);
    return null;
  }

  function pruneSnapshots(snaps, now) {
    const keep = new Map();
    const manual = [];
    for (const s of snaps) {
      if (s.manual) {
        manual.push(s);
        continue;
      }
      const key = bucketKey(now - s.t, s.t);
      if (key === null) continue;
      const prev = keep.get(key);
      if (!prev || s.t > prev.t) keep.set(key, s);
    }
    return manual.concat(Array.from(keep.values())).sort((a, b) => b.t - a.t);
  }

  // ---------------------------------------------------------------- ordering

  // Prereq-first ordering of `ids` and everything they depend on.
  function closure(path, ids) {
    const byId = new Map(path.tasks.map((t) => [t.id, t]));
    const seen = new Set();
    const out = [];
    function visit(id) {
      if (seen.has(id) || !byId.has(id)) return;
      seen.add(id);
      for (const p of byId.get(id).prereqs || []) visit(p);
      out.push(id);
    }
    ids.forEach(visit);
    return out;
  }

  // ------------------------------------------------------------------ routes

  function parseMinutes(est) {
    const m = /^(\d+)([mh])$/.exec(String(est || ''));
    return m ? Number(m[1]) * (m[2] === 'h' ? 60 : 1) : 0;
  }

  function formatMinutes(min) {
    if (min < 60) return min + 'm';
    const h = Math.floor(min / 60);
    const r = min % 60;
    return r ? h + 'h' + r + 'm' : h + 'h';
  }

  // The routes through a path: the recommended order plus one route per goal.
  // Each route lists its tasks prereq-first with role 'target' (the goal's own
  // task) or 'prereq'. Minutes sum the estimates; `left` excludes finished tasks.
  function routes(path, state) {
    const byId = new Map(path.tasks.map((t) => [t.id, t]));
    const st = state || emptyState();
    function make(id, title, ids, targets) {
      const items = ids.filter((x) => byId.has(x)).map((x) => ({
        id: x,
        role: !targets || targets.has(x) ? 'target' : 'prereq',
      }));
      let minutes = 0;
      let left = 0;
      for (const it of items) {
        const t = byId.get(it.id);
        const m = parseMinutes(t.estimate);
        minutes += m;
        if (!isTaskDone(t, st)) left += m;
      }
      return { id, title, items, minutes, left };
    }
    const out = [make('recommended', 'Recommended flow', path.recommended, null)];
    for (const g of path.goals || []) out.push(make(g.id, g.title, closure(path, g.tasks), new Set(g.tasks)));
    return out;
  }

  const api = {
    MODES, BIT, esc, renderMarkdown, emptyState, cloneState, maskOf, isTaskDone, progress,
    encodeHash, decodeHash, applyMasks, masksOf, sameMasks, encodeToken, decodeToken,
    pruneSnapshots, closure, parseMinutes, formatMinutes, routes,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cairn = api;

  // ---------------------------------------------------------------------- UI

  if (typeof document === 'undefined') return;

  function init(path) {
    const byId = new Map(path.tasks.map((t) => [t.id, t]));
    const skey = (k) => 'cairn:' + path.id + ':' + k;
    const app = document.getElementById('app');
    let state = emptyState();
    let snaps = [];
    let view = 'recommended';
    let answersOn = true;
    let lastSnapJson = '';
    let preLinkState = null;

    function load(key, fallback) {
      try {
        const raw = localStorage.getItem(skey(key));
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    }

    function store(key, value) {
      try {
        localStorage.setItem(skey(key), JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    }

    function toast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => { el.hidden = true; }, 4000);
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast('Copied');
    }

    function addSnapshot(name, manual) {
      const json = JSON.stringify(state);
      if (!manual && json === lastSnapJson) return;
      snaps.push({ t: Date.now(), name: name || '', manual: !!manual, state: cloneState(state) });
      snaps = pruneSnapshots(snaps, Date.now());
      lastSnapJson = json;
      if (!store('snaps', snaps)) toast('Could not save snapshot (storage full?)');
      renderSnaps();
    }

    // ------------------------------------------------------------ rendering

    function viewIds() {
      if (view === 'recommended') return path.recommended;
      const g = path.goals.find((x) => x.id === view);
      return g ? closure(path, g.tasks) : path.recommended;
    }

    function goalTaskSet() {
      const g = path.goals.find((x) => x.id === view);
      return g ? new Set(g.tasks) : null;
    }

    function noteLabels(t) {
      return t.noteprompts && t.noteprompts.length ? t.noteprompts : DEFAULT_NOTE_PROMPTS;
    }

    function callout(cls, label, text) {
      return '<div class="callout ' + cls + '"><strong>' + label + '</strong> ' + inline(text) + '</div>';
    }

    // A reveal for an answer. Hidden entirely when the page-level switch is off.
    function answerHtml(text) {
      if (!text) return '';
      return '<details class="answer"><summary>Show answer</summary><div class="answer-body">' +
        renderMarkdown(text) + '</div></details>';
    }

    function cardHtml(t, inGoal) {
      const section = (path.sections || []).find((s) => s.id === t.section);
      const parts = [];
      parts.push('<article class="task" id="t-' + t.id + '" data-id="' + t.id + '">');
      parts.push('<header><h2>' + esc(t.title) + '</h2>');
      if (section) parts.push('<span class="chip">' + esc(section.title) + '</span>');
      if (inGoal && !inGoal.has(t.id)) parts.push('<span class="chip prereq">prerequisite</span>');
      if (t.estimate) parts.push('<span class="chip est">' + esc(t.estimate) + '</span>');
      parts.push('<span class="blocked"></span></header>');
      const ans = t.answers || {};
      if (t.predict) parts.push(callout('predict', 'Predict first:', t.predict) + answerHtml(ans.predict));
      if (t.body) parts.push('<div class="body">' + renderMarkdown(t.body) + '</div>');
      if (t.elaborate) parts.push(callout('elaborate', 'While reading, ask why:', t.elaborate) + answerHtml(ans.elaborate));
      if (t.steps && t.steps.length) {
        parts.push('<ol class="steps">');
        for (const s of t.steps) {
          parts.push('<li>' + inline(s.text));
          if (s.predict) parts.push('<div class="callout predict small"><strong>Predict:</strong> ' + inline(s.predict) + '</div>' + answerHtml(s.answer));
          if (s.cmd) parts.push(codeBlock(s.cmd));
          parts.push('</li>');
        }
        parts.push('</ol>');
      }
      if (t.links && t.links.length) {
        parts.push('<ul class="links">' + t.links.map((l) =>
          '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.label) + '</a></li>').join('') + '</ul>');
      }
      if (t.modify) parts.push(callout('modify', 'Then change it:', t.modify) + answerHtml(ans.modify));
      if (t.explain) {
        parts.push(callout('explain', 'Explain without notes:', t.explain) + answerHtml(ans.explain) +
          '<p class="compare"><a href="#t-' + t.id + '" data-compare="' + t.id + '">Compare with the source above</a></p>');
      }
      parts.push('<div class="modes">' + taskModes(t).map((m) =>
        '<label><input type="checkbox" data-mode="' + m + '"> ' + MODE_LABEL[m] + '</label>').join('') + '</div>');
      const labels = noteLabels(t);
      parts.push('<details class="notes"><summary>Notes</summary>' + labels.map((l, i) =>
        '<label class="note">' + esc(l) + '<textarea data-note="' + i + '" rows="2"></textarea></label>').join('') + '</details>');
      parts.push('<button type="button" class="knownbtn" hidden>I already know this</button>');
      parts.push('</article>');
      return parts.join('');
    }

    // ------------------------------------------------------- answers (page level)

    function hasAnswers() {
      return path.tasks.some((t) => (t.answers && Object.keys(t.answers).length) ||
        (t.steps || []).some((s) => s.answer));
    }

    // The switch shows or hides the "Show answer" buttons; it never opens an answer.
    function applyAnswersMode() {
      app.dataset.answers = answersOn ? 'on' : 'off';
    }

    // Printing: with answers enabled every answer is printed open; with them
    // disabled they are not printed at all. Reveal state is restored afterwards.
    let printOpen = null;
    window.addEventListener('beforeprint', () => {
      if (printOpen) return;
      const all = Array.from(app.querySelectorAll('details.answer'));
      printOpen = all.map((d) => d.open);
      if (answersOn) all.forEach((d) => { d.open = true; });
    });
    window.addEventListener('afterprint', () => {
      if (!printOpen) return;
      app.querySelectorAll('details.answer').forEach((d, i) => { d.open = !!printOpen[i]; });
      printOpen = null;
    });

    // ---------------------------------------------------------------- routes

    function renderRoutes() {
      const rs = routes(path, state);
      const cols = rs.map((r, i) => ({ r, label: i === 0 ? 'Rec' : 'G' + i }));
      const rec = rs[0];
      const head = '<tr><th scope="col">Task</th><th scope="col">Time</th>' + cols.map((c) =>
        '<th scope="col"><button type="button" data-route="' + esc(c.r.id) + '" title="' + esc(c.r.title) + '">' +
        esc(c.label) + '</button></th>').join('') + '</tr>';
      const rows = rec.items.map((it) => {
        const t = byId.get(it.id);
        const done = isTaskDone(t, state);
        const cells = cols.map((c) => {
          const m = c.r.items.find((x) => x.id === it.id);
          const mark = !m ? '' : m.role === 'target' ? '\u25cf' : '\u25cb';
          return '<td class="' + (m ? m.role : '') + '">' + mark + '</td>';
        }).join('');
        return '<tr' + (done ? ' class="done"' : '') + '><td><a href="#t-' + esc(t.id) + '" data-goto="' + esc(t.id) + '">' +
          esc(t.title) + '</a>' + (done ? ' <span class="muted">\u2713</span>' : '') + '</td><td>' +
          esc(t.estimate || '') + '</td>' + cells + '</tr>';
      }).join('');
      const legend = cols.map((c) => '<li><strong>' + esc(c.label) + '</strong> ' + esc(c.r.title) + ': ' +
        formatMinutes(c.r.minutes) + (c.r.left !== c.r.minutes ? ' (' + formatMinutes(c.r.left) + ' left)' : '') + '</li>').join('');
      document.getElementById('routes-body').innerHTML =
        '<div class="tablewrap"><table class="routes">' + head + rows + '</table></div>' +
        '<p class="muted">\u25cf is a task the route is for; \u25cb is a prerequisite pulled in. Click a column to view that route.</p>' +
        '<ul class="legend">' + legend + '</ul>';
    }

    // A heading before the first task of each run of tasks in the same section,
    // with the run's task count and total estimate.
    function sectionHeadHtml(ids, i) {
      const t = byId.get(ids[i]);
      const sec = (path.sections || []).find((s) => s.id === t.section);
      if (!sec || (i > 0 && byId.get(ids[i - 1]).section === t.section)) return '';
      let n = 0;
      let min = 0;
      for (let j = i; j < ids.length && byId.get(ids[j]).section === t.section; j++) {
        n++;
        min += parseMinutes(byId.get(ids[j]).estimate);
      }
      return '<div class="sectionhead" role="heading" aria-level="2">' + esc(sec.title) +
        ' <span class="muted">' + n + (n === 1 ? ' task' : ' tasks') + (min ? ' \u00b7 ' + formatMinutes(min) : '') + '</span></div>';
    }

    function updateProgress() {
      const p = progress(path, state);
      document.getElementById('bar').style.width = p.pct + '%';
      document.getElementById('pct').textContent = p.done + ' / ' + p.total + ' (' + p.pct + '%)';
    }

    function refresh() {
      updateProgress();
      renderRoutes();
      const goalSet = goalTaskSet();
      document.querySelectorAll('article.task').forEach((card) => {
        const t = byId.get(card.dataset.id);
        const d = state.done[t.id] || {};
        card.classList.toggle('done', isTaskDone(t, state));
        card.querySelectorAll('input[data-mode]').forEach((cb) => { cb.checked = !!d[cb.dataset.mode]; });
        const open = (t.prereqs || []).filter((id) => byId.has(id) && !isTaskDone(byId.get(id), state));
        const blocked = card.querySelector('.blocked');
        blocked.innerHTML = open.length
          ? 'Blocked by: ' + open.map((id) => '<a href="#t-' + id + '">' + esc(byId.get(id).title) + '</a>').join(', ')
          : '';
        const btn = card.querySelector('.knownbtn');
        btn.hidden = !(goalSet && !goalSet.has(t.id) && !isTaskDone(t, state));
      });
      history.replaceState(null, '', '#' + encodeHash(path, state));
      const tf = document.getElementById('token');
      if (document.activeElement !== tf) {
        encodeToken(path, state).then((tok) => { if (document.activeElement !== tf) tf.value = tok; });
      }
    }

    function renderAll() {
      const ids = viewIds();
      const inGoal = goalTaskSet();
      const g = path.goals.find((x) => x.id === view);
      document.getElementById('goalinfo').innerHTML = g
        ? '<strong>' + esc(g.title) + '</strong>: ' + inline(g.description || '')
        : 'Recommended order for general learning.';
      const list = document.getElementById('tasks');
      list.innerHTML = ids.map((id, i) => sectionHeadHtml(ids, i) + cardHtml(byId.get(id), inGoal)).join('');
      list.querySelectorAll('article.task').forEach((card) => {
        const t = byId.get(card.dataset.id);
        const notes = state.notes[t.id] || [];
        card.querySelectorAll('textarea[data-note]').forEach((ta) => { ta.value = notes[Number(ta.dataset.note)] || ''; });
        if (notes.some(Boolean)) card.querySelector('details.notes').open = true;
      });
      applyAnswersMode();
      refresh();
      renderSnaps();
    }

    function renderSnaps() {
      const el = document.getElementById('snaplist');
      if (!snaps.length) {
        el.innerHTML = '<li class="muted">No snapshots yet.</li>';
        return;
      }
      el.innerHTML = snaps.map((s, i) => {
        const pct = progress(path, s.state).pct;
        return '<li>' + esc(new Date(s.t).toLocaleString()) + (s.name ? ' · ' + esc(s.name) : '') +
          (s.manual ? ' · saved' : '') + ' · ' + pct + '% <button type="button" data-restore="' + i + '">Restore</button></li>';
      }).join('');
    }

    function commit() {
      store('state', state);
      refresh();
    }

    // -------------------------------------------------------------- events

    app.addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-mode]');
      if (!cb) return;
      const id = cb.closest('article').dataset.id;
      const cur = state.done[id] || {};
      if (cb.checked) cur[cb.dataset.mode] = Date.now();
      else delete cur[cb.dataset.mode];
      if (Object.keys(cur).length) state.done[id] = cur;
      else delete state.done[id];
      commit();
    });

    app.addEventListener('input', (e) => {
      const ta = e.target.closest('textarea[data-note]');
      if (!ta) return;
      const id = ta.closest('article').dataset.id;
      const arr = state.notes[id] || [];
      arr[Number(ta.dataset.note)] = ta.value;
      for (let i = 0; i < arr.length; i++) if (typeof arr[i] !== 'string') arr[i] = '';
      if (arr.some(Boolean)) state.notes[id] = arr;
      else delete state.notes[id];
      store('state', state);
    });

    app.addEventListener('click', (e) => {
      const copy = e.target.closest('button.copy');
      if (copy) {
        copyText(copy.parentElement.querySelector('pre').textContent);
        return;
      }
      const cmp = e.target.closest('a[data-compare]');
      if (cmp) {
        e.preventDefault();
        const body = document.querySelector('#t-' + cmp.dataset.compare + ' .body, #t-' + cmp.dataset.compare + ' .steps');
        if (body) body.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const known = e.target.closest('button.knownbtn');
      if (known) {
        const t = byId.get(known.closest('article').dataset.id);
        const q = t.explain ? 'Can you answer this without notes?\n\n' + t.explain : 'Mark "' + t.title + '" as already known?';
        if (window.confirm(q)) {
          const now = Date.now();
          state.done[t.id] = Object.assign({}, state.done[t.id]);
          for (const m of taskModes(t)) state.done[t.id][m] = state.done[t.id][m] || now;
          commit();
        }
      }
    });

    function setView(v) {
      view = v;
      document.getElementById('view').value = v;
      store('view', view);
      renderAll();
    }

    document.getElementById('view').addEventListener('change', (e) => setView(e.target.value));

    document.getElementById('answers').addEventListener('change', (e) => {
      answersOn = e.target.checked;
      store('answers', answersOn ? 'on' : 'off');
      applyAnswersMode();
    });

    document.getElementById('routes-body').addEventListener('click', (e) => {
      const col = e.target.closest('button[data-route]');
      if (col) {
        setView(col.dataset.route);
        return;
      }
      const go = e.target.closest('a[data-goto]');
      if (go) {
        e.preventDefault();
        if (!document.getElementById('t-' + go.dataset.goto)) setView('recommended');
        const el = document.getElementById('t-' + go.dataset.goto);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    document.getElementById('copytoken').addEventListener('click', () => copyText(document.getElementById('token').value));
    document.getElementById('copylink').addEventListener('click', () => copyText(location.href));
    document.getElementById('savesnap').addEventListener('click', () => {
      const name = window.prompt('Snapshot name (optional):', '');
      if (name === null) return;
      addSnapshot(name, true);
      toast('Snapshot saved');
    });

    document.getElementById('restore').addEventListener('click', async () => {
      const tf = document.getElementById('token');
      try {
        const r = await decodeToken(path, tf.value);
        addSnapshot('before restore', false);
        state = r.state;
        commit();
        renderAll();
        toast('Progress restored' + (r.unknown ? ' (' + r.unknown + ' unknown item(s) ignored)' : ''));
      } catch (err) {
        toast(err.message);
      }
    });

    document.getElementById('reset').addEventListener('click', () => {
      if (!window.confirm('Clear all progress and notes? A snapshot is saved first.')) return;
      addSnapshot('before reset', true);
      state = emptyState();
      commit();
      renderAll();
    });

    document.getElementById('snaplist').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-restore]');
      if (!btn) return;
      const s = snaps[Number(btn.dataset.restore)];
      if (!s) return;
      addSnapshot('before restore', false);
      state = cloneState(s.state);
      commit();
      renderAll();
      toast('Snapshot restored');
    });

    document.getElementById('banner-revert').addEventListener('click', () => {
      state = preLinkState || emptyState();
      document.getElementById('banner').hidden = true;
      commit();
      renderAll();
    });
    document.getElementById('banner-keep').addEventListener('click', () => {
      document.getElementById('banner').hidden = true;
    });

    // ---------------------------------------------------------------- boot

    document.title = path.title;
    document.getElementById('title').textContent = path.title;
    document.getElementById('intro').innerHTML = renderMarkdown(path.intro || '');
    document.getElementById('sources').innerHTML = (path.sources || []).map((s) =>
      '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.label) + '</a></li>').join('');
    const sel = document.getElementById('view');
    sel.innerHTML = '<option value="recommended">Recommended flow</option>' +
      path.goals.map((g) => '<option value="' + esc(g.id) + '">Goal: ' + esc(g.title) + '</option>').join('');

    state = load('state', emptyState());
    snaps = load('snaps', []);
    lastSnapJson = snaps.length ? JSON.stringify(snaps[0].state) : '';
    view = load('view', 'recommended');
    if (view !== 'recommended' && !path.goals.some((g) => g.id === view)) view = 'recommended';
    sel.value = view;
    answersOn = load('answers', 'on') !== 'off';
    document.getElementById('answers').checked = answersOn;
    document.getElementById('answers-control').hidden = !hasAnswers();

    const hashed = decodeHash(location.hash);
    if (hashed) {
      const saved = masksOf(path, state);
      if (!sameMasks(hashed.masks, saved)) {
        const r = applyMasks(path, state, hashed.masks, Date.now());
        preLinkState = cloneState(state);
        addSnapshot('before loading link', false);
        state = r.state;
        store('state', state);
        document.getElementById('banner').hidden = false;
        if (r.unknown) toast(r.unknown + ' item(s) in the link are not in this version of the path.');
      }
    }
    renderAll();
    addSnapshot('', false);
    setInterval(() => addSnapshot('', false), 5 * MIN);
  }

  function start() {
    const el = document.getElementById('cairn-path');
    if (el) init(JSON.parse(el.textContent));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
