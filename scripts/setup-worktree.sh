#!/bin/sh
# Prepares a new git worktree: copies the local files listed in
# .worktreeinclude from the main checkout, then installs dependencies.
# Safe to re-run; existing files are never overwritten.
set -eu

root=$(git rev-parse --show-toplevel)
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
cd "$root"

if [ "$root" = "$main" ]; then
  echo "This is the main checkout; nothing to copy."
else
  grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' .worktreeinclude |
    while IFS= read -r path; do
      if [ -e "$path" ]; then
        echo "Kept $path"
      elif [ -e "$main/$path" ]; then
        mkdir -p "$(dirname "$path")"
        cp -p "$main/$path" "$path"
        echo "Copied $path"
      else
        echo "Missing $path: add it to $main first"
      fi
    done
fi

pnpm install --frozen-lockfile
