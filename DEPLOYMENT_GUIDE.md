# Deployment Guide - Payroll Management System v6.0.1

## Overview
This guide covers deployment of the enhanced payroll management system with:
- Centralized version management
- Modern unified UI theme
- Employee exclusion feature
- Version display throughout the application

## Critical Changes Made

### 1. Version Management System
**New Files:**
- `version.py` - Centralized version management module

**Modified Files:**
- `simple_app.py` - Now imports and uses centralized version
- `README.md` - References version.py for version information

**Benefits:**
- Single source of truth for version numbers
- Easy version incrementing for future releases
- Consistent version display across all pages

### 2. UI Uniformity & Modernization
**Modified Files:**
- `simple_app.py` - Updated employee confirmation page with modern theme
- Added footer with version info to login page
- Enhanced employee selection page styling

**New Files:**
- `template_helpers.py` - Unified CSS framework and HTML components (optional helper module)

**Features:**
- Consistent color scheme using CSS variables
- Gradient backgrounds and modern card designs
- Responsive design for mobile and desktop
- Smooth transitions and hover effects
- Version badge in header, version info in footer

### 3. Employee Exclusion Feature
**Status:** Already implemented and functional

**Modified Files:**
- `simple_app.py` - Enhanced UI for employee selection page

**Workflow:**
1. User uploads CSV timesheet
2. System validates file format
3. **NEW:** Employee confirmation page shows all employees with checkboxes
4. User can uncheck employees to exclude from processing
5. System processes only selected employees
6. Reports generated only for included employees

**Routes:**
- `/confirm_employees` - Shows employee selection page
- `/confirm_and_process` - Stores selected employee IDs in session
- `/process_confirmed` - Processes payroll for selected employees only

## Deployment Steps for PythonAnywhere

### Step 1: Backup Current Production
```bash
# On PythonAnywhere, create backup
cd /home/YOUR_USERNAME/payroll
cp simple_app.py simple_app.py.backup.$(date +%Y%m%d)
```

### Step 2: Upload New Files
Upload the following files to `/home/YOUR_USERNAME/payroll/`:
- `version.py` (NEW - required)
- `simple_app.py` (MODIFIED - required)
- `template_helpers.py` (NEW - optional, for future use)
- `README.md` (MODIFIED - documentation only)

### Step 3: Verify File Permissions
```bash
cd /home/YOUR_USERNAME/payroll
chmod 644 version.py
chmod 644 simple_app.py
chmod 644 template_helpers.py
```

### Step 4: Test Python Syntax
```bash
python3 -m py_compile simple_app.py
python3 -m py_compile version.py
```

### Step 5: Update WSGI Configuration
The WSGI file should already be configured correctly. No changes needed unless you see import errors.

If you encounter issues, verify your WSGI file imports:
```python
import sys
import os

# Add project directory to path
project_home = '/home/YOUR_USERNAME/payroll'
if project_home not in sys.path:
    sys.path = [project_home] + sys.path

# Import the Flask app
from simple_app import app as application
```

### Step 6: Reload Web App
1. Go to PythonAnywhere Web tab
2. Click the "Reload" button
3. Wait for the reload to complete (green checkmark)

### Step 7: Verify Deployment
1. Open your app URL in a browser
2. Check login page - should show version badge in header
3. Log in with your credentials
4. Upload a test CSV file
5. Verify employee selection page appears with modern styling
6. Check that version info appears in footer
7. Complete a test payroll run
8. Verify reports generate correctly

## Testing Checklist

### Pre-Deployment Tests
- [ ] Python syntax check passed (`py_compile`)
- [ ] version.py runs independently
- [ ] All required files present

### Post-Deployment Tests
- [ ] Login page displays with version badge
- [ ] Can log in successfully
- [ ] Upload page loads correctly
- [ ] CSV file upload works
- [ ] Employee selection page appears with checkboxes
- [ ] Can select/deselect employees
- [ ] Payroll processes correctly for selected employees only
- [ ] Reports generate successfully
- [ ] Reports contain only selected employees
- [ ] Download links work
- [ ] Version displayed consistently across all pages
- [ ] Footer with version info visible
- [ ] Zoho Books integration still works (if used)
- [ ] No JavaScript console errors
- [ ] Responsive design works on mobile

## Rollback Procedure

If issues occur, immediately rollback:

```bash
cd /home/YOUR_USERNAME/payroll
# Restore backup
cp simple_app.py.backup.YYYYMMDD simple_app.py
# Remove new file that might cause issues
rm version.py
# Reload web app
```

Then click Reload on PythonAnywhere Web tab.

## New Features Usage

### Employee Exclusion Feature

**Use Case:** Exclude specific employees from a payroll run (e.g., employee on leave, already paid separately, etc.)

**Steps:**
1. Upload CSV timesheet as normal
2. System shows "Confirm Employees for Payroll" page
3. All employees are checked by default
4. Uncheck any employees you want to exclude
5. Click "Confirm & Process"
6. System processes only selected employees
7. Reports contain only selected employees

**Important Notes:**
- Exclusion is temporary (session-based)
- Each upload shows fresh employee list
- No permanent exclusion settings
- Can exclude any number of employees
- Must select at least one employee

### Version Display

**Locations:**
- Login page: Version badge in header
- All main pages: Version badge in header
- Footer on key pages: "Payroll Management System v6.0.1"

**Future Version Updates:**
Edit `version.py` only:
```python
__version__ = "6.0.2"  # Update this line
```

## Troubleshooting

### Import Error: No module named 'version'
**Cause:** version.py not uploaded or in wrong directory  
**Fix:** Upload version.py to same directory as simple_app.py

### Version not displaying
**Cause:** Old browser cache  
**Fix:** Hard refresh (Ctrl+F5 or Cmd+Shift+R)

### Employee selection page not appearing
**Cause:** Session storage issue  
**Fix:** Clear browser cookies and log in again

### Payroll calculations incorrect
**Cause:** Should not happen - calculations unchanged  
**Fix:** Immediately rollback and contact developer

### Reports not generating
**Cause:** Permissions or directory issue  
**Fix:** Check static/reports directory exists and is writable

## Performance Notes

- No performance impact from version management system
- Employee selection adds one extra page view
- Session storage is lightweight
- All existing functionality preserved
- No database changes required
- No API changes

## Security Notes

- All existing security measures maintained
- Session-based employee exclusion (no persistent storage)
- No new external dependencies
- No changes to authentication
- No changes to Zoho Books integration
- Version information is not sensitive data

## Support

For issues or questions:
1. Check error logs in PythonAnywhere
2. Verify all files uploaded correctly
3. Test with backup CSV file
4. Review this deployment guide
5. Use rollback procedure if critical

## Version History

### v6.0.1 (2025-10-28)
- Centralized version management system
- UI uniformity and modernization
- Enhanced employee exclusion feature UI
- Footer with version info across pages
- Improved responsive design

### v6.0.0 (2024)
- Zoho Books Integration
- Dual Company Support
- Smart Date Calculation
- Duplicate Prevention
- Performance Optimization
- Modern UI with gradients

## Success Criteria

Deployment is successful when:
1. ✓ App loads without errors
2. ✓ Version displays correctly
3. ✓ Can upload and process CSV
4. ✓ Employee selection works
5. ✓ Reports generate correctly
6. ✓ All existing features work
7. ✓ No calculation errors
8. ✓ No user complaints

## Final Notes

- This is a **production-safe update**
- All existing functionality preserved
- No breaking changes
- Backward compatible
- Can rollback instantly if needed
- Thoroughly tested locally

**Deploy with confidence!**

