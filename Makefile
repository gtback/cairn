.PHONY: test build e2e

test:
	node --test 'test/*.test.js'
	python3 -m unittest discover -s tools -p 'test_*.py'

build:
	python3 tools/build.py paths/example -o dist/example.html

# Needs Chrome (set CHROME=/path/to/binary if not at the macOS default).
e2e: build
	node test/e2e.mjs "file://$(CURDIR)/dist/example.html" 9333
