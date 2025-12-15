#!/bin/bash
# Push to GitHub and Deploy to PythonAnywhere
# Run this script from your local machine

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     PAYROLL SYSTEM v6.0.1 - PUSH & DEPLOY SCRIPT            ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Push to GitHub
echo "📤 Step 1: Pushing to GitHub..."
echo "----------------------------------------"
cd ~/payroll-repo || exit 1

git status
echo ""
read -p "Press ENTER to push to GitHub (or Ctrl+C to cancel)..."

if git push origin main; then
    echo "✅ Successfully pushed to GitHub!"
else
    echo "❌ Failed to push to GitHub. Check your credentials."
    exit 1
fi

echo ""
echo "✅ PUSH COMPLETE!"
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              NEXT: DEPLOY TO PYTHONANYWHERE                  ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "📋 DEPLOYMENT CHECKLIST:"
echo ""
echo "1. Go to: https://github.com/kidevu123/payroll"
echo "2. Download these files:"
echo "   • version.py"
echo "   • simple_app.py"
echo "   • template_helpers.py (optional)"
echo ""
echo "3. Upload to PythonAnywhere:"
echo "   → Files tab → /home/YOUR_USERNAME/payroll/"
echo ""
echo "4. In PythonAnywhere Bash console, test:"
echo "   cd /home/YOUR_USERNAME/payroll"
echo "   python3 -m py_compile simple_app.py version.py"
echo ""
echo "5. Reload web app:"
echo "   → Web tab → Click 'Reload' button"
echo ""
echo "6. Verify deployment:"
echo "   → Visit your app URL"
echo "   → Check version badge shows v6.0.1"
echo "   → Test CSV upload and employee selection"
echo ""
echo "📚 Full instructions: See DEPLOYMENT_GUIDE.md"
echo ""




