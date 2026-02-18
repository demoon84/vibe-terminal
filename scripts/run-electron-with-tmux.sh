#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="${TMUX_SESSION_NAME:-vibe-terminal-dev}"

print_help() {
  cat <<'EOF'
Usage: run-electron-with-tmux.sh [options]

Options:
  --session <name>     Set tmux session name (default: vibe-terminal-dev).
  -h, --help           Show this help message.
EOF
}

while (($#)); do
  case "$1" in
    --session)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --session" >&2
        exit 1
      fi
      SESSION_NAME="$2"
      shift 2
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      print_help
      exit 1
      ;;
  esac
done

if ! command -v tmux >/dev/null 2>&1; then
  echo "[error] tmux is required for the standard app session workflow." >&2
  echo "[error] Install tmux first, then run this command again." >&2
  echo "[hint] macOS (Homebrew): brew install tmux" >&2
  exit 1
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "[info] Attaching existing tmux session: $SESSION_NAME"
  exec tmux attach -t "$SESSION_NAME"
fi

tmux new-session -d -s "$SESSION_NAME" -n app "cd \"$ROOT_DIR\" && npm run electron:start"
tmux new-window -t "$SESSION_NAME" -n shell "cd \"$ROOT_DIR\" && ${SHELL:-zsh}"
tmux select-window -t "$SESSION_NAME:app"

echo "[info] Created tmux session: $SESSION_NAME"
echo "[info] Detach with Ctrl-b d"
exec tmux attach -t "$SESSION_NAME"
