#!/bin/bash
# SUPER FORCE FIX - Remove __pycache__ completely and pull

cd /home/kidevu/payroll || exit 1

echo "Removing __pycache__ directories..."
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
rm -rf __pycache__ 2>/dev/null || true

echo "Force pulling from GitHub..."
git fetch origin
git reset --hard origin/main
git pull origin main

echo "Clearing cache again..."
find . -name "*.pyc" -delete 2>/dev/null || true

echo ""
echo "✅ SUPER FORCE FIX COMPLETE"
echo "✅ __pycache__ removed"
echo "✅ Latest code pulled"
echo ""
echo "NOW RELOAD WEB APP IN PYTHONANYWHERE WEB TAB"

