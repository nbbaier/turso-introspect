#!/usr/bin/env bash
# Verify a pull request the way CI does: merge the PR head into fresh main in
# a throwaway worktree, install from the frozen lockfile, and run the CI gate.
#
# Usage: scripts/pr-verify.sh <pr-number> [--keep] [--allow-fork]
#   --keep        leave the worktree in place for inspection (path is printed)
#   --allow-fork  verify a PR from a fork (refused by default)
#
# This runs the PR's own code (its `ci` script, tests, and build config) on
# your machine with your environment. Read the diff first. Fork PRs are
# refused unless --allow-fork; dependency lifecycle scripts never run.
set -euo pipefail

usage() {
	echo "usage: scripts/pr-verify.sh <pr-number> [--keep] [--allow-fork]" >&2
	exit 2
}

pr=""
keep=false
allow_fork=false
for arg in "$@"; do
	case "$arg" in
	--keep) keep=true ;;
	--allow-fork) allow_fork=true ;;
	*)
		[[ -z "$pr" && "$arg" =~ ^[0-9]+$ ]] || usage
		pr="$arg"
		;;
	esac
done
[[ -n "$pr" ]] || usage

repo="$(git rev-parse --show-toplevel)"
pr_ref="refs/remotes/origin/pr/$pr"

if [[ "$(gh pr view "$pr" --json isCrossRepository --jq .isCrossRepository)" == true && "$allow_fork" == false ]]; then
	echo "PR #$pr comes from a fork; re-run with --allow-fork after reading its diff." >&2
	exit 1
fi

# Fresh refs every run: a stale local origin/main gives the wrong base.
git -C "$repo" fetch --quiet origin \
	"+refs/heads/main:refs/remotes/origin/main" \
	"+refs/pull/$pr/head:$pr_ref"

# A unique path per run, so concurrent runs and kept worktrees never collide.
worktree="$(mktemp -d "${TMPDIR:-/tmp}/turso-introspect-pr-$pr.XXXXXX")"
cleanup() {
	if [[ "$keep" == false ]] && ! git -C "$repo" worktree remove --force "$worktree"; then
		echo "warning: could not remove worktree $worktree; remove it by hand" >&2
	fi
}
trap cleanup EXIT

# Check out main and merge the PR, matching the merge commit pull_request CI
# tests. A conflict fails the run.
git -C "$repo" worktree add --quiet --detach "$worktree" refs/remotes/origin/main
cd "$worktree"
if git merge-base --is-ancestor "$pr_ref" HEAD; then
	echo "PR #$pr ($(git rev-parse --short "$pr_ref")) is already in origin/main; verifying origin/main at $(git rev-parse --short HEAD)"
else
	if ! git merge --quiet --no-edit --no-ff "$pr_ref" >/dev/null; then
		echo "PR #$pr does not merge cleanly into origin/main" >&2
		git merge --abort || true
		exit 1
	fi
	echo "PR #$pr at $(git rev-parse --short "$pr_ref"), merged into origin/main at $(git rev-parse --short HEAD^1)"
	git --no-pager diff --stat HEAD^1 HEAD
fi

bun install --frozen-lockfile --ignore-scripts
bun run ci

echo "PR #$pr: bun run ci passed"
if [[ "$keep" == true ]]; then
	echo "Worktree kept at $worktree (remove with: git worktree remove --force $worktree)"
fi
