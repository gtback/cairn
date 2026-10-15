Two operators combine filters:

- `a, b` runs both filters on the *same* input and emits all of `a`'s results, then all of `b`'s.
- `a | b` runs `a`, then runs `b` on *each* result of `a`.

If you've used shell pipes, the second is familiar. The difference is that jq passes whole JSON values, not lines of text.
