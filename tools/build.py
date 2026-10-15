#!/usr/bin/env python3
"""Validate a cairn trail directory and build it into one self-contained HTML file.

Usage:
    build.py TRAIL_DIR [-o OUTPUT.html] [--force]
    build.py --list

TRAIL_DIR contains trail.json (or trail.yaml, which needs PyYAML), optional intro.md, tasks/<id>.md bodies and
assets/. Relative images in markdown are inlined as data URIs. Without -o the
page is written to $XDG_DATA_HOME/cairn/pages/<trail id>.html (default ~/.local/share).

Each successful build is recorded in $XDG_STATE_HOME/cairn/trails.json (default
~/.local/state) so a trail can be found again from anywhere. Building a trail whose id is
already registered to a different, existing directory fails unless --force is given.
--list prints the registry.
"""

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ROOT / "runtime"

ID_RE = re.compile(r"^[a-z0-9-]{1,24}$")
ESTIMATE_RE = re.compile(r"^\d+[mh]$")
IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
MODES = ("read", "do", "explain")
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml"}
BIG_IMAGE_BYTES = 1_000_000
BIG_PAGE_BYTES = 3_000_000
TASK_KEYS = {"id", "section", "title", "modes", "estimate", "predict", "elaborate", "steps",
             "links", "modify", "explain", "prereqs", "body", "noteprompts", "answers"}
# Prompts that can carry a hidden answer in a task's "answers" object.
ANSWER_KEYS = ("predict", "elaborate", "modify", "explain")


class TrailError(Exception):
    def __init__(self, errors):
        super().__init__("\n".join(errors))
        self.errors = errors


def inline_images(markdown, base_dir, where, errors, warnings):
    def repl(match):
        alt, src = match.group(1), match.group(2)
        if re.match(r"^[a-z][a-z0-9+.-]*:", src, re.I) or src.startswith("#"):
            return match.group(0)
        file = (base_dir / src).resolve()
        if base_dir.resolve() not in file.parents:
            errors.append(f"{where}: image {src!r} is outside the trail directory")
            return match.group(0)
        if not file.is_file():
            errors.append(f"{where}: image {src!r} not found")
            return match.group(0)
        mime = IMAGE_TYPES.get(file.suffix.lower()) or mimetypes.guess_type(file.name)[0]
        if not mime or not mime.startswith("image/"):
            errors.append(f"{where}: {src!r} is not a supported image type")
            return match.group(0)
        data = file.read_bytes()
        if len(data) > BIG_IMAGE_BYTES:
            warnings.append(f"{where}: image {src!r} is {len(data) // 1000} KB; consider shrinking it")
        return f"![{alt}](data:{mime};base64,{base64.b64encode(data).decode('ascii')})"

    return IMAGE_RE.sub(repl, markdown)


def read_text(file):
    return file.read_text(encoding="utf-8")


SPEC_NAMES = ("trail.json", "trail.yaml", "trail.yml")


def load_yaml(file):
    """Parse a YAML trail file strictly: only true/false are booleans, nothing becomes a date,
    duplicate keys are errors, and block scalars lose their trailing newline."""
    try:
        import yaml
    except ImportError:
        raise TrailError([f"{file.name} needs PyYAML: pip install pyyaml (or use trail.json)"])

    class Loader(yaml.SafeLoader):
        pass

    # Drop the YAML 1.1 implicit types that surprise authors (yes/no/on/off, dates).
    Loader.yaml_implicit_resolvers = {
        ch: [(tag, rx) for tag, rx in rs if tag not in ("tag:yaml.org,2002:bool", "tag:yaml.org,2002:timestamp")]
        for ch, rs in yaml.SafeLoader.yaml_implicit_resolvers.items()
    }
    Loader.add_implicit_resolver("tag:yaml.org,2002:bool", re.compile(r"^(?:true|false)$"), list("tf"))

    def mapping(loader, node, deep=False):
        seen = set()
        for key_node, _ in node.value:
            key = loader.construct_object(key_node, deep=True)
            if key in seen:
                raise yaml.constructor.ConstructorError(
                    None, None, f"duplicate key {key!r}", key_node.start_mark)
            seen.add(key)
        return yaml.SafeLoader.construct_mapping(loader, node, deep)

    Loader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)

    def tidy(value):
        if isinstance(value, str):
            return value.rstrip("\n")
        if isinstance(value, list):
            return [tidy(v) for v in value]
        if isinstance(value, dict):
            return {k: tidy(v) for k, v in value.items()}
        return value

    try:
        return tidy(yaml.load(read_text(file), Loader=Loader))
    except yaml.YAMLError as e:
        raise TrailError([f"{file.name} is not valid YAML: {e}"])


