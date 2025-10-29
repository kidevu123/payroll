#!/bin/bash
# FORCE FIX - Discards ALL local changes and pulls from GitHub
cd /home/kidevu/payroll
git fetch origin
git reset --hard origin/main
find . -name "*.pyc" -delete
find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
echo "✅ FORCED UPDATE COMPLETE"
echo "✅ All local changes discarded"
echo "✅ Code pulled from GitHub"
echo "✅ Cache cleared"
echo ""
echo "NOW RELOAD WEB APP IN PYTHONANYWHERE WEB TAB"

