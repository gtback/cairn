# CLAUDE.md template for a standalone trail

Write this to `<trail dir>/CLAUDE.md` when scaffolding a standalone trail.
Replace `<id>`, `<title>` and the build command. Use the cairn virtualenv's
Python if the structure file is `trail.yaml` (it needs PyYAML).

```markdown
# <title>

A cairn trail: a learning plan that builds to one self-contained HTML page.
Use the `cairn` skill to change it. Read `$CAIRN_HOME/docs/trail-format.md`
(the cairn checkout; see the cairn skill) before editing the structure file.

## Build

    python3 "$CAIRN_HOME/tools/build.py" .

The page is written to `$XDG_DATA_HOME/cairn/pages/<id>.html`
(default `~/.local/share/cairn/pages/<id>.html`). `build.py --list` shows every
registered trail. Rebuild after each change and fix every reported error.

## Rules

- Keep task ids stable. Renaming an id drops saved progress for that task;
  bump `version` when tasks are added, removed or renamed.
- Verify every link, file path and command, or mark it unverified in the task.
- Do not edit files under `$CAIRN_HOME` from this project. A change to the
  runtime, build tool, skill or docs is a request: describe it (trail id, what,
  why) and tell the user to make it in a session in the cairn checkout.
```