def load_spec(trail_dir):
    """Return (spec file, parsed spec) from trail.json or trail.yaml/.yml (exactly one)."""
    found = [trail_dir / n for n in SPEC_NAMES if (trail_dir / n).is_file()]
    if not found:
        raise TrailError([f"{trail_dir / 'trail.json'} not found (trail.yaml is also accepted)"])
    if len(found) > 1:
        raise TrailError(["found " + " and ".join(f.name for f in found) + "; keep only one"])
    file = found[0]
    if file.suffix == ".json":
        try:
            return file, json.loads(read_text(file))
        except json.JSONDecodeError as e:
            raise TrailError([f"{file.name} is not valid JSON: {e}"])
    return file, load_yaml(file)


def validate_and_load(trail_dir):
    """Return (normalized trail dict, warnings). Raise TrailError listing every problem."""
    errors, warnings = [], []
    trail_dir = Path(trail_dir)
    spec_file, spec = load_spec(trail_dir)
    if not isinstance(spec, dict):
        raise TrailError([f"{spec_file.name} must contain an object"])

    pid = spec.get("id")
    if not isinstance(pid, str) or not ID_RE.match(pid):
        errors.append(f"trail id {pid!r} must match [a-z0-9-]{{1,24}}")
    if not isinstance(spec.get("title"), str) or not spec["title"].strip():
        errors.append("trail title is required")
    version = spec.get("version", 1)
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        errors.append("version must be an integer >= 1")

    sections = spec.get("sections", [])
    section_ids = set()
    for s in sections:
        sid = s.get("id") if isinstance(s, dict) else None
        if not isinstance(sid, str) or not ID_RE.match(sid):
            errors.append(f"section id {sid!r} must match [a-z0-9-]{{1,24}}")
        elif sid in section_ids:
            errors.append(f"duplicate section id {sid!r}")
        else:
            section_ids.add(sid)
        if not isinstance(s, dict) or not s.get("title"):
            errors.append(f"section {sid!r} needs a title")

    tasks = spec.get("tasks", [])
    if not isinstance(tasks, list) or not tasks:
        errors.append("tasks must be a non-empty list")
        tasks = []
    task_ids, out_tasks = set(), []
    for idx, t in enumerate(tasks):
        if not isinstance(t, dict):
            errors.append(f"tasks[{idx}] must be an object")
            continue
        tid = t.get("id")
        where = f"task {tid!r}" if tid else f"tasks[{idx}]"
        if not isinstance(tid, str) or not ID_RE.match(tid):
            errors.append(f"{where}: id must match [a-z0-9-]{{1,24}}")
        elif tid in task_ids:
            errors.append(f"{where}: duplicate id")
        else:
            task_ids.add(tid)
        for key in t:
            if key not in TASK_KEYS:
                warnings.append(f"{where}: unknown field {key!r} ignored")
        if not t.get("title"):
            errors.append(f"{where}: title is required")
        if t.get("section") is not None and t["section"] not in section_ids:
            errors.append(f"{where}: unknown section {t['section']!r}")
        modes = t.get("modes")
        if not isinstance(modes, list) or not modes or any(m not in MODES for m in modes) or len(set(modes)) != len(modes):
            errors.append(f"{where}: modes must be a non-empty, duplicate-free subset of {list(MODES)}")
            modes = []
        if "explain" in modes and not t.get("explain"):
            errors.append(f"{where}: mode 'explain' needs an 'explain' prompt")
        est = t.get("estimate")
        if est is not None:
            if not isinstance(est, str) or not ESTIMATE_RE.match(est):
                errors.append(f"{where}: estimate {est!r} must look like '15m' or '2h'")
            else:
                minutes = int(est[:-1]) * (60 if est.endswith("h") else 1)
                if minutes > 60:
                    warnings.append(f"{where}: estimate {est} is over 60 minutes; consider splitting the task")
        for i, step in enumerate(t.get("steps", [])):
            if not isinstance(step, dict) or not step.get("text"):
                errors.append(f"{where}: steps[{i}] needs 'text'")
            elif "answer" in step:
                if not isinstance(step["answer"], str) or not step["answer"].strip():
                    errors.append(f"{where}: steps[{i}] answer must be a non-empty string")
                elif not step.get("predict"):
                    errors.append(f"{where}: steps[{i}] has an 'answer' but no 'predict' to answer")
        answers = t.get("answers", {})
        if not isinstance(answers, dict):
            errors.append(f"{where}: answers must be an object")
            answers = {}
        for key, value in answers.items():
            if key not in ANSWER_KEYS:
                errors.append(f"{where}: answers.{key} is not one of {list(ANSWER_KEYS)}")
            elif not t.get(key):
                errors.append(f"{where}: answers.{key} has no matching {key!r} prompt")
            elif not isinstance(value, str) or not value.strip():
                errors.append(f"{where}: answers.{key} must be a non-empty string")
        if "explain" in modes and t.get("explain") and not answers.get("explain"):
            warnings.append(f"{where}: explain prompt has no answers.explain")
        for i, link in enumerate(t.get("links", [])):
            if not isinstance(link, dict) or not link.get("label") or not isinstance(link.get("url"), str):
                errors.append(f"{where}: links[{i}] needs 'label' and 'url'")
            elif not re.match(r"^(https?://|mailto:)", link["url"]):
                errors.append(f"{where}: links[{i}] url must be http(s) or mailto")
        if not isinstance(t.get("prereqs", []), list):
            errors.append(f"{where}: prereqs must be a list")
        body_file = trail_dir / "tasks" / f"{tid}.md" if isinstance(tid, str) else None
        body = ""
        if body_file is not None and body_file.is_file():
            body = read_text(body_file)
            if t.get("body"):
                errors.append(f"{where}: has both tasks/{tid}.md and an inline 'body'")
        elif isinstance(t.get("body"), str):
            body = t["body"]
        body = inline_images(body, trail_dir, where, errors, warnings)
        out = {k: v for k, v in t.items() if k in TASK_KEYS and k != "body"}
        out["modes"] = modes
        out["prereqs"] = list(t.get("prereqs", []))
        out["body"] = body
        if answers:
            out["answers"] = {k: inline_images(v, trail_dir, where, errors, warnings)
                              for k, v in answers.items() if isinstance(v, str)}
        if isinstance(out.get("steps"), list):
            out["steps"] = [
                {**step, "answer": inline_images(step["answer"], trail_dir, where, errors, warnings)}
                if isinstance(step, dict) and isinstance(step.get("answer"), str) else step
                for step in out["steps"]
            ]
        out_tasks.append(out)

    # References and cycles.
    for t in out_tasks:
        for p in t["prereqs"]:
            if p not in task_ids:
                errors.append(f"task {t['id']!r}: unknown prereq {p!r}")
            elif p == t["id"]:
                errors.append(f"task {t['id']!r}: lists itself as a prereq")
    cycle = find_cycle(out_tasks, task_ids)
    if cycle:
        errors.append("prereq cycle: " + " -> ".join(cycle))

    goals = spec.get("goals", [])
    goal_ids = set()
    for g in goals:
        gid = g.get("id") if isinstance(g, dict) else None
        if not isinstance(gid, str) or not ID_RE.match(gid) or gid == "recommended":
            errors.append(f"goal id {gid!r} must match [a-z0-9-]{{1,24}} and not be 'recommended'")
            continue
        if gid in goal_ids:
            errors.append(f"duplicate goal id {gid!r}")
        goal_ids.add(gid)
        if not g.get("title"):
            errors.append(f"goal {gid!r}: title is required")
        if not g.get("tasks"):
            errors.append(f"goal {gid!r}: needs at least one task")
        for tid in g.get("tasks", []):
            if tid not in task_ids:
                errors.append(f"goal {gid!r}: unknown task {tid!r}")

    recommended = spec.get("recommended")
    if recommended is None:
        recommended = topo_order(out_tasks, task_ids)
    else:
        seen = set()
        for tid in recommended:
            if tid not in task_ids:
                errors.append(f"recommended: unknown task {tid!r}")
            elif tid in seen:
                errors.append(f"recommended: {tid!r} listed twice")
            seen.add(tid)
        for tid in sorted(task_ids - seen):
            warnings.append(f"recommended: task {tid!r} is missing from the recommended order")
        position = {tid: i for i, tid in enumerate(recommended)}
        for t in out_tasks:
            for p in t["prereqs"]:
                if t["id"] in position and p in position and position[p] > position[t["id"]]:
                    warnings.append(f"recommended: {t['id']!r} comes before its prereq {p!r}")

    intro = spec.get("intro", "")
    if isinstance(intro, str) and intro.endswith(".md"):
        intro_file = trail_dir / intro
        if intro_file.is_file():
            intro = inline_images(read_text(intro_file), trail_dir, "intro", errors, warnings)
        else:
            errors.append(f"intro file {intro!r} not found")
            intro = ""

    for i, s in enumerate(spec.get("sources", [])):
        if not isinstance(s, dict) or not s.get("label") or not re.match(r"^https?://", str(s.get("url", ""))):
            errors.append(f"sources[{i}] needs 'label' and an http(s) 'url'")

    if errors:
        raise TrailError(errors)
    trail = {
        "id": pid, "title": spec["title"], "version": version, "intro": intro,
        "sources": spec.get("sources", []), "sections": sections,
        "tasks": out_tasks, "goals": goals, "recommended": recommended,
    }
    return trail, warnings


