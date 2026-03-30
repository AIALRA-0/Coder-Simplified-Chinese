#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_ROOT="${1:-${CODER_SC_SOURCE_ROOT:-}}"

[[ -n "${SOURCE_ROOT}" ]] || {
  echo "pass the source i18n directory as the first argument or set CODER_SC_SOURCE_ROOT" >&2
  exit 1
}

[[ -d "${SOURCE_ROOT}" ]] || {
  echo "source i18n directory not found: ${SOURCE_ROOT}" >&2
  exit 1
}

mkdir -p "${REPO_ROOT}/assets/i18n/coder-locales"
cp "${SOURCE_ROOT}/coder-i18n-runtime.js" "${REPO_ROOT}/assets/i18n/coder-i18n-runtime.js"
cp "${SOURCE_ROOT}/coder-locales/en-US.json" "${REPO_ROOT}/assets/i18n/coder-locales/en-US.json"
cp "${SOURCE_ROOT}/coder-locales/zh-CN.json" "${REPO_ROOT}/assets/i18n/coder-locales/zh-CN.json"

echo "synced assets from ${SOURCE_ROOT}"
