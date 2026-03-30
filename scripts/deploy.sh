#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${REPO_ROOT}/manifest.env"

NGINX_CONF=""
INSTALL_ROOT="${DEFAULT_INSTALL_ROOT}"
ASSET_ROUTE="${DEFAULT_ASSET_ROUTE}"
CODER_CONTAINER=""
CODER_BINARY=""
SKIP_RELOAD="false"
DRY_RUN="false"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --nginx-conf PATH        Path to the nginx config that proxies Coder.
  --install-root PATH      Where the language-pack assets should be installed.
  --asset-route PATH       Public route prefix for the injected assets.
  --coder-container NAME   Explicit Coder container name for version detection.
  --coder-binary PATH      Explicit coder binary for version detection.
  --skip-reload            Do not reload nginx after a successful install.
  --dry-run                Patch a temporary copy of the nginx config only.
  --help                   Show this help message.

Environment:
  CODER_SC_NGINX_SEARCH_ROOTS   Optional extra nginx search roots, separated by ":".
EOF
}

log() {
  printf '[coder-sc] %s\n' "$*"
}

die() {
  printf '[coder-sc] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --nginx-conf)
        NGINX_CONF="${2:-}"
        shift 2
        ;;
      --install-root)
        INSTALL_ROOT="${2:-}"
        shift 2
        ;;
      --asset-route)
        ASSET_ROUTE="${2:-}"
        shift 2
        ;;
      --coder-container)
        CODER_CONTAINER="${2:-}"
        shift 2
        ;;
      --coder-binary)
        CODER_BINARY="${2:-}"
        shift 2
        ;;
      --skip-reload)
        SKIP_RELOAD="true"
        shift
        ;;
      --dry-run)
        DRY_RUN="true"
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "unknown argument: $1"
        ;;
    esac
  done
}

normalize_asset_route() {
  [[ -n "${ASSET_ROUTE}" ]] || die "--asset-route cannot be empty"
  [[ "${ASSET_ROUTE}" == /* ]] || ASSET_ROUTE="/${ASSET_ROUTE}"
  [[ "${ASSET_ROUTE}" == */ ]] || ASSET_ROUTE="${ASSET_ROUTE}/"
}

