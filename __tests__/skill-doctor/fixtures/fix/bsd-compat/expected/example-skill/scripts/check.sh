#!/usr/bin/env bash

if echo "$value" | grep -Eq "foo[[:space:]]+bar"; then
  echo "$value" | sed -E "s/id-[0-9]+/id/g"
fi

# echo "comment\s+stays"
grep -P "foo\s+bar" input.txt
