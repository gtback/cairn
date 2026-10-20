# cairn skill

An agent skill that builds trails for [cairn](../../README.md).

## Usage

Ask in natural language:

- "make a learning plan for <topic> from these docs"
- "turn this deck into a trail"
- "update my cairn trail and add a task about X"

## What it does

Reads your optional profile (`~/.config/cairn/profile.md`), interviews you, reads and verifies the sources, proposes an outline for approval, then writes the trail source (`trail.yaml` and the task files) and builds one self-contained HTML page. Standalone trails get their own git repo and `CLAUDE.md`, so their sessions stay separate from work on cairn itself. It flags repos referenced by the sources that are not cloned locally.

## Requirements

- `python3`
- A checkout of this repository. The skill finds it when `skills/cairn` is symlinked from the checkout. If you copy the skill instead, set `CAIRN_HOME` to the checkout.

## Install

Copy or link `skills/cairn` into your agent's skills directory, or use `npx skills add` against the repository once it is hosted.
