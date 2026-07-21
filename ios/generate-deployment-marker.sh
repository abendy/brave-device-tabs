#!/usr/bin/env bash
# Writes a random word into a gitignored Swift file on every build, shown in
# both the app and the share extension - lets you confirm at a glance that
# what's on screen is actually today's build, not a stale install.
set -euo pipefail
cd "$(dirname "$0")"

WORDS=(amber birch cedar delta ember fable glacier harbor ivory jasper kestrel lumen maple nectar opal pebble quartz raven sable timber umber velvet willow xenon yarrow zephyr)
WORD="${WORDS[$RANDOM % ${#WORDS[@]}]}"

cat > Shared/DeploymentMarker.swift <<EOF
// Generated at build time by generate-deployment-marker.sh - gitignored,
// regenerated on every run-device.sh / run-simulator.sh invocation.
enum DeploymentMarker {
    static let word = "$WORD"
}
EOF

echo "Deployment marker: $WORD"
