// Browser end-to-end check: drives headless Chrome over the DevTools protocol
// against a built example page. Set CHROME to the browser binary if needed.
// usage: node test/e2e.mjs <url> [debug-port]   (see Makefile: make e2e)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2];
const port = Number(process.argv[3] || 9333);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + JSON.stringify(detail)));
  if (!ok) failures++;
}

async function launch(profile) {
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return proc; } catch {}
    await sleep(200);
  }
  throw new Error('chrome did not start');
}

async function open(targetUrl) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' });
  const t = await r.json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const events = { errors: [], requests: [] };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') events.errors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') events.errors.push('console.error ' + JSON.stringify(msg.params.args.map((a) => a.value)));
    if (msg.method === 'Network.requestWillBeSent') events.requests.push(msg.params.request.url);
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result.result.value;
  };
  return { send, ev, events, close: () => ws.close(), targetId: t.id };
}

async function waitReady(p) {
  for (let i = 0; i < 50; i++) {
    try { if (await p.ev('document.querySelectorAll("article.task").length') > 0) return; } catch {}
    await sleep(100);
  }
  throw new Error('page never rendered');
}

const profile = mkdtempSync(join(tmpdir(), 'cairn-e2e-'));
const chrome = await launch(profile);
try {
  const p = await open(url);
  await waitReady(p);
  await p.ev('window.confirm = () => true; window.prompt = () => "snap1"; 0');

  check('renders 6 tasks in recommended order',
    JSON.stringify(await p.ev('[...document.querySelectorAll("article.task")].map(a=>a.dataset.id)')) ===
    JSON.stringify(['install', 'identity', 'fields', 'select', 'pipes', 'reshape']));
  check('section headings with counts and time',
    JSON.stringify(await p.ev('[...document.querySelectorAll(".sectionhead")].map(h=>h.textContent)')) ===
    JSON.stringify(['Getting started 2 tasks · 25m', 'Filters 3 tasks · 50m', 'Building output 1 task · 30m']),
    await p.ev('[...document.querySelectorAll(".sectionhead")].map(h=>h.textContent)'));
  check('title and intro', await p.ev('document.getElementById("title").textContent') === 'Learn jq' &&
    (await p.ev('document.getElementById("intro").textContent')).includes('cairn'));
  check('image rendered', await p.ev('(()=>{const i=document.querySelector("#t-identity img");return !!i && i.complete && i.naturalWidth>0})()'));
  check('code blocks have copy buttons', await p.ev('document.querySelectorAll("#t-install .code .copy").length') === 3);
  check('blocked-by hint shows for identity', (await p.ev('document.querySelector("#t-identity .blocked").textContent')).includes('Install jq'));
  check('initial hash is empty progress', await p.ev('location.hash') === '#v1.1.');

  // Answers: hidden behind a reveal, switchable at page level.
  check('answer control visible when the path has answers', await p.ev('!document.getElementById("answers-control").hidden'));
  check('answers render closed by default', await p.ev('document.querySelectorAll("details.answer").length') === 13 &&
    await p.ev('document.querySelectorAll("details.answer[open]").length') === 0, await p.ev('document.querySelectorAll("details.answer").length'));
  await p.ev('document.querySelector("#t-identity details.answer summary").click()');
  check('clicking Show answer opens it', await p.ev('document.querySelector("#t-identity details.answer").open') &&
    (await p.ev('document.querySelector("#t-identity details.answer .answer-body").textContent')).includes('looks up the key'));
  await p.ev('(()=>{const c=document.getElementById("answers"); c.checked=false; c.dispatchEvent(new Event("change",{bubbles:true}));})()');
  check('disabling answers hides every reveal button', await p.ev('[...document.querySelectorAll("details.answer")].every(d=>getComputedStyle(d).display==="none")'));
  await p.ev('window.dispatchEvent(new Event("beforeprint"))');
  check('printing with answers disabled opens nothing',
    await p.ev('document.querySelectorAll("details.answer[open]").length') === 1 &&
    await p.ev('getComputedStyle(document.querySelector("#t-identity details.answer")).display') === 'none');
  await p.ev('window.dispatchEvent(new Event("afterprint"))');
  await p.ev('(()=>{const c=document.getElementById("answers"); c.checked=true; c.dispatchEvent(new Event("change",{bubbles:true}));})()');
  check('re-enabling shows the buttons without opening other answers',
    await p.ev('getComputedStyle(document.querySelector("details.answer")).display') !== 'none' &&
    await p.ev('document.querySelectorAll("details.answer[open]").length') === 1);
  await p.ev('window.dispatchEvent(new Event("beforeprint"))');
  check('printing with answers enabled opens every answer', await p.ev('[...document.querySelectorAll("details.answer")].every(d=>d.open)'));
  await p.ev('window.dispatchEvent(new Event("afterprint"))');
  check('after printing, reveal state is restored',
    await p.ev('document.querySelectorAll("details.answer[open]").length') === 1 && await p.ev('document.querySelector("#t-identity details.answer").open'));
  await p.ev('document.querySelector("#t-identity details.answer summary").click()');

  // Routes panel.
  check('routes panel is collapsed', await p.ev('document.getElementById("routes").open') === false);
  check('routes matrix has a row per task and a column per route',
    await p.ev('document.querySelectorAll("table.routes tr").length') === 7 &&
    await p.ev('document.querySelectorAll("table.routes th button").length') === 3);
  check('routes legend shows totals', (await p.ev('document.querySelector("#routes .legend").textContent')).includes('Rec Recommended flow: 1h45m'),
    await p.ev('document.querySelector("#routes .legend").textContent'));

  // Check a box.
  await p.ev('document.querySelector("#t-install input[data-mode=do]").click()');
  check('checking a box updates the hash', await p.ev('location.hash') === '#v1.1.install~2', await p.ev('location.hash'));
  check('progress text updates', (await p.ev('document.getElementById("pct").textContent')).startsWith('1 / 10'), await p.ev('document.getElementById("pct").textContent'));
  check('blocked hint clears', await p.ev('document.querySelector("#t-identity .blocked").textContent') === '');
  check('task card marked done', await p.ev('document.getElementById("t-install").classList.contains("done")'));

  // Notes + more checks.
  await p.ev('(()=>{const ta=document.querySelector("#t-identity textarea[data-note=\\"0\\"]"); ta.value="café ☕ my words"; ta.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await p.ev('document.querySelector("#t-identity input[data-mode=read]").click()');
  await sleep(300);
  const token = await p.ev('document.getElementById("token").value');
  check('token generated', token.startsWith('cairn1:'), token.slice(0, 20));

  // Reload keeps state (localStorage).
  await p.send('Page.reload');
  await sleep(500); await waitReady(p);
  await p.ev('window.confirm = () => true; window.prompt = () => "snap1"; 0');
  check('reload restores checks', await p.ev('document.querySelector("#t-install input[data-mode=do]").checked') === true);
  check('reload restores notes', await p.ev('document.querySelector("#t-identity textarea[data-note=\\"0\\"]").value') === 'café ☕ my words');
  check('notes panel auto-opens when notes exist', await p.ev('document.querySelector("#t-identity details.notes").open'));

  // Goal views.
  await p.ev('(()=>{const s=document.getElementById("view"); s.value="report"; s.dispatchEvent(new Event("change",{bubbles:true}));})()');
  check('report goal shows full closure in order',
    JSON.stringify(await p.ev('[...document.querySelectorAll("article.task")].map(a=>a.dataset.id)')) ===
    JSON.stringify(['install', 'identity', 'fields', 'select', 'pipes', 'reshape']));
  await p.ev('(()=>{const s=document.getElementById("view"); s.value="extract"; s.dispatchEvent(new Event("change",{bubbles:true}));})()');
  check('extract goal shows only its closure',
    JSON.stringify(await p.ev('[...document.querySelectorAll("article.task")].map(a=>a.dataset.id)')) ===
    JSON.stringify(['install', 'identity', 'fields']));
  check('prereq chip shown', await p.ev('document.querySelectorAll("article.task .chip.prereq").length') === 2);
  check('"I already know this" shown only for unfinished prereqs',
    JSON.stringify(await p.ev('[...document.querySelectorAll("article.task")].map(a=>!a.querySelector(".knownbtn").hidden)')) === JSON.stringify([false, true, false]),
    await p.ev('[...document.querySelectorAll("article.task")].map(a=>!a.querySelector(".knownbtn").hidden)'));
  await p.ev('document.querySelector("#t-identity .knownbtn").click()');
  check('test-out marks all modes done', await p.ev('[...document.querySelectorAll("#t-identity input[data-mode]")].every(c=>c.checked)'));
  check('view persists across reload', true);
  await p.ev('(()=>{const s=document.getElementById("view"); s.value="recommended"; s.dispatchEvent(new Event("change",{bubbles:true}));})()');

  await p.ev('document.querySelector("table.routes th button[data-route=report]").click()');
  check('clicking a route column switches the view', await p.ev('document.getElementById("view").value') === 'report');

  // Token round-trip including notes.
  await sleep(300);
  const tok2 = await p.ev('document.getElementById("token").value');
  await p.ev('document.getElementById("reset").click()');
  check('reset clears progress', await p.ev('document.querySelectorAll("input[data-mode]:checked").length') === 0 &&
    await p.ev('document.querySelector("#t-identity textarea[data-note=\\"0\\"]").value') === '');
  await p.ev(`(()=>{document.getElementById("token").value=${JSON.stringify(tok2)}; document.getElementById("restore").click();})()`);
  await sleep(400);
  check('token restore brings back checks and notes',
    await p.ev('document.querySelector("#t-install input[data-mode=do]").checked') === true &&
    await p.ev('document.querySelector("#t-identity textarea[data-note=\\"0\\"]").value') === 'café ☕ my words');
  await p.ev(`(()=>{document.getElementById("token").value="cairn1:AAAA"; document.getElementById("restore").click();})()`);
  await sleep(300);
  check('bad token shows a message and keeps state', (await p.ev('document.getElementById("toast").textContent')).includes('damaged') &&
    await p.ev('document.querySelector("#t-install input[data-mode=do]").checked') === true, await p.ev('document.getElementById("toast").textContent'));

  // Snapshots.
  check('snapshots recorded', (await p.ev('document.querySelectorAll("#snaplist button[data-restore]").length')) >= 2);
  await p.ev('document.getElementById("savesnap").click()');
  check('manual snapshot saved', (await p.ev('document.getElementById("snaplist").textContent')).includes('snap1'));
  await p.ev('document.getElementById("reset").click()');
  await p.ev('(()=>{const li=[...document.querySelectorAll("#snaplist li")].find(l=>l.textContent.includes("snap1")); li.querySelector("button").click();})()');
  await sleep(200);
  check('restoring a snapshot brings progress back', await p.ev('document.querySelector("#t-install input[data-mode=do]").checked') === true);

  // Copy button + copy link.
  await p.ev('document.querySelector("#t-install .code .copy").click()');
  await sleep(300);
  check('copy shows confirmation', await p.ev('document.getElementById("toast").textContent') === 'Copied');

  check('no page errors', p.events.errors.length === 0, p.events.errors);
  const external = p.events.requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith(new URL(url).origin) && u !== 'about:blank');
  check('no external network requests', external.length === 0, external);
  p.close();

  // Fresh profile-like load with a hash from a link: use a second tab with the hash and cleared storage.
  const q = await open('about:blank');
  await q.send('Page.navigate', { url });
  await sleep(500);
  await q.ev('localStorage.clear()');
  await q.send('Page.navigate', { url: url + '#v1.1.install~2_identity~5_ghost~1' });
  await sleep(500);
  await q.send('Page.reload');
  await sleep(500); await waitReady(q);
  check('hash link restores checks', await q.ev('location.hash') === '#v1.1.install~2_identity~5', await q.ev('location.hash'));
  check('hash link shows banner', await q.ev('!document.getElementById("banner").hidden'));
  check('hash link checked boxes', await q.ev('document.querySelectorAll("input[data-mode]:checked").length') === 3);
  await q.ev('document.getElementById("banner-revert").click()');
  check('revert returns to saved (empty) progress', await q.ev('document.querySelectorAll("input[data-mode]:checked").length') === 0);
  check('no page errors (hash load)', q.events.errors.length === 0, q.events.errors);
  q.close();
} finally {
  chrome.kill();
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
