#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

SERVER_BEGIN = "# BEGIN Coder Simplified Chinese server block"
SERVER_END = "# END Coder Simplified Chinese server block"
LOCATION_BEGIN = "# BEGIN Coder Simplified Chinese location block"
LOCATION_END = "# END Coder Simplified Chinese location block"


def die(message: str) -> None:
    print(f"[coder-sc] ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def find_matching_brace(text: str, open_brace_index: int) -> int:
    depth = 0
    for index in range(open_brace_index, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
    die("failed to match braces while patching nginx config")


def replace_managed_block(text: str, begin: str, end: str, new_block: str) -> str:
    pattern = re.compile(rf"(?ms)^[ \t]*{re.escape(begin)}.*?^[ \t]*{re.escape(end)}\n?")
    if pattern.search(text):
        return pattern.sub(new_block + "\n", text, count=1)
    return text


def locate_target_server(text: str) -> tuple[int, int]:
    for match in re.finditer(r"(?m)^([ \t]*)server\s*\{", text):
        open_brace = text.find("{", match.start())
        close_brace = find_matching_brace(text, open_brace)
        block = text[match.start() : close_brace + 1]
        if "proxy_pass" in block and re.search(r"(?m)^[ \t]*location\s+/\s*\{", block):
            return match.start(), close_brace + 1
    die("unable to find the nginx server block that proxies Coder")


def locate_target_location(text: str, server_start: int, server_end: int) -> tuple[int, int]:
    server_block = text[server_start:server_end]
    for match in re.finditer(r"(?m)^([ \t]*)location\s+/\s*\{", server_block):
        absolute_start = server_start + match.start()
        open_brace = text.find("{", absolute_start)
        close_brace = find_matching_brace(text, open_brace)
        block = text[absolute_start : close_brace + 1]
        if "proxy_pass" in block:
            return absolute_start, close_brace + 1
    die("unable to find the nginx location / block that proxies Coder")


def main() -> None:
    target = os.environ.get("NGINX_CONF_TARGET")
    install_root = os.environ.get("INSTALL_ROOT_TARGET")
    asset_route = os.environ.get("ASSET_ROUTE_TARGET")
    if not target or not install_root or not asset_route:
        die("missing patcher environment variables")

    conf_path = Path(target)
    text = conf_path.read_text(encoding="utf-8")

    server_indent = "    "
    location_indent = "        "

    server_block = (
        f"{server_indent}{SERVER_BEGIN}\n"
        f"{server_indent}location ^~ {asset_route} {{\n"
        f"{server_indent}    alias {install_root}/i18n/;\n"
        f'{server_indent}    add_header Cache-Control "no-store";\n'
        f"{server_indent}}}\n"
        f"{server_indent}{SERVER_END}"
    )
    location_block = (
        f"{location_indent}{LOCATION_BEGIN}\n"
        f'{location_indent}proxy_set_header Accept-Encoding "";\n'
        f"{location_indent}sub_filter_types text/html;\n"
        f"{location_indent}sub_filter_once on;\n"
        f"{location_indent}sub_filter '</head>' '<script src=\"{asset_route}coder-i18n-runtime.js\" defer></script></head>';\n"
        f"{location_indent}{LOCATION_END}"
    )

    updated = replace_managed_block(text, LOCATION_BEGIN, LOCATION_END, location_block)
    updated = replace_managed_block(updated, SERVER_BEGIN, SERVER_END, server_block)

    if SERVER_BEGIN not in updated or SERVER_END not in updated:
        server_start, server_end = locate_target_server(updated)
        updated = updated[: server_end - 1] + "\n" + server_block + "\n" + updated[server_end - 1 :]

    if LOCATION_BEGIN not in updated or LOCATION_END not in updated:
        server_start, server_end = locate_target_server(updated)
        _, location_end = locate_target_location(updated, server_start, server_end)
        updated = updated[: location_end - 1] + "\n" + location_block + "\n" + updated[location_end - 1 :]

    conf_path.write_text(updated, encoding="utf-8")


if __name__ == "__main__":
    main()
