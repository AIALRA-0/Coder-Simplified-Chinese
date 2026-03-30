#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd 2>/dev/null || pwd)"

if [[ -f "${SCRIPT_DIR}/scripts/deploy.sh" && -f "${SCRIPT_DIR}/manifest.env" ]]; then
  exec bash "${SCRIPT_DIR}/scripts/deploy.sh" "$@"
fi

DEFAULT_REF="${CODER_SC_REF:-main}"
ARCHIVE_URL="${CODER_SC_ARCHIVE_URL:-}"
REPO_SLUG="${CODER_SC_REPO_SLUG:-}"

die() {
  echo "[coder-sc] ERROR: $*" >&2
  exit 1
}

for command in curl tar; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "missing required command: ${command}" >&2
    exit 1
  fi
done

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

if [[ -z "${ARCHIVE_URL}" && -n "${REPO_SLUG}" ]]; then
  ARCHIVE_URL="https://codeload.github.com/${REPO_SLUG}/tar.gz/refs/heads/${DEFAULT_REF}"
fi

[[ -n "${ARCHIVE_URL}" ]] || die "set CODER_SC_ARCHIVE_URL or CODER_SC_REPO_SLUG when running install.sh outside a checked-out repository"

ARCHIVE_PATH="${TMP_DIR}/repo.tar.gz"

curl -fsSL "${ARCHIVE_URL}" -o "${ARCHIVE_PATH}"
tar -xzf "${ARCHIVE_PATH}" -C "${TMP_DIR}"

DEPLOY_SCRIPT="$(find "${TMP_DIR}" -maxdepth 3 -type f -path '*/scripts/deploy.sh' | head -n1)"
[[ -n "${DEPLOY_SCRIPT}" ]] || die "unable to locate scripts/deploy.sh in extracted archive"

EXTRACTED_DIR="$(cd "$(dirname "${DEPLOY_SCRIPT}")/.." && pwd)"
if [[ ! -x "${EXTRACTED_DIR}/scripts/deploy.sh" ]]; then
  chmod +x "${EXTRACTED_DIR}/scripts/deploy.sh"
fi

exec bash "${EXTRACTED_DIR}/scripts/deploy.sh" "$@"