detect_coder_container() {
  if [[ -n "${CODER_CONTAINER}" ]]; then
    command -v docker >/dev/null 2>&1 || die "docker is required when --coder-container is used"
    echo "${CODER_CONTAINER}"
    return 0
  fi

  command -v docker >/dev/null 2>&1 || return 1

  local -a containers=()

  mapfile -t containers < <(
    docker ps --format '{{.Names}}\t{{.Image}}' \
      | awk -F '\t' 'tolower($2) ~ /coder\/coder/ { print $1 }'
  )

  if [[ ${#containers[@]} -eq 1 ]]; then
    echo "${containers[0]}"
    return 0
  fi

  if [[ ${#containers[@]} -gt 1 ]]; then
    printf '%s\n' "${containers[@]}" >&2
    return 2
  fi

  return 1
}

parse_coder_build() {
  local raw="$1"
  printf '%s\n' "${raw}" | sed -nE 's/.*Coder (v[0-9]+\.[0-9]+\.[0-9]+\+[[:alnum:]]+).*/\1/p' | head -n1
}

parse_coder_commit() {
  local raw="$1"
  printf '%s\n' "${raw}" | sed -nE 's#.*commit/([0-9a-f]{40}).*#\1#p' | head -n1
}

detect_coder_output() {
  local output=""
  local container_name=""
  local container_status=0

  container_name="$(detect_coder_container)" || container_status=$?
  if [[ ${container_status} -eq 2 ]]; then
    die "multiple Coder containers detected. Please pass --coder-container."
  fi

  if [[ ${container_status} -eq 0 && -n "${container_name}" ]]; then
    log "detected Coder container: ${container_name}"
    if [[ -n "${CODER_CONTAINER}" ]]; then
      output="$(docker exec "${container_name}" coder version 2>/dev/null)" \
        || die "failed to run 'coder version' inside container: ${container_name}"
    else
      output="$(docker exec "${container_name}" coder version 2>/dev/null || true)"
    fi
  fi

  if [[ -n "${CODER_CONTAINER}" ]]; then
    [[ -n "${output}" ]] || die "unable to detect Coder version from container: ${CODER_CONTAINER}"
  fi

  if [[ -z "${output}" && -n "${CODER_BINARY}" ]]; then
    [[ -x "${CODER_BINARY}" ]] || die "coder binary is not executable: ${CODER_BINARY}"
    output="$("${CODER_BINARY}" version 2>/dev/null)" || die "failed to run coder binary: ${CODER_BINARY}"
  fi

  if [[ -z "${output}" && -x "$(command -v coder 2>/dev/null || true)" ]]; then
    output="$(coder version 2>/dev/null || true)"
  fi

  [[ -n "${output}" ]] || die "unable to detect Coder version. Pass --coder-container or --coder-binary."
  printf '%s\n' "${output}"
}

parse_coder_version() {
  local raw="$1"
  local version
  version="$(printf '%s\n' "${raw}" | sed -nE 's/.*Coder v([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' | head -n1)"
  [[ -n "${version}" ]] || die "unable to parse Coder version from output: ${raw}"
  printf '%s\n' "${version}"
}

detect_nginx_conf() {
  if [[ -n "${NGINX_CONF}" ]]; then
    [[ -f "${NGINX_CONF}" ]] || die "nginx config not found: ${NGINX_CONF}"
    printf '%s\n' "${NGINX_CONF}"
    return 0
  fi

  local -a search_roots=(
    /etc/nginx
    /usr/local/etc/nginx
  )
  local -a extra_roots=()
  local -a candidates=()
  local root=""

  if [[ -n "${CODER_SC_NGINX_SEARCH_ROOTS:-}" ]]; then
    IFS=':' read -r -a extra_roots <<<"${CODER_SC_NGINX_SEARCH_ROOTS}"
    search_roots+=("${extra_roots[@]}")
  fi

  for root in "${search_roots[@]}"; do
    [[ -d "${root}" ]] || continue
    while IFS= read -r file; do
      candidates+=("${file}")
    done < <(find "${root}" -type f -name '*.conf' -print 2>/dev/null)
  done

  mapfile -t candidates < <(
    printf '%s\n' "${candidates[@]}" \
      | sort -u \
      | while IFS= read -r file; do
          grep -Eq 'server_name .*coder|proxy_pass .*127\.0\.0\.1:.*7080|proxy_pass .*coder' "${file}" && printf '%s\n' "${file}"
        done
  )

  if [[ ${#candidates[@]} -eq 1 ]]; then
    printf '%s\n' "${candidates[0]}"
    return 0
  fi

  if [[ ${#candidates[@]} -eq 0 ]]; then
    die "unable to auto-detect the nginx config that proxies Coder. Pass --nginx-conf."
  fi

  die "multiple nginx config candidates found: ${candidates[*]}. Pass --nginx-conf."
}

install_assets() {
  local target_root="$1"
  mkdir -p "${target_root}/i18n/coder-locales"
  cp "${REPO_ROOT}/assets/i18n/coder-i18n-runtime.js" "${target_root}/i18n/coder-i18n-runtime.js"
  cp "${REPO_ROOT}/assets/i18n/coder-locales/en-US.json" "${target_root}/i18n/coder-locales/en-US.json"
  cp "${REPO_ROOT}/assets/i18n/coder-locales/zh-CN.json" "${target_root}/i18n/coder-locales/zh-CN.json"
}

patch_nginx_conf() {
  local target_conf="$1"
  local conf_for_patch="${target_conf}"
  local preview_conf=""

  if [[ "${DRY_RUN}" == "true" ]]; then
    preview_conf="$(mktemp)"
    cp "${target_conf}" "${preview_conf}"
    conf_for_patch="${preview_conf}"
  fi

  NGINX_CONF_TARGET="${conf_for_patch}" \
  INSTALL_ROOT_TARGET="${INSTALL_ROOT}" \
  ASSET_ROUTE_TARGET="${ASSET_ROUTE}" \
  python3 "${SCRIPT_DIR}/patch_nginx_conf.py"

  if [[ "${DRY_RUN}" == "true" ]]; then
    log "dry-run patched config: ${preview_conf}"
  else
    printf '%s\n' "${conf_for_patch}"
  fi
}

backup_path_for() {
  local target_conf="$1"
  printf '%s.bak.%s\n' "${target_conf}" "$(date +%Y%m%d%H%M%S)"
}

reload_nginx() {
  if [[ "${SKIP_RELOAD}" == "true" ]]; then
    log "skipping nginx reload by request"
    return 0
  fi

  if command -v nginx >/dev/null 2>&1; then
    nginx -t
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
      systemctl reload nginx
    else
      nginx -s reload
    fi
    log "nginx reloaded"
    return 0
  fi

  log "nginx binary not found; skipping reload"
}

main() {
  local detected_output=""
  local detected_version=""
  local detected_build=""
  local detected_commit=""
  local resolved_nginx_conf=""
  local backup_path=""

  parse_args "$@"
  normalize_asset_route

  require_command python3

  detected_output="$(detect_coder_output)"
  detected_version="$(parse_coder_version "${detected_output}")"
  detected_build="$(parse_coder_build "${detected_output}")"
  detected_commit="$(parse_coder_commit "${detected_output}")"

  log "detected Coder version: ${detected_version}"
  [[ -n "${detected_build}" ]] && log "detected Coder build: ${detected_build}"
  [[ -n "${detected_commit}" ]] && log "detected Coder commit: ${detected_commit}"

  if [[ "${detected_version}" != "${SUPPORTED_CODER_VERSION}" ]]; then
    die "unsupported Coder version: ${detected_version}. This package only supports ${SUPPORTED_CODER_VERSION_FULL}."
  fi
  if [[ -n "${SUPPORTED_CODER_VERSION_FULL}" && -n "${detected_build}" && "${detected_build}" != "${SUPPORTED_CODER_VERSION_FULL}" ]]; then
    die "unsupported Coder build: ${detected_build}. This package only supports ${SUPPORTED_CODER_VERSION_FULL}."
  fi
  if [[ -n "${SUPPORTED_CODER_COMMIT}" && -n "${detected_commit}" && "${detected_commit}" != "${SUPPORTED_CODER_COMMIT}" ]]; then
    die "unsupported Coder commit: ${detected_commit}. This package only supports ${SUPPORTED_CODER_COMMIT}."
  fi

  resolved_nginx_conf="$(detect_nginx_conf)"
  log "using nginx config: ${resolved_nginx_conf}"

  if [[ "${DRY_RUN}" == "true" ]]; then
    patch_nginx_conf "${resolved_nginx_conf}" >/dev/null
    log "dry-run completed successfully"
    return 0
  fi

  [[ "$(id -u)" -eq 0 ]] || die "run this installer as root so it can write ${INSTALL_ROOT} and patch nginx"

  install_assets "${INSTALL_ROOT}"
  backup_path="$(backup_path_for "${resolved_nginx_conf}")"
  cp "${resolved_nginx_conf}" "${backup_path}"
  log "backup written to ${backup_path}"

  if ! patch_nginx_conf "${resolved_nginx_conf}" >/dev/null; then
    cp "${backup_path}" "${resolved_nginx_conf}"
    die "failed to patch nginx config; restored backup"
  fi

  if ! reload_nginx; then
    cp "${backup_path}" "${resolved_nginx_conf}"
    die "nginx validation/reload failed; restored backup"
  fi

  log "installation completed successfully"
  log "assets installed at ${INSTALL_ROOT}/i18n"
}

main "$@"
