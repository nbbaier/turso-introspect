#!/usr/bin/env bash
# Verify a pull request in a clean, detached worktree: fetch main and the PR
# head, install from the frozen lockfile, and run the same gate as CI.
#
# Usage: scripts/pr-verify.sh <pr-number> [--keep]
#   --keep  leave the worktree in place for inspection (path is printed)
set -euo pipefail

usage() {
	echo "usage: scripts/pr-verify.sh <pr-number> [--keep]" >&2
	exit 2
}

pr="${1:-}"
[[ "$pr" =~ ^[0-9]+$ ]] || usage
keep=false
case "${2:-}" in
"") ;;
--keep) keep=true ;;
*) usage ;;
esac

repo="$(git rev-parse --show-toplevel)"
pr_ref="refs/remotes/origin/pr/$pr"
worktree="${TMPDIR:-/tmp}"
worktree="${worktree%/}/turso-introspect-pr-$pr"

cleanup() {
	if [[ "$keep" == false ]]; then
		git -C "$repo" worktree remove --force "$worktree" 2>/dev/null || true
	fi
}

# Fresh refs every run: a stale local origin/main gives the wrong base.
git -C "$repo" fetch --quiet origin \
	"+refs/heads/main:refs/remotes/origin/main" \
	"+refs/pull/$pr/head:$pr_ref"

# Replace any worktree left over from an earlier --keep run.
git -C "$repo" worktree remove --force "$worktree" 2>/dev/null || true
git -C "$repo" worktree prune
trap cleanup EXIT
git -C "$repo" worktree add --quiet --detach "$worktree" "$pr_ref"

cd "$worktree"
echo "PR #$pr at $(git rev-parse --short HEAD), against origin/main at $(git rev-parse --short origin/main)"
git --no-pager diff --stat origin/main...HEAD

bun install --frozen-lockfile
bun run ci

echo "PR #$pr: bun run ci passed"
if [[ "$keep" == true ]]; then
	echo "Worktree kept at $worktree (remove with: git worktree remove --force $worktree)"
fi
