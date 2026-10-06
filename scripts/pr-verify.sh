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

# The GitHub repo that origin points at; the PR lookup and the fetch must
# agree on it.
origin_url="$(git -C "$repo" remote get-url origin)"
gh_repo="$(sed -E 's#^(https://([^/@]+@)?github\.com/|git@github\.com:|ssh://git@github\.com/)##; s#\.git$##' <<<"$origin_url")"
if [[ ! "$gh_repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
	echo "origin is not a GitHub repo: $(sed -E 's#//[^/@]+@#//***@#' <<<"$origin_url")" >&2
	exit 1
fi

# Fail closed: refuse unless the lookup positively says same-repo.
if ! cross="$(gh pr view "$pr" --repo "$gh_repo" --json isCrossRepository --jq .isCrossRepository)"; then
	echo "could not look up PR #$pr in $gh_repo; refusing to run it" >&2
	exit 1
fi
case "$cross" in
false) ;;
true)
	if [[ "$allow_fork" == false ]]; then
		echo "PR #$pr comes from a fork; re-run with --allow-fork after reading its diff." >&2
		exit 1
	fi
	;;
*)
	echo "unexpected isCrossRepository value for PR #$pr: '$cross'; refusing to run it" >&2
	exit 1
	;;
esac

# Fetch into refs private to this run, so a concurrent run can't move the base
# or head between this fetch and the merge. Fresh every run: a stale local
# origin/main gives the wrong base.
run_refs="refs/pr-verify/$pr-$$"
worktree=""
worktree_added=false
cleanup() {
	git -C "$repo" update-ref -d "$run_refs/main" 2>/dev/null || true
	git -C "$repo" update-ref -d "$run_refs/head" 2>/dev/null || true
	[[ -n "$worktree" ]] || return 0
	[[ "$keep" == true && "$worktree_added" == true ]] && return 0
	if [[ "$worktree_added" == false ]]; then
		rm -rf "$worktree"
	elif ! git -C "$repo" worktree remove --force "$worktree"; then
		echo "warning: could not remove worktree $worktree; remove it by hand" >&2
	fi
}
# Set before the fetch, so a failure at any later step still removes the refs.
trap cleanup EXIT

git -C "$repo" fetch --quiet origin \
	"+refs/heads/main:$run_refs/main" \
	"+refs/pull/$pr/head:$run_refs/head"
base="$(git -C "$repo" rev-parse "$run_refs/main")"
head="$(git -C "$repo" rev-parse "$run_refs/head")"

# A unique path per run, so concurrent runs and kept worktrees never collide.
worktree="$(mktemp -d "${TMPDIR:-/tmp}/turso-introspect-pr-$pr.XXXXXX")"

# Check out main and merge the PR, matching the merge commit pull_request CI
# tests. A conflict fails the run.
git -C "$repo" worktree add --quiet --detach "$worktree" "$base"
worktree_added=true
cd "$worktree"
if git merge-base --is-ancestor "$head" HEAD; then
	echo "PR #$pr (${head:0:7}) is already in origin/main; verifying origin/main at ${base:0:7}"
else
	# A throwaway commit: don't sign it, skip the reviewer's merge hooks, and
	# don't depend on their git identity being configured.
	if ! git -c user.name=pr-verify -c user.email=pr-verify@localhost \
		merge --quiet --no-edit --no-ff --no-gpg-sign --no-verify "$head" >/dev/null; then
		if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
			echo "PR #$pr does not merge cleanly into origin/main" >&2
		else
			echo "merging PR #$pr into origin/main failed (see git output above)" >&2
		fi
		git merge --abort 2>/dev/null || true
		exit 1
	fi
	echo "PR #$pr at ${head:0:7}, merged into origin/main at ${base:0:7}"
	git --no-pager diff --stat "$base" HEAD
fi

bun install --frozen-lockfile --ignore-scripts
bun run ci

echo "PR #$pr: bun run ci passed"
if [[ "$keep" == true ]]; then
	echo "Worktree kept at $worktree (remove with: git worktree remove --force $worktree)"
fi
