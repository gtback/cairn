# cairn

Turn a pile of sources into a trail you can share, follow, and track, as one self-contained HTML file.

A cairn is a stack of stones that marks a trail. Each task you finish leaves one behind.

**C**hoose a goal or follow the recommended route. **A**ct by running real commands. **I**nspect by reading with a question in mind. **R**ecall by explaining without notes. **N**ote what you learned in your own words.

## What you get

- One HTML file per trail. No server, no network, no dependencies. Open it from disk or host it anywhere.
- A recommended flow for general learning, plus goals ("choose your own adventure") that show only the tasks they need, prerequisites first.
- Tasks of 5–60 minutes with a markdown body, ordered steps, copyable commands, links, and images (slides and diagrams are inlined).
- Per-task **read / do / explain** checkboxes.
- Hidden answers for predictions, "why" prompts, challenges and explanations, behind a **Show answer** link. A page-level **Enable answers** switch shows or hides those links; printing includes all answers when it is on and none when it is off.
- A collapsible **Routes** map: every task against the recommended flow and each goal, with time per route.
- Progress that travels with the plan:
  - the URL hash carries the checkmarks, so a hosted link shares progress;
  - a **token** in the page carries checkmarks and notes, and pasting it back restores them;
  - local autosave with timestamped snapshots: every 5 minutes (if something changed) for an hour, hourly for a day, daily for a week, weekly for a year.
- A completion time recorded per checkbox (stored, not yet displayed).

## Quick start

```bash
make test                          # unit tests (needs node 22+ and python3)
make build                         # builds trails/example -> dist/example.html
open dist/example.html
python3 tools/build.py path/to/my-trail -o my-trail.html
```

`make e2e` drives headless Chrome through the whole UI (needs Chrome; set `CHROME=` if it is not at the macOS default location).

## Terms

- **Trail**: a learning plan. It covers both of the next two.
- **Trail source**: the directory you author (`trail.json` or `trail.yaml`, `intro.md`, `tasks/`, `assets/`).
- **Trail page**: the single self-contained HTML file built from a trail source.

## Writing a trail

A trail is a directory:

```
my-trail/
  trail.json      structure: tasks, modes, prereqs, goals, recommended order
                 (or trail.yaml, which needs PyYAML)
  intro.md       optional intro
  tasks/<id>.md  optional prose for each task
  assets/        images referenced from markdown
```

See [docs/trail-format.md](docs/trail-format.md) for the format and [trails/example](trails/example) for a small working example. The build validates everything (ids, references, cycles, modes, images) and lists every problem at once.

## The skill

[`skills/cairn`](skills/cairn/SKILL.md) is an agent skill that interviews you, gathers and verifies sources, drafts an outline for your approval, then writes and builds the trail. It follows the principles in [docs/pedagogy.md](docs/pedagogy.md) and reads an optional personal profile at `~/.config/cairn/profile.md`.

## Layout

| Path | Purpose |
|---|---|
| `runtime/` | The shared engine (`cairn.js`), styles, and HTML shell inlined into every built page |
| `tools/build.py` | Validates a trail directory and builds the single-file page |
| `test/` | Node tests for the engine, and a headless-Chrome end-to-end check |
| `trails/example/` | A small generic example ("Learn jq") |
| `docs/` | Path format and pedagogy notes |
| `skills/cairn/` | The authoring skill |

## License

Apache-2.0. See [LICENSE](LICENSE).
