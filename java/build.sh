#!/usr/bin/env bash
# FreeTranslator v2.1 – Java build + indítás
# Követelmény: Java 21+ (VirtualThreads, Records)
set -euo pipefail

SRC="src/main/java/freetranslator"
OUT="out"

echo "=== FreeTranslator v2.1 Java Build ==="
mkdir -p "$OUT"

echo "▶ Fordítás..."
javac -source 21 -target 21 -d "$OUT" \
  "$SRC/MathEngine.java" \
  "$SRC/DecisionMatrix.java" \
  "$SRC/CortexScheduler.java" \
  "$SRC/OllamaClient.java" \
  "$SRC/FreeTranslatorServer.java"

echo "✓ Sikeres fordítás → $OUT/"
echo ""
echo "▶ Indítás (PORT=${PORT:-3001})..."
java -cp "$OUT" freetranslator.FreeTranslatorServer
