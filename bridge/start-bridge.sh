#!/bin/sh
# Starts OneClient Bridge (macOS / Linux). Needs Node.js 18 or newer: https://nodejs.org
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install the LTS version from https://nodejs.org and run this again."
  exit 1
fi
exec node ./oneclient-bridge.js "$@"
