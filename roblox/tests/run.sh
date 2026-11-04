#!/bin/sh
# Runs the pure-Luau specs against src/shared/Broadcast.luau with a stub Config.
set -e
cd "$(dirname "$0")/.."
tmp="$(mktemp -t tdtv).luau"
{
  echo 'local Config = { UtcOffsetMinutes = -300, ObserveUSDaylightSaving = true }'
  echo 'local script = { Parent = { Config = Config } }'
  echo 'local function require(m) return m end'
  echo 'local Broadcast = (function()'
  sed -e 's/^export type/type/' -e 's/^--!strict//' src/shared/Broadcast.luau
  echo 'end)()'
  cat tests/broadcast.spec.luau
} > "$tmp"
luau "$tmp"
rm -f "$tmp"
