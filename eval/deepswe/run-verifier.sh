#!/bin/bash
# Native (Docker-free) runner for one DeepSWE task's verifier.
#
# Reconstructs the container paths the official tests/test.sh expects
# (/app, /tests, /logs, out-of-tree /opt/jest-ctrf) on the host and runs the
# UNMODIFIED tests/test.sh -> grader.py. Faithful because we run their real
# verifier scripts; only the environment is reconstructed, not the logic.
#
#   run-verifier.sh <task_dir> <repo_dir> <base_sha> <model_patch>
#
# <model_patch> is a unified diff of the candidate solution (src/** only).
# Prints the resulting reward.json. Leaves <repo_dir> checked out at <base_sha>
# with the patches applied (grader's post-state); caller re-checks out as needed.
set -uo pipefail
TASK_DIR=$1; REPO=$2; BASE=$3; PATCH=$4

rm -rf /logs && mkdir -p /logs/verifier /logs/artifacts
cp "$PATCH" /logs/artifacts/model.patch
echo "[run] model.patch: $(wc -c < /logs/artifacts/model.patch) bytes"

# pristine repo at base (node_modules is gitignored, survives checkout)
git -C "$REPO" checkout -f -q "$BASE"
git config --global --add safe.directory "$REPO" 2>/dev/null

# reconstruct container paths (clear any pre-existing dirs so ln doesn't nest)
rm -rf /app /tests
ln -sfn "$REPO" /app
ln -sfn "$TASK_DIR/tests" /tests
export APP_DIR=/app TESTS_DIR=/tests VERIFIER_DIR=/logs/verifier ARTIFACTS_DIR=/logs/artifacts

# run the REAL verifier entrypoint verbatim
( cd /app && bash /tests/test.sh ) 2>&1 | tail -40

echo "===== reward.json ====="
cat /logs/verifier/reward.json 2>/dev/null || echo "{}"
echo
