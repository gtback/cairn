# Writing good tasks

## Sizing

- One task is 5–60 minutes and has an observable end: a command that prints the expected thing, a failing test that now fails for the right reason, a question you can answer.
- A task can contain several commands ("set up this repo", "add a failing test"). Several unrelated commands are several tasks.
- If an estimate is over an hour, split it. The build warns.

## Choosing modes

| Mode | Use when | Needs |
|---|---|---|
| `read` | The task is understanding material: a doc, a design, a diagram | A `predict` before it, and ideally an `elaborate` |
| `do` | The task is running or changing something | `steps` with commands; ideally a `modify` challenge |
| `explain` | There is a concept to be able to say back without notes | An `explain` prompt answerable from memory |

Combine them where it fits: `read` + `explain` for concepts, `do` + `explain` for a skill. Most tasks need no more than two.

## Prompts

- **predict**: ask before the material, about the key idea. "What do you think `.a` returns if `.` returns the input unchanged?" Not "what will you learn?".
- **elaborate**: a "why" or "how does this differ from X" to hold in mind while reading.
- **step.predict**: one per step at most; use it where the output is surprising or instructive.
- **modify**: a change to what was just run, with an outcome you can check. "Print the name without quotes" beats "experiment".
- **explain**: phrased as an explanation, not a recall list. "Walk through how X evaluates Y" beats "list the parts of X".

## Answers

Put an answer under `answers` (or a step's `answer`) for every `predict`, `explain`, `modify` and any `elaborate` that has a definite answer. They are hidden until asked for, so the learner commits to a response first and then gets feedback.

- Write the answer as a reference a learner can check themselves against: the key points, not a model essay. Two to four sentences or one command.
- For `explain`, list the ideas a good answer must contain; for `modify`, give the command or change and what it should output.
- Verify each answer the way you verify a command: run it, or tie it to a source you have read. If you cannot, say so in the answer text.
- If the sources disagree, the answer states the disagreement instead of picking a side.
- A step `answer` needs a step `predict`. The build errors otherwise, and warns when an `explain` prompt has no answer.

## Experienced learners

Compress or skip basics (the profile says which). Prefer modify, debug and trace tasks over step-by-step recipes. Put prerequisite checks behind the "I already know this" test-out rather than deleting them.

## Prerequisites and goals

- Add a prerequisite only when the task genuinely cannot be done without it.
- A goal is something a person wants to be able to do. Name it that way ("Triage a stuck deployment"), and list only the final tasks; prerequisites are pulled in automatically.
- The recommended order should respect prerequisites and read like a course: concepts first, then hands-on, then integration.

## Verification checklist

Before building:

- every command was run, or is flagged as not run;
- every file path in the text exists in the repository named;
- every link was classified and opened or fetched;
- every image is legible at page width.
