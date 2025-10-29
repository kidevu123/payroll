#!/bin/bash
# AUTO-FIX SCRIPT FOR PYTHONANYWHERE
# Run this on PythonAnywhere to fix the app

cd /home/kidevu/payroll
git pull origin main
find . -name "*.pyc" -delete
find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true

echo "✅ Code updated from GitHub"
echo "✅ Cache cleared"
echo ""
echo "NOW: Go to PythonAnywhere Web tab and click RELOAD"
echo "The app will work after reload"

