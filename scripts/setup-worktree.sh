#!/bin/sh
# Prepares a new git worktree: links the local files listed in
# .worktreeinclude to the main checkout, then installs dependencies.
#
# Symlinks, not copies: a copy goes stale when the main checkout's file
# changes. A file already in the worktree is replaced only when it is a
# byte-identical copy (what Claude Code's .worktreeinclude leaves); a file
# that differs is kept and named. Safe to re-run.
set -eu

root=$(git rev-parse --show-toplevel)
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
cd "$root"

if [ "$root" = "$main" ]; then
  echo "This is the main checkout; nothing to link."
else
  grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' .worktreeinclude |
    while IFS= read -r path; do
      source="$main/$path"
      if [ ! -e "$source" ]; then
        echo "Missing $path: add it to $main first"
        continue
      fi
      if [ -L "$path" ] && [ "$(readlink "$path")" = "$source" ]; then
        echo "Kept $path"
        continue
      fi
      if [ -e "$path" ] || [ -L "$path" ]; then
        if [ -L "$path" ] || [ ! -f "$path" ] || ! cmp -s "$path" "$source"; then
          echo "Kept $path: differs from the main checkout's (delete it to link)"
          continue
        fi
        rm "$path"
      fi
      mkdir -p "$(dirname "$path")"
      ln -s "$source" "$path"
      echo "Linked $path"
    done
fi

pnpm install --frozen-lockfile
