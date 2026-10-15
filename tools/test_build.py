import base64
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def good_spec():
    return {
        "id": "demo",
        "title": "Demo",
        "version": 1,
        "sections": [{"id": "s1", "title": "One"}],
        "tasks": [
            {"id": "a", "section": "s1", "title": "A", "modes": ["read"], "estimate": "10m"},
            {"id": "b", "section": "s1", "title": "B", "modes": ["do", "explain"],
             "explain": "Explain B.", "answers": {"explain": "B is B."}, "prereqs": ["a"], "steps": [{"text": "run", "cmd": "echo hi"}]},
        ],
        "goals": [{"id": "g", "title": "G", "description": "d", "tasks": ["b"]}],
        "recommended": ["a", "b"],
    }


class BuildTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.data, self.state = self.dir / "xdg-data", self.dir / "xdg-state"
        patcher = unittest.mock.patch.dict(
            os.environ, {"XDG_DATA_HOME": str(self.data), "XDG_STATE_HOME": str(self.state)})
        patcher.start()
        self.addCleanup(patcher.stop)

    def write(self, spec, files=None):
        (self.dir / "trail.json").write_text(json.dumps(spec))
        for name, content in (files or {}).items():
            f = self.dir / name
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(content if isinstance(content, bytes) else content.encode())

    def errors(self, spec, files=None):
        self.write(spec, files)
        with self.assertRaises(build.TrailError) as cm:
            build.validate_and_load(self.dir)
        return cm.exception.errors

    def assertError(self, errors, fragment):
        self.assertTrue(any(fragment in e for e in errors), f"{fragment!r} not in {errors}")

    def test_valid_path_loads_and_renders(self):
        self.write(good_spec(), {"tasks/a.md": "Read this."})
        trail, warnings = build.validate_and_load(self.dir)
        self.assertEqual(warnings, [])
        self.assertEqual(trail["tasks"][0]["body"], "Read this.")
        html = build.render(trail)
        self.assertIn('id="cairn-trail"', html)
        self.assertNotIn("/*CAIRN_", html)
        self.assertEqual(html.count("</script>"), 2)

    def test_recommended_defaults_to_prereq_order(self):
        spec = good_spec()
        spec["tasks"].reverse()
        del spec["recommended"]
        self.write(spec)
        trail, _ = build.validate_and_load(self.dir)
        self.assertEqual(trail["recommended"], ["a", "b"])

    def test_duplicate_and_malformed_ids(self):
        spec = good_spec()
        spec["tasks"][1]["id"] = "a"
        self.assertError(self.errors(spec), "duplicate id")
        spec = good_spec()
        spec["tasks"][0]["id"] = "Not Valid"
        self.assertError(self.errors(spec), "id must match")

    def test_dangling_references(self):
        spec = good_spec()
        spec["tasks"][1]["prereqs"] = ["nope"]
        spec["goals"][0]["tasks"] = ["ghost"]
        spec["recommended"] = ["a", "phantom"]
        errs = self.errors(spec)
        self.assertError(errs, "unknown prereq 'nope'")
        self.assertError(errs, "unknown task 'ghost'")
        self.assertError(errs, "unknown task 'phantom'")

    def test_prereq_cycle(self):
        spec = good_spec()
        spec["tasks"][0]["prereqs"] = ["b"]
        self.assertError(self.errors(spec), "prereq cycle")

    def test_self_prereq(self):
        spec = good_spec()
        spec["tasks"][0]["prereqs"] = ["a"]
        self.assertError(self.errors(spec), "itself")

    def test_bad_modes(self):
        spec = good_spec()
        spec["tasks"][0]["modes"] = ["watch"]
        self.assertError(self.errors(spec), "modes must be")
        spec = good_spec()
        spec["tasks"][0]["modes"] = []
        self.assertError(self.errors(spec), "modes must be")

    def test_explain_mode_needs_prompt(self):
        spec = good_spec()
        del spec["tasks"][1]["explain"]
        self.assertError(self.errors(spec), "needs an 'explain' prompt")

    def test_estimate_format_and_size_warning(self):
        spec = good_spec()
        spec["tasks"][0]["estimate"] = "soon"
        self.assertError(self.errors(spec), "estimate")
        spec = good_spec()
        spec["tasks"][0]["estimate"] = "2h"
        self.write(spec)
        _, warnings = build.validate_and_load(self.dir)
        self.assertTrue(any("over 60 minutes" in w for w in warnings))

    def test_unknown_section_and_bad_links(self):
        spec = good_spec()
        spec["tasks"][0]["section"] = "zzz"
        spec["tasks"][1]["links"] = [{"label": "x", "url": "javascript:alert(1)"}]
        errs = self.errors(spec)
        self.assertError(errs, "unknown section")
        self.assertError(errs, "must be http(s)")

    def test_missing_recommended_task_is_a_warning(self):
        spec = good_spec()
        spec["recommended"] = ["b"]
        self.write(spec)
        _, warnings = build.validate_and_load(self.dir)
        self.assertTrue(any("'a' is missing" in w for w in warnings))

    def test_images_are_inlined(self):
        self.write(good_spec(), {"tasks/a.md": "![diagram](assets/d.png)", "assets/d.png": PNG})
        trail, _ = build.validate_and_load(self.dir)
        self.assertIn("![diagram](data:image/png;base64,", trail["tasks"][0]["body"])

    def test_missing_image_and_escape_attempt(self):
        errs = self.errors(good_spec(), {"tasks/a.md": "![x](assets/missing.png)"})
        self.assertError(errs, "not found")
        errs = self.errors(good_spec(), {"tasks/a.md": "![x](../outside.png)"})
        self.assertError(errs, "outside the trail directory")

    def test_remote_images_are_left_alone(self):
        self.write(good_spec(), {"tasks/a.md": "![x](https://example.com/x.png)"})
        trail, _ = build.validate_and_load(self.dir)
        self.assertIn("https://example.com/x.png", trail["tasks"][0]["body"])

    def test_body_file_and_inline_body_conflict(self):
        spec = good_spec()
        spec["tasks"][0]["body"] = "inline"
        self.assertError(self.errors(spec, {"tasks/a.md": "file"}), "both")

    def test_script_close_tag_in_content_cannot_break_out(self):
        spec = good_spec()
        spec["tasks"][0]["title"] = "</script><script>alert(1)</script>"
        self.write(spec, {"tasks/a.md": "x </script> y"})
        trail, _ = build.validate_and_load(self.dir)
        html = build.render(trail)
        self.assertEqual(html.count("</script>"), 2)
        self.assertNotIn("<script>alert(1)", html)

    def test_intro_file(self):
        spec = good_spec()
        spec["intro"] = "intro.md"
        self.write(spec, {"intro.md": "Welcome."})
        trail, _ = build.validate_and_load(self.dir)
        self.assertEqual(trail["intro"], "Welcome.")
        spec["intro"] = "missing.md"
        self.assertError(self.errors(spec), "intro file")

    def test_invalid_json_and_missing_file(self):
        (self.dir / "trail.json").write_text("{not json")
        with self.assertRaises(build.TrailError):
            build.validate_and_load(self.dir)
        with self.assertRaises(build.TrailError):
            build.validate_and_load(self.dir / "nowhere")

    def yaml_available(self):
        try:
            import yaml  # noqa: F401
        except ImportError:
            self.skipTest("PyYAML not installed")

    def test_yaml_loads_same_as_json(self):
        self.yaml_available()
        import yaml
        spec = good_spec()
        (self.dir / "trail.yaml").write_text(yaml.safe_dump(spec, sort_keys=False))
        from_yaml, _ = build.validate_and_load(self.dir)
        (self.dir / "trail.yaml").unlink()
        self.write(spec)
        from_json, _ = build.validate_and_load(self.dir)
        self.assertEqual(from_yaml, from_json)

    def test_yaml_block_scalars_comments_and_strict_types(self):
        self.yaml_available()
        (self.dir / "trail.yaml").write_text(
            "# comment\n"
            "id: demo\n"
            "title: Demo\n"
            "sections: [{id: on, title: Section on}]\n"
            "tasks:\n"
            "  - id: no\n"
            "    section: on\n"
            "    title: 2026-10-13\n"
            "    modes: [do]\n"
            "    estimate: 15m\n"
            "    steps:\n"
            "      - text: Run it\n"
            "        cmd: |\n"
            "          echo \"hi: there\" # not a comment\n"
        )
        trail, warnings = build.validate_and_load(self.dir)
        self.assertEqual(warnings, [])
        task = trail["tasks"][0]
        self.assertEqual(task["id"], "no")
        self.assertEqual(task["section"], "on")
        self.assertEqual(task["title"], "2026-10-13")
        self.assertEqual(task["steps"][0]["cmd"], 'echo "hi: there" # not a comment')

    def test_yaml_errors(self):
        self.yaml_available()
        (self.dir / "trail.yaml").write_text("id: a\nid: b\ntitle: T\ntasks: []\n")
        with self.assertRaises(build.TrailError) as cm:
            build.validate_and_load(self.dir)
        self.assertError(cm.exception.errors, "duplicate key 'id'")
        (self.dir / "trail.yaml").write_text("id: [unclosed\n")
        with self.assertRaises(build.TrailError) as cm:
            build.validate_and_load(self.dir)
        self.assertError(cm.exception.errors, "not valid YAML")

    def test_yaml_without_pyyaml_says_how_to_fix_it(self):
        (self.dir / "trail.yaml").write_text("id: demo\n")
        with unittest.mock.patch.dict(sys.modules, {"yaml": None}):
            with self.assertRaises(build.TrailError) as cm:
                build.validate_and_load(self.dir)
        self.assertError(cm.exception.errors, "needs PyYAML")

    def test_json_and_yaml_together_is_an_error(self):
        self.write(good_spec())
        (self.dir / "trail.yaml").write_text("id: demo\n")
        with self.assertRaises(build.TrailError) as cm:
            build.validate_and_load(self.dir)
        self.assertError(cm.exception.errors, "keep only one")

    def test_answers_are_kept_and_validated(self):
        spec = good_spec()
        spec["tasks"][1]["predict"] = "What happens?"
        spec["tasks"][1]["answers"]["predict"] = "Nothing much."
        spec["tasks"][1]["steps"][0].update({"predict": "Output?", "answer": "hi"})
        self.write(spec)
        trail, warnings = build.validate_and_load(self.dir)
        self.assertEqual(warnings, [])
        self.assertEqual(trail["tasks"][1]["answers"], {"explain": "B is B.", "predict": "Nothing much."})
        self.assertEqual(trail["tasks"][1]["steps"][0]["answer"], "hi")

    def test_answer_errors(self):
        spec = good_spec()
        spec["tasks"][1]["answers"] = {"explain": "ok", "modify": "no modify prompt", "bogus": "x", "predict": ""}
        spec["tasks"][1]["steps"][0]["answer"] = "no predict on this step"
        errors = self.errors(spec)
        self.assertError(errors, "answers.modify has no matching 'modify' prompt")
        self.assertError(errors, "answers.bogus is not one of")
        self.assertError(errors, "steps[0] has an 'answer' but no 'predict'")

    def test_missing_explain_answer_warns(self):
        spec = good_spec()
        del spec["tasks"][1]["answers"]
        self.write(spec)
        _, warnings = build.validate_and_load(self.dir)
        self.assertEqual(warnings, ["task 'b': explain prompt has no answers.explain"])

    def test_answer_images_are_inlined(self):
        spec = good_spec()
        spec["tasks"][1]["answers"]["explain"] = "See ![d](assets/p.png)"
        self.write(spec, {"assets/p.png": PNG})
        trail, _ = build.validate_and_load(self.dir)
        self.assertIn("data:image/png;base64,", trail["tasks"][1]["answers"]["explain"])

    def test_cli_reports_every_error_and_exit_code(self):
        spec = good_spec()
        spec["tasks"][0]["modes"] = ["nope"]
        spec["goals"][0]["tasks"] = ["ghost"]
        self.write(spec)
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = build.main([str(self.dir), "-o", str(self.dir / "out.html")])
        self.assertEqual(code, 1)
        self.assertEqual(err.getvalue().count("error:"), 2)
        self.assertFalse((self.dir / "out.html").exists())

    def test_cli_success_writes_file(self):
        self.write(good_spec())
        out = self.dir / "sub" / "out.html"
        with contextlib.redirect_stdout(io.StringIO()):
            code = build.main([str(self.dir), "-o", str(out)])
        self.assertEqual(code, 0)
        self.assertTrue(out.is_file())

    def run_main(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = build.main([str(a) for a in argv])
        return code, out.getvalue(), err.getvalue()

    def registry(self):
        return json.loads((self.state / "cairn" / "trails.json").read_text())

    def other_source(self, trail_id="demo"):
        src = self.dir / "other"
        src.mkdir(exist_ok=True)
        spec = good_spec()
        spec["id"] = trail_id
        (src / "trail.json").write_text(json.dumps(spec))
        return src

    def test_default_output_is_in_xdg_data_dir_and_registered(self):
        self.write(good_spec())
        code, _, _ = self.run_main(self.dir)
        page = self.data / "cairn" / "pages" / "demo.html"
        self.assertEqual(code, 0)
        self.assertTrue(page.is_file())
        entry = self.registry()["demo"]
        self.assertEqual(entry["source"], str(self.dir.resolve()))
        self.assertEqual(entry["output"], str(page.resolve()))
        self.assertTrue(entry["built"])

    def test_xdg_dir_ignores_relative_values(self):
        with unittest.mock.patch.dict(os.environ, {"XDG_DATA_HOME": "relative/dir"}):
            self.assertEqual(build.xdg_dir("XDG_DATA_HOME", ".local/share"), Path.home() / ".local/share")

    def test_rebuild_same_source_updates_entry(self):
        self.write(good_spec())
        self.assertEqual(self.run_main(self.dir)[0], 0)
        self.assertEqual(self.run_main(self.dir)[0], 0)
        self.assertEqual(list(self.registry()), ["demo"])

    def test_id_collision_with_another_existing_source_fails(self):
        self.write(good_spec())
        self.assertEqual(self.run_main(self.dir)[0], 0)
        other = self.other_source()
        code, _, err = self.run_main(other)
        self.assertEqual(code, 1)
        self.assertIn("already registered", err)
        self.assertIn(str(self.dir.resolve()), err)
        self.assertEqual(self.registry()["demo"]["source"], str(self.dir.resolve()))

    def test_force_takes_over_id(self):
        self.write(good_spec())
        self.run_main(self.dir)
        other = self.other_source()
        self.assertEqual(self.run_main(other, "--force")[0], 0)
        self.assertEqual(self.registry()["demo"]["source"], str(other.resolve()))

    def test_moved_source_is_re_registered(self):
        old = self.other_source()
        self.assertEqual(self.run_main(old)[0], 0)
        moved = self.dir / "moved"
        old.rename(moved)
        self.assertEqual(self.run_main(moved)[0], 0)
        self.assertEqual(self.registry()["demo"]["source"], str(moved.resolve()))

    def test_collision_does_not_write_page(self):
        self.write(good_spec())
        self.run_main(self.dir)
        other = self.other_source()
        out = self.dir / "other-out.html"
        self.assertEqual(self.run_main(other, "-o", out)[0], 1)
        self.assertFalse(out.exists())

    def test_list(self):
        code, out, _ = self.run_main("--list")
        self.assertEqual((code, out.strip()), (0, "no trails registered"))
        self.write(good_spec())
        self.run_main(self.dir)
        code, out, _ = self.run_main("--list")
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("demo\t" + str(self.dir.resolve())))

    def test_trail_dir_required_without_list(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            build.main([])

    def test_corrupt_registry_is_an_error(self):
        self.write(good_spec())
        (self.state / "cairn").mkdir(parents=True)
        (self.state / "cairn" / "trails.json").write_text("{nope")
        code, _, err = self.run_main(self.dir)
        self.assertEqual(code, 1)
        self.assertIn("not valid JSON", err)

    def test_big_page_warns(self):
        self.write(good_spec())
        with unittest.mock.patch.object(build, "BIG_PAGE_BYTES", 10):
            code, _, err = self.run_main(self.dir)
        self.assertEqual(code, 0)
        self.assertIn("consider shrinking images", err)

    def test_example_trail_builds_without_warnings(self):
        example = Path(__file__).resolve().parent.parent / "trails" / "example"
        if not (example / "trail.json").exists():
            self.skipTest("example trail not present")
        _, warnings = build.validate_and_load(example)
        self.assertEqual(warnings, [])


if __name__ == "__main__":
    unittest.main()
