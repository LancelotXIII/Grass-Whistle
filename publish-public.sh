#!/usr/bin/env bash
# Publishes current state of main to the public remote as a single orphan commit.
# Usage: bash publish-public.sh "your commit message"
set -e

MSG="${1:-chore: publish}"

git checkout --orphan _public_tmp
git add -A
git commit -m "$MSG"
git push public _public_tmp:main --force
git checkout main
git branch -D _public_tmp

echo "Done — public repo updated with a single clean commit."
