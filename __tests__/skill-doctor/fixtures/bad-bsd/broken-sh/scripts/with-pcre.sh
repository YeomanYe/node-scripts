#!/usr/bin/env bash
# this comment has \s but should be ignored
grep -P '\d+' file.txt
sed 's/\s/_/g' file.txt
