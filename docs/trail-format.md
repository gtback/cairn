# Trail format

A trail is a directory that `tools/build.py` turns into one HTML file. This page calls the directory the **trail source** and the HTML file the **trail page**; "trail" alone means either.

```
my-trail/
  trail.json
  intro.md          optional (referenced from trail.json)
  tasks/<id>.md     optional prose per task
  assets/*          images used by markdown
```

## trail.json or trail.yaml

The structure file is `trail.json`, or `trail.yaml` / `trail.yml` if you prefer to edit by hand. Use exactly one. The fields are identical; this page shows JSON.

YAML needs PyYAML (`pip install pyyaml`); the build says so if it is missing, and JSON needs nothing beyond Python. YAML is loaded strictly: only `true` and `false` are booleans (so `on`, `no` and `yes` stay strings, which matters for ids), dates stay strings, and duplicate keys are errors. Block scalars drop their trailing newline, so a `|` block is a clean command. Comments are allowed.

```yaml
- id: select
  title: Filter lists with select and map
  modes: [do, explain]
  estimate: 20m
  steps:
    - text: Keep only the items that are ok.
      cmd: |
        echo '[{"n":"a","ok":true}]' | jq -c 'map(select(.ok))'
  answers:
    explain: >
      `.[]` streams the elements; `map(...)` collects the results
      back into an array.
```

A YAML build of a trail is byte-identical to the build of the same trail in JSON.

## trail.json

```json
{
  "id": "learn-jq",
  "title": "Learn jq",
  "version": 1,
  "intro": "intro.md",
  "sources": [{"label": "jq manual", "url": "https://jqlang.github.io/jq/manual/"}],
  "sections": [{"id": "start", "title": "Getting started"}],
  "tasks": [ ... ],
  "goals": [{"id": "extract", "title": "...", "description": "...", "tasks": ["fields"]}],
  "recommended": ["install", "identity", "fields"]
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | `[a-z0-9-]{1,24}`. Keys saved progress in the browser. |
| `title` | yes | |
| `version` | no (1) | Integer. Bump it when tasks are added, removed, or renamed. |
| `intro` | no | A `.md` filename relative to the trail directory, or literal markdown. |
| `sources` | no | `{label, url}` links shown at the top. `http(s)` only. |
| `sections` | no | `{id, title}`. A task's `section` must be one of these. |
| `tasks` | yes | See below. |
| `goals` | no | `{id, title, description, tasks}`. A goal shows its tasks plus all their transitive prerequisites, prerequisites first. `recommended` is reserved as an id. |
| `recommended` | no | Task ids in suggested order. Defaults to a prerequisite-respecting order of the task list. The build warns if a task is missing or placed before its prerequisite. |

## Tasks

A task is a unit of 5–60 minutes of learning. The build warns above 60 minutes; split large tasks. A task can bundle several commands ("set up this repo") or be a single reading.

```json
{
  "id": "select",
  "section": "filters",
  "title": "Filter lists with select and map",
  "modes": ["do", "explain"],
  "estimate": "20m",
  "prereqs": ["fields"],
  "predict": "What do you expect this to print?",
  "elaborate": "Why does ... ?",
  "steps": [{"text": "Keep only ok items.", "predict": "How many survive?", "cmd": "jq ..."}],
  "links": [{"label": "Manual", "url": "https://..."}],
  "modify": "Change the filter so it keeps the opposite items.",
  "explain": "Explain the difference between `.[]` and `map(...)`.",
  "answers": {
    "modify": "`map(select(.ok | not))`",
    "explain": "`.[]` streams the elements; `map(...)` collects results into an array."
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | `[a-z0-9-]{1,24}`, unique. Keep it stable: progress is stored by id. |
| `title` | yes | |
| `modes` | yes | Non-empty subset of `read`, `do`, `explain`. Each becomes a checkbox. |
| `explain` | if `explain` mode | The recall prompt, shown with a link back to the source material. |
| `estimate` | no | `15m`, `2h`. |
| `section` | no | A section id. |
| `prereqs` | no | Task ids. Cycles and unknown ids are errors. |
| `predict` | no | A question to answer *before* reading or running. |
| `elaborate` | no | A "why does this work?" prompt shown after the body. |
| `steps` | no | Ordered `{text, cmd?, predict?, answer?}`. `cmd` gets a Copy button. `answer` is the hidden answer to the step's `predict` (an error without one). |
| `links` | no | `{label, url}`, `http(s)` or `mailto`. |
| `modify` | no | A closing challenge: change what you just ran. |
| `answers` | no | Hidden answers, keyed by the prompt they answer: `predict`, `elaborate`, `modify`, `explain`. Each value is a markdown string. A key needs its prompt to exist. The build warns when an `explain` prompt has no `answers.explain`. |
| `noteprompts` | no | Labels for the notes fields. Default: "In my words", "What surprised me", "Open question". |
| `body` | no | Inline markdown, used only when `tasks/<id>.md` does not exist. |

## Section headings

When a trail has `sections`, the task list shows a heading before each run of tasks in the same section, with the run's task count and total estimate. A route that visits a section in two separate runs gets two headings, so keep `recommended` in section order. Tasks without a section get no heading.

## Answers

Answers sit behind a **Show answer** link under their prompt, so the learner attempts first. The page has an **Enable answers** checkbox (on by default) that shows or hides those links; it never reveals an answer itself. Turn it off to test yourself with no answers in view. It appears only when the trail has answers, is remembered per trail in the browser, and is not part of the hash or token.

Printing produces a clean reference copy in light colors: progress, notes, "blocked by" hints, controls and the routes panel are left out, and long commands wrap. When printing, answers are included, all expanded, if **Enable answers** is on, and left out if it is off. Answers are markdown with the same subset as task bodies, and relative images are inlined.

## Routes panel

Every page has a collapsed **Routes through this trail** panel: a matrix of tasks against the recommended flow and each goal (● the route's own task, ○ a prerequisite pulled in), with the total time and time left per route. Clicking a column switches the view; clicking a task jumps to it. It is generated from `tasks`, `goals`, `recommended` and `estimate`; there is nothing to author.

## Markdown

Task bodies and the intro support a small subset:

- headings (`#` to `###`, shown below the task title), paragraphs
- flat bulleted and numbered lists
- fenced code blocks (with a Copy button), inline code
- `**bold**`, `*italic*`, `[links](https://...)`
- pipe tables: a header row, a `|---|---|` separator row, then body rows. Cells take inline markup; write `\|` for a literal pipe (pipes inside inline code are kept). Alignment markers are ignored.
- images: `![alt](assets/file.png)`. Relative images are read at build time and inlined as data URIs (png, jpg, gif, webp, svg).

All other HTML is escaped. Links must be `http(s)`, `mailto`, or `#anchors`.

## Progress and ids

Progress is keyed by task id and mode:

- **URL hash**: `#v1.<version>.<id>~<mask>_...`, with mask bits read=1, do=2, explain=4.
- **Token**: `cairn1:` plus compressed JSON of checkmarks (with completion timestamps) and notes.
- **Browser storage**: current state plus snapshots, per trail id.

Ids not present in the current trail are ignored when loading a hash or token, so old progress survives edits, except for tasks that were renamed or removed.
