# Path format

A path is a directory that `tools/build.py` turns into one HTML file.

```
my-path/
  path.json
  intro.md          optional (referenced from path.json)
  tasks/<id>.md     optional prose per task
  assets/*          images used by markdown
```

## path.json

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
| `intro` | no | A `.md` filename relative to the path directory, or literal markdown. |
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
  "predict": "Before starting: ...",
  "elaborate": "While reading, ask why ...",
  "steps": [{"text": "Keep only ok items.", "predict": "How many survive?", "cmd": "jq ..."}],
  "links": [{"label": "Manual", "url": "https://..."}],
  "modify": "Change the filter so it keeps the opposite items.",
  "explain": "Explain the difference between `.[]` and `map(...)`."
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
| `steps` | no | Ordered `{text, cmd?, predict?}`. `cmd` gets a Copy button. |
| `links` | no | `{label, url}`, `http(s)` or `mailto`. |
| `modify` | no | A closing challenge: change what you just ran. |
| `noteprompts` | no | Labels for the notes fields. Default: "In my words", "What surprised me", "Open question". |
| `body` | no | Inline markdown, used only when `tasks/<id>.md` does not exist. |

## Markdown

Task bodies and the intro support a small subset:

- headings (`#` to `###`, shown below the task title), paragraphs
- flat bulleted and numbered lists
- fenced code blocks (with a Copy button), inline code
- `**bold**`, `*italic*`, `[links](https://...)`
- images: `![alt](assets/file.png)`. Relative images are read at build time and inlined as data URIs (png, jpg, gif, webp, svg).

All other HTML is escaped. Links must be `http(s)`, `mailto`, or `#anchors`.

## Progress and ids

Progress is keyed by task id and mode:

- **URL hash**: `#v1.<version>.<id>~<mask>_...`, with mask bits read=1, do=2, explain=4.
- **Token**: `cairn1:` plus compressed JSON of checkmarks (with completion timestamps) and notes.
- **Browser storage**: current state plus snapshots, per path id.

Ids not present in the current path are ignored when loading a hash or token, so old progress survives edits, except for tasks that were renamed or removed.
