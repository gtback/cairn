import base64
import contextlib
import io
import json
import sys
import tempfile
import unittest
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

    def write(self, spec, files=None):
        (self.dir / "path.json").write_text(json.dumps(spec))
        for name, content in (files or {}).items():
            f = self.dir / name
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(content if isinstance(content, bytes) else content.encode())

    def errors(self, spec, files=None):
        self.write(spec, files)
        with self.assertRaises(build.PathError) as cm:
            build.validate_and_load(self.dir)
        return cm.exception.errors

    def assertError(self, errors, fragment):
        self.assertTrue(any(fragment in e for e in errors), f"{fragment!r} not in {errors}")

    def test_valid_path_loads_and_renders(self):
        self.write(good_spec(), {"tasks/a.md": "Read this."})
        path, warnings = build.validate_and_load(self.dir)
        self.assertEqual(warnings, [])
        self.assertEqual(path["tasks"][0]["body"], "Read this.")
        html = build.render(path)
        self.assertIn('id="cairn-path"', html)
        self.assertNotIn("/*CAIRN_", html)
        self.assertEqual(html.count("</script>"), 2)

    def test_recommended_defaults_to_prereq_order(self):
        spec = good_spec()
        spec["tasks"].reverse()
        del spec["recommended"]
        self.write(spec)
        path, _ = build.validate_and_load(self.dir)
        self.assertEqual(path["recommended"], ["a", "b"])

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
        path, _ = build.validate_and_load(self.dir)
        self.assertIn("![diagram](data:image/png;base64,", path["tasks"][0]["body"])

    def test_missing_image_and_escape_attempt(self):
        errs = self.errors(good_spec(), {"tasks/a.md": "![x](assets/missing.png)"})
        self.assertError(errs, "not found")
        errs = self.errors(good_spec(), {"tasks/a.md": "![x](../outside.png)"})
        self.assertError(errs, "outside the path directory")

    def test_remote_images_are_left_alone(self):
        self.write(good_spec(), {"tasks/a.md": "![x](https://example.com/x.png)"})
        path, _ = build.validate_and_load(self.dir)
        self.assertIn("https://example.com/x.png", path["tasks"][0]["body"])

    def test_body_file_and_inline_body_conflict(self):
        spec = good_spec()
        spec["tasks"][0]["body"] = "inline"
        self.assertError(self.errors(spec, {"tasks/a.md": "file"}), "both")

    def test_script_close_tag_in_content_cannot_break_out(self):
        spec = good_spec()
        spec["tasks"][0]["title"] = "</script><script>alert(1)</script>"
        self.write(spec, {"tasks/a.md": "x </script> y"})
        path, _ = build.validate_and_load(self.dir)
        html = build.render(path)
        self.assertEqual(html.count("</script>"), 2)
        self.assertNotIn("<script>alert(1)", html)

    def test_intro_file(self):
        spec = good_spec()
        spec["intro"] = "intro.md"
        self.write(spec, {"intro.md": "Welcome."})
        path, _ = build.validate_and_load(self.dir)
        self.assertEqual(path["intro"], "Welcome.")
        spec["intro"] = "missing.md"
        self.assertError(self.errors(spec), "intro file")

    def test_invalid_json_and_missing_file(self):
        (self.dir / "path.json").write_text("{not json")
        with self.assertRaises(build.PathError):
            build.validate_and_load(self.dir)
        with self.assertRaises(build.PathError):
            build.validate_and_load(self.dir / "nowhere")

    def test_answers_are_kept_and_validated(self):
        spec = good_spec()
        spec["tasks"][1]["predict"] = "What happens?"
        spec["tasks"][1]["answers"]["predict"] = "Nothing much."
        spec["tasks"][1]["steps"][0].update({"predict": "Output?", "answer": "hi"})
        self.write(spec)
        path, warnings = build.validate_and_load(self.dir)
        self.assertEqual(warnings, [])
        self.assertEqual(path["tasks"][1]["answers"], {"explain": "B is B.", "predict": "Nothing much."})
        self.assertEqual(path["tasks"][1]["steps"][0]["answer"], "hi")

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
        path, _ = build.validate_and_load(self.dir)
        self.assertIn("data:image/png;base64,", path["tasks"][1]["answers"]["explain"])

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

    def test_example_path_builds_without_warnings(self):
        example = Path(__file__).resolve().parent.parent / "paths" / "example"
        if not (example / "path.json").exists():
            self.skipTest("example path not present")
        _, warnings = build.validate_and_load(example)
        self.assertEqual(warnings, [])


if __name__ == "__main__":
    unittest.main()