def find_cycle(tasks, task_ids):
    graph = {t["id"]: [p for p in t["prereqs"] if p in task_ids] for t in tasks}
    state = {}

    def visit(node, stack):
        state[node] = 1
        for nxt in graph.get(node, []):
            if state.get(nxt) == 1:
                return stack[stack.index(nxt):] + [nxt] if nxt in stack else [node, nxt]
            if nxt not in state:
                found = visit(nxt, stack + [nxt])
                if found:
                    return found
        state[node] = 2
        return None

    for node in graph:
        if node not in state:
            found = visit(node, [node])
            if found:
                return found
    return None


def topo_order(tasks, task_ids):
    graph = {t["id"]: [p for p in t["prereqs"] if p in task_ids] for t in tasks}
    seen, out = set(), []

    def visit(node):
        if node in seen:
            return
        seen.add(node)
        for p in graph[node]:
            visit(p)
        out.append(node)

    for t in tasks:
        visit(t["id"])
    return out


def render(trail):
    shell = read_text(RUNTIME / "shell.html")
    css = read_text(RUNTIME / "cairn.css")
    js = read_text(RUNTIME / "cairn.js")
    if "</script" in js.lower():
        raise TrailError(["runtime/cairn.js must not contain '</script'"])
    # Escaping every '<' keeps '</script>' and '<!--' in content from affecting the HTML parser.
    blob = json.dumps(trail, ensure_ascii=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    # The trail blob is inserted last so content containing a placeholder is never re-expanded.
    html = shell.replace("/*CAIRN_CSS*/", css).replace("/*CAIRN_JS*/", js)
    return html.replace("/*CAIRN_TRAIL*/", blob)


def xdg_dir(var, fallback):
    """An XDG base directory: $var if it is an absolute path, else ~/<fallback>."""
    value = os.environ.get(var, "")
    return Path(value) if os.path.isabs(value) else Path.home() / fallback


def default_output(trail_id):
    return xdg_dir("XDG_DATA_HOME", ".local/share") / "cairn" / "pages" / f"{trail_id}.html"


def registry_file():
    return xdg_dir("XDG_STATE_HOME", ".local/state") / "cairn" / "trails.json"


def load_registry():
    file = registry_file()
    if not file.is_file():
        return {}
    try:
        return json.loads(file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise TrailError([f"{file} is not valid JSON: {e}"])


def check_registry(registry, trail_id, source, force):
    """Refuse to reuse an id registered to another source directory that still exists."""
    other = registry.get(trail_id, {}).get("source")
    if other and not force and Path(other) != source and Path(other).is_dir():
        raise TrailError([
            f"trail id {trail_id!r} is already registered to {other}; this source is {source}. "
            "Change the id, or pass --force to take it over (they would share a page and saved progress)"])


def save_registry(registry, trail_id, source, output):
    registry[trail_id] = {"source": str(source), "output": str(output),
                          "built": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    file = registry_file()
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(registry, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def list_trails():
    try:
        registry = load_registry()
    except TrailError as e:
        print(f"error: {e.errors[0]}", file=sys.stderr)
        return 1
    if not registry:
        print("no trails registered")
    for trail_id, entry in sorted(registry.items()):
        print(f"{trail_id}\t{entry['source']}\t{entry['output']}\t{entry['built']}")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("trail_dir", nargs="?")
    ap.add_argument("-o", "--output")
    ap.add_argument("--force", action="store_true", help="take over a trail id registered to another directory")
    ap.add_argument("--list", action="store_true", help="list registered trails and exit")
    args = ap.parse_args(argv)
    if args.list:
        return list_trails()
    if not args.trail_dir:
        ap.error("TRAIL_DIR is required (or use --list)")
    try:
        trail, warnings = validate_and_load(args.trail_dir)
        html = render(trail)
        source = Path(args.trail_dir).resolve()
        registry = load_registry()
        check_registry(registry, trail["id"], source, args.force)
    except TrailError as e:
        for err in e.errors:
            print(f"error: {err}", file=sys.stderr)
        return 1
    if len(html.encode("utf-8")) > BIG_PAGE_BYTES:
        warnings.append(f"page is {len(html) // 1000} KB; consider shrinking images")
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    out = Path(args.output) if args.output else default_output(trail["id"])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    save_registry(registry, trail["id"], source, out.resolve())
    print(f"wrote {out} ({len(trail['tasks'])} tasks, {len(trail['goals'])} goals, {len(html) // 1000} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
