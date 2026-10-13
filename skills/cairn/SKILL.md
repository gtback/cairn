---
name: cairn
description: >-
  Use this skill to turn sources (slide decks, docs, repos, URLs) into a
  shareable, trackable learning path: a single self-contained HTML page with a
  recommended flow, goal-based routes with prerequisites, copyable commands,
  read/do/explain checkboxes, notes, and progress that can be shared and
  restored. Trigger on "make a learning plan", "learning path", "onboarding
  plan", "study plan for <topic>", "turn this deck into a plan", or
  "update my cairn path".
license: Apache-2.0
compatibility: Requires python3 and a local checkout of the cairn repo (CAIRN_HOME, or found from this skill's directory).
allowed-tools: Bash(python3:*) Read Write
---

# cairn: build a learning path

## Goal

Produce a path directory (`path.json`, `intro.md`, `tasks/*.md`, `assets/`) and
build it into one HTML file with the cairn runtime. The result must be accurate
(every link, path and command verified), small enough tasks to finish, and
shaped by learning research. Read these before drafting:

- `$CAIRN_HOME/docs/path-format.md`: the exact format and validation rules.
- `$CAIRN_HOME/docs/pedagogy.md`: what the evidence supports.
- [references/authoring.md](references/authoring.md): how to write good tasks.

`CAIRN_HOME` is the cairn repo checkout. Use `$CAIRN_HOME` if it is set.
Otherwise resolve this skill's directory (it is normally a symlink into the
checkout) and use its grandparent, if that contains `tools/build.py`. If
neither works, say so and ask the user to clone the repo and set `CAIRN_HOME`.
Do not recreate the tooling.

## Workflow

1. **Profile.** Read `~/.config/cairn/profile.md` if it exists: prior knowledge
   by area, preferred task mix, session length, note style, tools available. If
   it does not exist, ask a few questions and offer to save one. Never record
   learning-style or modality preferences.
2. **Intake.** Ask for: the topic, the sources, who the path is for (just them
   or shared), concrete goals ("be able to ..."), the time budget, and where to
   write output. Suggest `<dir>/<path-id>/` but confirm the location each time.
3. **Gather.** Read every source in full.
   - Classify each link as repo, pipeline, doc, dashboard, or other. Do not
     assume a name is a repository.
   - Slide decks: text export drops hyperlink targets. Export to `.pptx` and
     read `ppt/slides/_rels/*.rels` for them. Pull out slide images when a
     diagram is worth embedding.
   - For repos the path refers to, check whether they are cloned locally. List
     any that are missing and ask the user to clone them before continuing.
4. **Verify.** Confirm that every file path, local-repo link target, and
   command exists and behaves as the task says. Run safe commands. Anything you
   cannot verify must be marked as such in the task text.
5. **Outline first.** Present a compact outline: sections, tasks (id, title,
   modes, estimate, prereqs), goals, and the recommended order. Point out where
   you applied the profile and where a task is a stretch. Wait for the user to
   adjust it before writing files.
6. **Write.** Create the path directory. Keep task ids short, lowercase and
   stable. Put prose in `tasks/<id>.md`, structure and commands in `path.json`.
7. **Build.** Run `python3 "$CAIRN_HOME/tools/build.py" <path-dir> -o <path-dir>/index.html`.
   Fix every reported error. Review warnings (oversized tasks, ordering) with
   the user. Report the output path and how to share it.
8. **Update later.** Edit in place, keep ids stable, bump `version` when tasks
   are added, removed or renamed, and rebuild. Warn before renaming an id:
   progress saved under the old id is dropped.

## Sharing

The HTML file is self-contained: send it as a file, or host it anywhere. A
hosted URL carries checkmarks in its hash; the in-page progress token carries
checkmarks and notes and works for file-based sharing. Publishing is the user's
decision. Do not upload or host anything unprompted.

## Don't

- Invent links, repo names, or commands. Verify or omit.
- Write tasks over 60 minutes or with no way to tell when they are done.
- Add an `explain` mode without a prompt that can be answered from memory.
