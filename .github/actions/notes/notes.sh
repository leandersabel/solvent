#!/usr/bin/env bash
# Release notes for <version> at <commit>, naming <image>: GitHub's
# generated notes since the last release, grouped by .github/release.yml
# (CLAUDE.md, The loop, Nightly and stable). Needs `gh` signed in to the
# repository and the tags in the checkout.
set -euo pipefail
version=$1 commit=$2 image=$3
stable=$(git tag --list '[0-9]*' | grep -vE -- '-(dev|rc)\.' | sort -V | tail -n 1 || true)
printf 'Image: `%s`\n\n' "$image"
gh api "repos/$GITHUB_REPOSITORY/releases/generate-notes" -f tag_name="$version" -f target_commitish="$commit" \
  ${stable:+-f previous_tag_name="$stable"} --jq .body
