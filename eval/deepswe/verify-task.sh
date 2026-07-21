#!/bin/bash
# Orchestrate one task's measurement on an ISOLATED copy of the agent's repo,
# so the live solving agents are never disturbed.
#
#   verify-task.sh <task_dir> <agent_repo> <base_sha> <dagward_cli>
#
# 1. read-only: extract the agent's src patch from its `solve` branch
# 2. isolated clone (+ symlinked node_modules) for the verifier + dagward runs
# 3. native verifier -> reward.json (behavioral pass/fail)
# 4. dagward before (base) vs after (base+patch) -> structural delta
set -uo pipefail
TASK_DIR=$1; AGENT_REPO=$2; BASE=$3; DAG=$4
name=$(basename "$AGENT_REPO")
PATCH=/tmp/patches/$name.patch
VERIFY=/tmp/verify/$name
mkdir -p /tmp/patches

echo "########## $name ##########"

# 1. extract patch (read-only on the agent repo; src only, like the golden).
# Auto-detect the work commit: prefer `solve` if it has commits past base,
# else the repo's current HEAD (guards against a detached-HEAD commit).
REF=""
if [ "$(git -C "$AGENT_REPO" rev-list --count "$BASE"..solve 2>/dev/null || echo 0)" -gt 0 ]; then
  REF=solve
elif [ "$(git -C "$AGENT_REPO" rev-list --count "$BASE"..HEAD 2>/dev/null || echo 0)" -gt 0 ]; then
  REF=HEAD
fi
if [ -z "$REF" ]; then
  echo "RESULT $name: no commits past base — agent did not commit"; exit 0
fi
git -C "$AGENT_REPO" diff --binary "$BASE" "$REF" -- src > "$PATCH"
echo "patch: $(wc -c < "$PATCH") bytes (ref=$REF), files: $(git -C "$AGENT_REPO" diff --name-only "$BASE" "$REF" -- src | tr '\n' ' ')"

# 2. isolated copy
rm -rf "$VERIFY"; git clone -q --local "$AGENT_REPO" "$VERIFY"
ln -sfn "$AGENT_REPO/node_modules" "$VERIFY/node_modules"

# 3. behavioral verifier
bash "$(dirname "$0")/run-verifier.sh" "$TASK_DIR" "$VERIFY" "$BASE" "$PATCH" > "/tmp/verify/$name.verifier.log" 2>&1
REWARD=$(cat /logs/verifier/reward.json 2>/dev/null || echo '{}')
echo "reward: $REWARD"

# 4. dagward structural delta: before=base, after=base+model.patch (src only,
#    NOT the held-out tests). Clean untracked leftovers (test files, new src
#    from the verifier's apply) so the patch applies to a pristine base.
git -C "$VERIFY" checkout -f -q "$BASE"
git -C "$VERIFY" clean -fdq -e node_modules
node "$DAG" init "$VERIFY" >/dev/null 2>&1
cp "$VERIFY/dagward-out/graph.files.json" "/tmp/verify/$name.before.json"
git -C "$VERIFY" apply --whitespace=nowarn "$PATCH" || echo "  (warn: patch reapply for dagward failed)"
node "$DAG" init "$VERIFY" >/dev/null 2>&1
cp "$VERIFY/dagward-out/graph.files.json" "/tmp/verify/$name.after.json"
echo "--- dagward structural delta (before -> after) ---"
node "$(dirname "$0")/score.mjs" "/tmp/verify/$name.before.json" "/tmp/verify/$name.after.json"
