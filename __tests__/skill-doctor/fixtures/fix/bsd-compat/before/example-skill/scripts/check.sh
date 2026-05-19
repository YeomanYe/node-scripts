#!/usr/bin/env bash

if echo "$value" | grep -Eq "foo\s+bar"; then
  echo "$value" | sed -E "s/id-\d+/id/g"
fi

# echo "comment\s+stays"
grep -P "foo\s+bar" input.txt
