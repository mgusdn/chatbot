#!/usr/bin/env bash
# Keep the GPT-SoVITS voice server alive for the duration of an exhibition.
#
# The server is a single manually-launched process with no supervisor, so if it
# exits — OOM, an unhandled inference error, a stray Ctrl-C — every later
# counseling turn loses its voice and nothing brings it back. This restarts it
# and records why it stopped.
#
# Usage:  scripts/run_sovits.sh            # foreground, Ctrl-C stops for good
#         nohup scripts/run_sovits.sh &    # detached
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOVITS_DIR="$ROOT/testVoice/GPT-SoVITS"
PYTHON="$ROOT/testVoice/.venv-sovits/bin/python"
CONFIG="GPT_SoVITS/configs/tts_infer.yaml"
HOST="${SOVITS_HOST:-127.0.0.1}"
PORT="${SOVITS_PORT:-9880}"
LOG="${SOVITS_LOG:-/tmp/sovits.log}"
RESTART_DELAY="${SOVITS_RESTART_DELAY:-5}"

for path in "$PYTHON" "$SOVITS_DIR/api_v2.py" "$SOVITS_DIR/$CONFIG"; do
  if [[ ! -e "$path" ]]; then
    echo "run_sovits: missing $path" >&2
    exit 1
  fi
done

# Ctrl-C should stop the supervisor too, not just restart the child.
stopping=0
trap 'stopping=1' INT TERM

cd "$SOVITS_DIR" || exit 1

while true; do
  echo "[run_sovits] $(date '+%F %T') starting on $HOST:$PORT" | tee -a "$LOG"
  "$PYTHON" api_v2.py -a "$HOST" -p "$PORT" -c "$CONFIG" >>"$LOG" 2>&1
  status=$?

  if [[ $stopping -eq 1 ]]; then
    echo "[run_sovits] $(date '+%F %T') stopped by signal" | tee -a "$LOG"
    exit 0
  fi

  echo "[run_sovits] $(date '+%F %T') exited with status $status, restarting in ${RESTART_DELAY}s" | tee -a "$LOG"
  sleep "$RESTART_DELAY"
done
