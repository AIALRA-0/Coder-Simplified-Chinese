#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

jq empty assets/i18n/coder-locales/en-US.json assets/i18n/coder-locales/zh-CN.json
node --check assets/i18n/coder-i18n-runtime.js
bash -n install.sh scripts/deploy.sh scripts/sync-from-source.sh scripts/validate.sh
python3 -m py_compile scripts/patch_nginx_conf.py

if [[ -n "${VALIDATE_NGINX_CONF:-}" ]]; then
  bash "${REPO_ROOT}/scripts/deploy.sh" \
    --dry-run \
    --nginx-conf "${VALIDATE_NGINX_CONF}" \
    --install-root "${VALIDATE_INSTALL_ROOT:-/tmp/coder-simplified-chinese-validate}" >/dev/null
fi

echo "validation passed"
