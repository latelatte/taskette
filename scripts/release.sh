#!/usr/bin/env bash
# Tag the current HEAD as a release and push it to origin.
#
# Usage:
#   scripts/release.sh
#
# Run this AFTER you have committed the version bump on your release branch.
# The version is read from package.json — no argument needed.
#
# What it does:
#   1. read version from package.json
#   2. refuse to run if the tag already exists or the working tree is dirty
#   3. show the commit/tag, ask once for confirmation
#   4. push the branch (if needed) and the tag
#   5. print the next manual step (verify Draft Release, then Publish)

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: package.json version is not X.Y.Z (got: $VERSION)" >&2
  exit 1
fi

if ! git diff-index --quiet HEAD --; then
  echo "error: working tree has uncommitted changes." >&2
  echo "  finish your commit first, then run this script." >&2
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "error: tag $TAG already exists locally." >&2
  echo "  to retry from scratch:" >&2
  echo "    git tag -d $TAG && git push --delete origin $TAG" >&2
  exit 1
fi

if git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
  echo "error: tag $TAG already exists on origin." >&2
  echo "  delete it first: git push --delete origin $TAG" >&2
  exit 1
fi

HEAD_SHA=$(git rev-parse --short HEAD)
HEAD_MSG=$(git log -1 --pretty=%s)

echo "branch : $BRANCH"
echo "commit : $HEAD_SHA  $HEAD_MSG"
echo "tag    : $TAG"
echo

read -r -p "ship $TAG? [y/N] " ANS
case "$ANS" in
  [Yy]*) ;;
  *) echo "aborted."; exit 0 ;;
esac

echo "==> push branch $BRANCH"
git push origin "$BRANCH"

echo "==> create and push tag $TAG"
git tag "$TAG"
git push origin "$TAG"

cat <<EOF

[ok] $TAG shipped. GitHub Actions will now build a Draft Release.

Watch CI:
  gh run watch

When the run finishes, inspect the Draft and Publish:
  gh release view $TAG --web

To roll back (only if CI failed before Publish):
  gh release delete $TAG --yes
  git push --delete origin $TAG
  git tag -d $TAG

EOF
