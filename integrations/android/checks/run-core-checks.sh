#!/usr/bin/env bash
set -euo pipefail
connector_root="$(cd "$(dirname "$0")/.." && pwd)"
check_dir="$(mktemp -d)"
trap 'rm -rf "$check_dir"' EXIT
source_dir="$connector_root/app/src/main/java/ai/homecare/connector"
if command -v javac >/dev/null 2>&1; then
    compiler=(javac)
else
    compiler=(java -m jdk.compiler/com.sun.tools.javac.Main)
fi
"${compiler[@]}" -d "$check_dir" "$source_dir/ServerOrigin.java" "$source_dir/SleepIntervals.java" "$connector_root/checks/CoreChecks.java"
java -cp "$check_dir" ai.homecare.connector.CoreChecks
