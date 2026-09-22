#!/usr/bin/env bash
# check-docker.sh — report whether Docker is installed and running.
# Used by the Smyth setup wizard's "Optional Services" step.
#
# Output: a single line of JSON, e.g.
#   {"installed":true,"running":true,"compose":true,"version":"27.3.1"}

installed=false
running=false
compose=false
version=""

if command -v docker >/dev/null 2>&1; then
  installed=true
  version="$(docker --version 2>/dev/null | sed -E 's/^Docker version ([^,]+).*/\1/')"
  if docker info >/dev/null 2>&1; then
    running=true
  fi
  if docker compose version >/dev/null 2>&1; then
    compose=true
  fi
fi

printf '{"installed":%s,"running":%s,"compose":%s,"version":"%s"}\n' \
  "$installed" "$running" "$compose" "$version"
