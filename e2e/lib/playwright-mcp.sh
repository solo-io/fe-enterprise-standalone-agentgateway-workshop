#!/usr/bin/env bash
# playwright-mcp.sh: the Playwright MCP server for adapt's learning phase. .mcp.json starts it.
#
# The browser runs headless in a container that joins the network namespace of the learning gateway
# (Compose project agw-e2e-learn). Inside that namespace http://localhost:15000 is the learning gateway,
# and the user's own gateway on the host is out of reach. --allowed-origins blocks every other origin.
# With no learning gateway running, the script exits 1 and says what to do.
#
#   playwright-mcp.sh           start the server on stdio
#   playwright-mcp.sh --image   print the pinned image (detect-env.sh reads it)
#
# E2E_DOCKER replaces docker (tests).
set -euo pipefail

IMAGE="mcr.microsoft.com/playwright/mcp:v0.0.85"
NETNS="agw-e2e-learn-netns-1"
ORIGIN="http://localhost:15000"
DOCKER="${E2E_DOCKER:-docker}"

if [ "${1:-}" = --image ]; then echo "$IMAGE"; exit 0; fi

if [ "$("$DOCKER" inspect -f '{{.State.Running}}' "$NETNS" 2>/dev/null)" != true ]; then
  echo "playwright-mcp: no learning gateway is running (container $NETNS). Run /adapt-lab: its learning phase starts the gateway and then asks you to reconnect this server with /mcp." >&2
  exit 1
fi

# The image's entrypoint already runs tini and headless Chromium with --no-sandbox.
exec "$DOCKER" run -i --rm --network "container:$NETNS" "$IMAGE" --allowed-origins "$ORIGIN"
