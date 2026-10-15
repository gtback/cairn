jq programs are built from **filters**. A filter takes one JSON value as input and produces zero or more JSON values as output. The simplest filter, `.`, returns its input unchanged.

![input, then a filter, then output](assets/pipeline.png)

Everything else in jq is a way to build bigger filters from smaller ones:

- `.name` takes an object and produces the value of its `name` field.
- `.[]` takes an array and produces each element in turn.
- `a | b` feeds every output of `a` into `b`.

Run any of these against sample input with `echo '<json>' | jq '<filter>'`.
