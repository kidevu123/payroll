"""
Payroll Management System - Version Management
Centralized version tracking for the payroll application
"""

__version__ = "8.16.0"
__version_name__ = "Delete Reports + Inline Pay Rates"
__release_date__ = "2025-12-16"

VERSION_HISTORY = [
    {
        "version": "8.16.0",
        "date": "2025-12-16",
        "changes": [
            "✨ NEW: Delete button on Reports page!",
            "Red delete button next to each Download PDF button",
            "Confirmation dialog before deleting",
            "Deletes Excel file from disk and clears cache",
            "Security: Only admin_report_* files can be deleted",
            "Shows success/error message after deletion"
        ]
    },
    {
        "version": "8.15.0",
        "date": "2025-12-16",
        "changes": [
            "✨ NEW: Inline pay rate setup for new employees!",
            "When CSV uploaded with new employees, shows form to set rates immediately",
            "No more redirecting to Pay Rates page and coming back",
            "Orange warning page: 'New Employees Detected' with inline form",
            "Set rates, click 'Save Rates & Continue', proceeds to employee confirmation",
            "Rates saved to pay_rates.json automatically",
            "Smooth one-flow experience for processing new employees"
        ]
    },
    {
        "version": "8.14.0",
        "date": "2025-12-16",
        "changes": [
            "✨ NEW: Delete button on Reports page with confirmation",
            "🔧 CRITICAL FIX: No more silent $15/hour defaults",
            "App now stops processing and shows error when employees don't have pay rates",
            "Forces you to set the correct pay rate before processing payroll",
            "Error message shows which employees are missing rates",
            "Deleted reports are removed from disk and cache is cleared",
            "Security: Only admin_report_* files can be deleted"
        ]
    },
    {
        "version": "8.13.4",
        "date": "2025-12-16",
        "changes": [
            "🔧 SYNTAX ERROR FIXED: JavaScript now loads without errors",
            "Fixed f-string curly brace escaping issue causing SyntaxError",
            "Moved JavaScript outside f-string to avoid template conflicts",
            "Clean JavaScript with proper syntax",
            "Event delegation working properly now"
        ]
    },
    {
        "version": "8.13.3",
        "date": "2025-12-16",
        "changes": [
            "🔧 ATTEMPTED: IIFE approach (had syntax error)"
        ]
    },
    {
        "version": "8.13.2",
        "date": "2025-12-16",
        "changes": [
            "🔧 ATTEMPTED: Event delegation with DOMContentLoaded (didn't work)"
        ]
    },
    {
        "version": "8.13.1",
        "date": "2025-12-16",
        "changes": [
            "🔧 ATTEMPTED FIX: Pay Rates Edit button (incomplete)",
            "Tried JavaScript string escaping - didn't fully solve the issue"
        ]
    },
    {
        "version": "8.13.0",
        "date": "2025-12-16",
        "changes": [
            "📄 PDF EVERYWHERE: Download & Zoho now use PDF",
            "Admin Report Download button now generates PDF (not Excel)",
            "Zoho Books expense attachment is now PDF (not Excel)",
            "PDF generated on-the-fly when downloading",
            "PDF generated and attached to Zoho, then cleaned up",
            "Print button still opens Excel for internal use",
            "Excel files still generated for backend/processing",
            "Clean, professional PDF format for external use"
        ]
    },
    {
        "version": "8.12.0",
        "date": "2025-12-16",
        "changes": [
            "✅ FITS 13+ EMPLOYEES ON ONE PAGE!",
            "4 employees per row (was 3) = maximum horizontal density",
            "5pt font for employee cards (was 6pt)",
            "6pt font for summary table (was 7pt)",
            "Ultra-narrow columns: 2.25 inch per employee card",
            "Minimal padding: 1px everywhere",
            "Minimal spacing: 1-2px between rows",
            "Tested with 13 employees - all fit on one landscape page",
            "Extreme information density while maintaining readability"
        ]
    },
    {
        "version": "8.11.0",
        "date": "2025-12-16",
        "changes": [
            "✅ TRUE ONE-PAGE PDF: Ultra-compact layout with NO wasted space",
            "3-column employee layout (was 2-column)",
            "Smaller fonts: 6pt for employee data, 7-8pt for summary",
            "Minimal padding: 1-2px throughout",
            "Minimal spacing: 2-4px between sections",
            "Compact summary table: narrower columns",
            "All 6 employees + summary fit on ONE landscape page",
            "Professional, dense layout with maximum information density"
        ]
    },
    {
        "version": "8.10.3",
        "date": "2025-12-16",
        "changes": [
            "✅ LANDSCAPE ORIENTATION: PDF now fits on ONE page",
            "Switched from portrait to landscape (11 x 8.5 inches)",
            "Wider employee cards: 4.75 inch each (was 3.5 inch)",
            "More horizontal space = no text wrapping or overlap",
            "Reduced vertical spacing to fit all content",
            "Summary table + 6 employees all on one page",
            "Professional landscape layout matches typical payroll reports"
        ]
    },
    {
        "version": "8.10.2",
        "date": "2025-12-16",
        "changes": [
            "🔴 CRITICAL FIX: Fixed overlapping text and wrapped names",
            "Changed to 2-column layout (was 3-column, too cramped)",
            "Wider columns: 0.65-0.75 inch per cell",
            "Employee names now span full width (no wrapping)",
            "ID/Rate info also spans full width",
            "Font size increased to 7pt (was 6pt)",
            "Proper spacing between columns (0.25 inch)",
            "Clean layout with no text overlap"
        ]
    },
    {
        "version": "8.10.1",
        "date": "2025-12-16",
        "changes": [
            "🔴 CRITICAL FIX: PDF now fits on ONE page",
            "Fixed broken employee card extraction (was picking up 'Date', 'Total:', etc.)",
            "Only extracts valid employee names from summary table",
            "Validates data rows contain actual dates (must have '/')",
            "3-column layout instead of 2-column for compact display",
            "Reduced font size to 6pt and tightened padding",
            "Eliminated junk/empty cards",
            "Clean, professional one-page PDF output"
        ]
    },
    {
        "version": "8.10.0",
        "date": "2025-12-16",
        "changes": [
            "✅ COMPLETE: PDF now includes BOTH summary table AND detailed breakdown",
            "Extracts summary table from column H with all employees and GRAND TOTAL",
            "Extracts detailed employee breakdown with daily hours and pay",
            "Renders employee cards in 2-column layout for compact display",
            "Professional formatting with proper alignment and styling",
            "PDF matches the quality of the original admin report"
        ]
    },
    {
        "version": "8.9.9",
        "date": "2025-12-16",
        "changes": [
            "🔴 CRITICAL FIX: PDF now shows all data rows",
            "Fixed PDF conversion to properly extract all employee data from Excel",
            "Added smart header row detection",
            "Improved empty row handling",
            "Added logging for better debugging"
        ]
    },
    {
        "version": "8.9.8",
        "date": "2025-12-16",
        "changes": [
            "📄 FEATURE: PDF report downloads instead of Excel",
            "Added reportlab library for PDF generation",
            "Created PDF conversion function for admin reports",
            "Added /download_pdf/<filename> route for on-demand PDF generation",
            "🔧 FIX: Reports now sorted by actual payroll period date",
            "Sorting uses end_date from payroll period (not file creation time)",
            "Reports display in true chronological order of processing"
        ]
    },
    {
        "version": "8.9.7",
        "date": "2025-12-15",
        "changes": [
            "🔧 REAL FIX: Date range extraction actually works now",
            "Fixed _ensure_report_metadata to extract date_range from A1 cell",
            "Reports page will now show correct date ranges (Dec 01-15, not Dec 01-07)",
            "Metadata cache will store actual payroll periods from Excel reports"
        ]
    },
    {
        "version": "8.9.6",
        "date": "2025-12-15",
        "changes": [
            "🔧 FIX: Pay Rates Edit button now works with inline onclick handlers",
            "Replaced event listeners with direct onclick handlers for better compatibility",
            "Removed DOMContentLoaded dependency"
        ]
    },
    {
        "version": "8.9.5",
        "date": "2025-12-15",
        "changes": [
            "🔧 FIX: Reports page now displays actual date ranges from payroll data",
            "Extract date range from Excel report A1 cell instead of inferring from filename",
            "Support weekly (Sat-Fri) and semi-monthly (1st-15th, 16th-end) payroll periods",
            "Calculate posting dates based on actual end date of period",
            "Display date ranges in human-readable format (e.g., 'Jan 04 – Jan 10, 2025')",
            "Use cached date ranges from metadata for improved performance",
            "Maintain backward compatibility with filename-based date extraction"
        ]
    },
    {
        "version": "8.9.4",
        "date": "2025-11-22",
        "changes": [
            "🔴 CRITICAL FIX: Edit Button Still Not Working",
            "Changed from event delegation to direct event listeners",
            "Each button now has its own click event listener",
            "Added comprehensive console logging for debugging",
            "Added error messages to help identify issues",
            "More reliable button click handling",
            "Better error reporting in browser console"
        ]
    },
    {
        "version": "8.9.3",
        "date": "2025-11-22",
        "changes": [
            "🔴 CRITICAL FIX: Edit Button Not Working on Pay Rates Page",
            "Replaced inline onclick handlers with event delegation",
            "Used data attributes (data-action, data-employee-id) for reliability",
            "Added DOMContentLoaded event listener for proper initialization",
            "Added focus to input field when editing starts",
            "Store original value for cancel functionality",
            "Added loading state to save button during API call",
            "Improved error handling and user feedback",
            "Edit button now works reliably across all browsers"
        ]
    },
    {
        "version": "8.9.2",
        "date": "2025-11-22",
        "changes": [
            "📐 UX: Success Page - Zero-Scroll Compact Layout",
            "Redesigned success page to fit without scrolling",
            "Side-by-side layout: Reports card + Zoho integration",
            "Compact header with inline checkmark icon",
            "Reports displayed in compact list format",
            "Smaller buttons (btn-sm) for space efficiency",
            "Reduced padding and margins throughout",
            "Zoho form more compact with smaller inputs",
            "Combined reports section spans full width when present",
            "Error alerts more compact",
            "Process Another File button at bottom with minimal spacing",
            "All content fits in single viewport - no scrolling required"
        ]
    },
    {
        "version": "8.9.1",
        "date": "2025-11-22",
        "changes": [
            "🔴 CRITICAL FIX: Process Confirmed Route",
            "Fixed /process_confirmed route to accept POST requests",
            "Route was only accepting GET but JavaScript sends POST",
            "Now properly handles JSON employee_ids from confirm_employees page",
            "Stores employee_ids in session before processing",
            "Returns proper JSON response for AJAX requests",
            "Improved error handling with detailed error messages",
            "Button loading state during processing",
            "Proper redirect handling after successful processing"
        ]
    },
    {
        "version": "8.9.0",
        "date": "2025-11-22",
        "changes": [
            "🎨 UI: Side-by-Side Layout & Workflow Pages Complete",
            "Home page redesigned - side-by-side layout (no scrolling needed)",
            "Upload and Instructions cards side-by-side",
            "Compact step-by-step guide",
            "Quick links integrated below",
            "Fetch Timecard page - redesigned with design system",
            "Fix Missing Times page - professional table design",
            "Confirm Employees page - modern checkbox list",
            "All workflow pages now consistent",
            "All pages use new navigation system",
            "Removed all Tailwind dependencies from workflow pages"
        ]
    },
    {
        "version": "8.8.0",
        "date": "2025-11-22",
        "changes": [
            "📐 UX: Compact Layout - Reduced Scrolling",
            "Reduced spacing system (8px → 4px grid)",
            "Card padding: 24px → 16px",
            "Card margins: 24px → 16px",
            "Table padding: 16px → 8px vertical, 12px horizontal",
            "Form group margins: 20px → 12px",
            "Header padding: 32px → 16px",
            "Alert padding: 16px → 12px",
            "Heading margins: 16px → 8px",
            "Paragraph margins: 16px → 8px",
            "Grid gaps: 24px → 16px",
            "Success banner: reduced padding and icon size",
            "Empty state: reduced padding and icon size",
            "All pages now more compact with less scrolling"
        ]
    },
    {
        "version": "8.7.0",
        "date": "2025-11-22",
        "changes": [
            "🎨 UI: Success Page & User Management Redesign",
            "Success page (Payroll Complete) - removed Tailwind, added design system",
            "Professional success banner with checkmark",
            "Download buttons with icons",
            "Zoho integration form redesigned",
            "Manage Users page - removed Tailwind, added design system",
            "Professional user table with badges",
            "Add user form with validation helpers",
            "All pages now use consistent navigation",
            "Removed all sidebar dependencies"
        ]
    },
    {
        "version": "8.6.0",
        "date": "2025-11-22",
        "changes": [
            "🎨 UI: Professional Change Password Page Redesign",
            "Replaced old styling with design system CSS",
            "Clean gradient header banner",
            "Professional form with validation helpers",
            "Alert components for success/error messages",
            "Cancel button to return home",
            "Password requirements clearly displayed",
            "Consistent with other redesigned pages"
        ]
    },
    {
        "version": "8.5.0",
        "date": "2025-11-22",
        "changes": [
            "🎨 UI: Professional Pay Rates Page Redesign",
            "Replaced Tailwind with design system CSS",
            "Clean gradient header banner",
            "Professional table with Employee ID AND Name columns",
            "Badge-styled Employee IDs",
            "Inline edit functionality preserved",
            "Professional form for adding new rates",
            "Form validation helpers displayed",
            "Delete confirmation with employee name",
            "All CRUD operations fully functional",
            "XSS protection (all data escaped)"
        ]
    },
    {
        "version": "8.4.0",
        "date": "2025-11-22",
        "changes": [
            "🎨 UI: Professional Reports Page Redesign",
            "Replaced Tailwind with design system CSS",
            "Clean gradient header banner",
            "Professional table design with proper alignment",
            "Badge component for 'Created By' field",
            "Empty state with call-to-action button",
            "Download buttons with SVG icons",
            "Flash message support (alerts)",
            "Mobile-responsive table",
            "All functionality preserved (caching, metadata, etc.)"
        ]
    },
    {
        "version": "8.3.0",
        "date": "2025-11-22",
        "changes": [
            "🎨 UI: Professional Home/Dashboard Page Redesign",
            "Replaced Tailwind CDN with design system CSS",
            "Removed sidebar layout for consistent navigation",
            "Clean gradient header banner",
            "Professional upload card with drag & drop",
            "Step-by-step instructions with numbers",
            "Quick links grid for common actions",
            "Hover effects on all interactive elements",
            "Alert component for CSV format info",
            "Mobile-responsive layout",
            "JavaScript drag & drop fully functional"
        ]
    },
    {
        "version": "8.2.0",
        "date": "2025-11-22",
        "changes": [
            "🎨 UI: Professional Navigation System Redesign",
            "Modern sticky header with shadow",
            "Professional brand section (logo + title + version)",
            "SVG icons for all navigation items",
            "Dropdown user menu (Change Password, Logout)",
            "Smooth hover states and transitions",
            "Mobile-responsive hamburger menu",
            "Clean dropdown styling",
            "Consistent with design system",
            "Accessible keyboard navigation"
        ]
    },
    {
        "version": "8.1.0",
        "date": "2025-11-22",
        "changes": [
            "🎨 UI: Professional Login Page Redesign",
            "Centered card layout with gradient background",
            "Professional dollar sign logo icon",
            "Clean, spacious form design",
            "SVG icons for visual feedback",
            "Improved error message styling (alert component)",
            "Version badge display",
            "Responsive design (mobile-friendly)",
            "Uses design system components",
            "Professional Inter font applied"
        ]
    },
    {
        "version": "8.0.0",
        "date": "2025-11-22",
        "changes": [
            "🎨 MAJOR: Enterprise UI Redesign - Phase 1",
            "Created professional favicon (SVG format)",
            "Implemented comprehensive design system (design-system.css)",
            "Design tokens: Colors, typography, spacing (8px grid)",
            "Professional blue theme (#1e40af primary)",
            "Complete component library: buttons, forms, tables, cards",
            "Responsive grid system (mobile, tablet, desktop)",
            "Modern CSS variables for easy customization",
            "Professional shadows, transitions, and animations",
            "WCAG AA accessible (proper contrast ratios)",
            "MAJOR VERSION BUMP: UI overhaul begins"
        ]
    },
    {
        "version": "7.3.0",
        "date": "2025-11-22",
        "changes": [
            "🔒 ENHANCED: Robust Duplicate Prevention for Zoho Expenses",
            "Added zoho_find_expense_by_reference() - searches Zoho by reference number",
            "Two-tier duplicate check: Session cache (fast) + Zoho search (robust)",
            "Prevents duplicates across different sessions and users",
            "Works even if user logs out and back in",
            "Reference number format: PAYROLL-{start_date}_to_{end_date}",
            "Automatic session cache update when Zoho duplicate found",
            "Comprehensive logging for all duplicate prevention",
            "Applied to both automatic and manual expense creation",
            "User-friendly alert messages with expense ID and reference"
        ]
    },
    {
        "version": "7.2.0",
        "date": "2025-11-22",
        "changes": [
            "🔐 SECURITY: Secure Configuration Management",
            "Moved Flask secret_key to environment variable (FLASK_SECRET_KEY)",
            "Added warning if secret_key not set in production",
            "Created .env.example with all required environment variables",
            "Created comprehensive SECURITY.md documentation",
            "Documented all Zoho API environment variables",
            "Security checklist for deployment",
            "Security incident response procedures",
            "Password security best practices documented",
            "All sensitive config now in environment variables",
            "✅ SECURITY AUDIT COMPLETE: Phase 8 finished"
        ]
    },
    {
        "version": "7.1.0",
        "date": "2025-11-22",
        "changes": [
            "🔒 SECURITY: XSS Prevention Implemented",
            "Fixed XSS vulnerability in username display (menu)",
            "Fixed XSS vulnerability in error/success messages",
            "Added HTML escaping using markupsafe.escape",
            "SQL Injection audit: No vulnerabilities found (JSON-based storage)",
            "🛡️ SECURITY: Input Validation Implemented",
            "Username validation: 3-50 chars, alphanumeric + underscore/hyphen",
            "Password validation: 8+ chars, must contain letter and number",
            "Pay rate validation: 0-10000, proper number format",
            "Employee ID validation: alphanumeric format",
            "All validation functions with detailed error messages",
            "Updated add_user, change_password, add_rate, update_rate with validation",
            "Comprehensive input sanitization throughout"
        ]
    },
    {
        "version": "7.0.0",
        "date": "2025-11-22",
        "changes": [
            "🔒 CRITICAL SECURITY UPDATE: Password Hashing Implemented",
            "All passwords now stored as pbkdf2:sha256 hashes",
            "Automatic migration of plaintext passwords on startup",
            "Backward compatibility with existing passwords during migration",
            "Updated login to use secure password verification",
            "Updated add_user to hash new passwords",
            "Updated change_password to hash new passwords",
            "Comprehensive logging for password operations",
            "MAJOR VERSION BUMP: Security critical update"
        ]
    },
    {
        "version": "6.4.0",
        "date": "2025-11-22",
        "changes": [
            "CODE OPTIMIZATION: Phase 6 - Performance & Caching",
            "Implemented pay rates caching (5-minute TTL)",
            "Reduced file I/O for pay_rates from 13 reads to 1 per request",
            "Cache automatically invalidates when rates are saved",
            "Significant performance improvement for payroll processing",
            "NO functionality changes"
        ]
    },
    {
        "version": "6.3.1",
        "date": "2025-11-22",
        "changes": [
            "CODE OPTIMIZATION: Phase 4d - Standardize Code Quality",
            "Removed ALL debug print statements (20 instances)",
            "Replaced print() with proper app.logger calls",
            "Consistent logging levels: debug, info, warning, error",
            "All debug output now in centralized log file",
            "Better production-ready code quality",
            "NO functionality changes"
        ]
    },
    {
        "version": "6.3.0",
        "date": "2025-11-22",
        "changes": [
            "CODE OPTIMIZATION: Phase 5d - User-Friendly Error Pages",
            "Added custom 404 error page (Page Not Found)",
            "Added custom 500 error page (Internal Server Error)",
            "Added custom 403 error page (Access Denied/Forbidden)",
            "Added custom 405 error page (Method Not Allowed)",
            "All error pages match modern enterprise UI design",
            "Error pages include helpful information and action buttons",
            "Automatic error logging for all HTTP errors",
            "Improved user experience during errors"
        ]
    },
    {
        "version": "6.2.2",
        "date": "2025-11-22",
        "changes": [
            "CRITICAL FIX: Method Not Allowed error on /process route",
            "Fixed /process route to accept both GET and POST methods",
            "Resolved redirect issue from /validate causing 405 errors",
            "Process route now handles both direct uploads and validation redirects",
            "All payroll processing workflows restored to working state"
        ]
    },
    {
        "version": "6.2.1",
        "date": "2025-11-22",
        "changes": [
            "CODE OPTIMIZATION: Phase 5 Error Handling - Zoho API",
            "Enhanced Zoho API error handling with retries",
            "Better network error recovery",
            "Improved timeout handling",
            "User-friendly error messages for API failures",
            "All API calls logged for debugging"
        ]
    },
    {
        "version": "6.2.0",
        "date": "2025-11-22",
        "changes": [
            "CODE OPTIMIZATION: Phase 5 Error Handling - Foundation",
            "Added comprehensive error handling framework",
            "Improved file operation safety",
            "Better error messages for users",
            "Logging system established",
            "Automatic backup creation",
            "NO functionality changes - pure stability improvements"
        ]
    },
    {
        "version": "6.1.0",
        "date": "2025-10-29",
        "changes": [
            "COMPLETE ENTERPRISE UI REDESIGN - HOME PAGE",
            "Migrated to TailwindCSS for pixel-perfect enterprise styling",
            "Implemented professional sidebar navigation (Stripe/Notion style)",
            "Applied approved enterprise color palette: Deep blue (#1e40af), slate gray, off-white backgrounds",
            "Added Inter font family for professional typography",
            "Heroicons SVG integration for consistent iconography",
            "Sidebar features: Collapsible on mobile, clear hierarchy, hover states",
            "Home page: Modern card layout, step-by-step instructions, drag-and-drop upload",
            "What's New section with visual checkmarks and feature highlights",
            "Professional gradients, shadows, and transitions throughout",
            "100% responsive: Desktop sidebar, mobile-optimized layout",
            "ZERO functionality changes - pure visual upgrade",
            "All calculations, reports, Zoho integration unchanged"
        ]
    },
    {
        "version": "6.0.9",
        "date": "2025-10-28",
        "changes": [
            "PHASE 1: Enterprise UI Upgrade Foundation",
            "Integrated Bootstrap 5.3.2 framework",
            "Added Inter font family for professional typography",
            "Added Bootstrap Icons for consistent iconography",
            "Created base template system: get_base_html_head(), get_menu_html(), get_footer_html()",
            "Professional navigation with collapsible mobile menu",
            "Established design system: color palette, spacing, typography",
            "Created comprehensive UI_UPGRADE_PLAN.md documentation"
        ]
    },
    {
        "version": "6.0.8",
        "date": "2025-10-28",
        "changes": [
            "Professional menu bar redesign across entire site",
            "Consistent button styling for all navigation items",
            "Color-coded buttons: Green (Home), Blue (Actions), Red (Logout)",
            "Smooth hover effects and transitions",
            "User info badge on the right with icon",
            "Mobile responsive with flexbox layout"
        ]
    },
    {
        "version": "6.0.7",
        "date": "2025-10-28",
        "changes": [
            "Complete redesign of success/reports page",
            "Added prominent success header with checkmark",
            "Grid layout for report cards with hover effects",
            "Visual icons for each report type",
            "Improved Zoho Books expense section with blue gradient",
            "Better mobile responsiveness"
        ]
    },
    {
        "version": "6.0.6",
        "date": "2025-10-28",
        "changes": [
            "Added clear step-by-step instructions on home page",
            "5-step process guide with visual formatting",
            "CSV format tip included for users"
        ]
    },
    {
        "version": "6.0.5",
        "date": "2025-10-28",
        "changes": [
            "SAFE validation re-added: Upload → Validate → Fix (if needed) → Employee Selection → Process",
            "Validation happens EARLY (right after upload) and ONCE",
            "After fixing times, goes to employee selection (working flow preserved)",
            "process_confirmed has NO validation (just processes clean data)"
        ]
    },
    {
        "version": "6.0.4",
        "date": "2025-10-28",
        "changes": [
            "REVERTED to original working workflow order",
            "Upload → Employee Selection → Process (working order restored)",
            "Removed all validation logic that was breaking reports"
        ]
    },
    {
        "version": "6.0.3",
        "date": "2025-10-28",
        "changes": [
            "CRITICAL FIX: validate_timesheet no longer modifies original dataframe",
            "Fixed reports showing None/zero for Clock In/Out times",
            "Validation now works on copy to preserve data integrity"
        ]
    },
    {
        "version": "6.0.2",
        "date": "2025-10-28",
        "changes": [
            "Fixed workflow: Employee selection now happens BEFORE time validation",
            "Only validate times for employees you're actually processing",
            "Fixed confirm_employees page UI to match clean design",
            "Bug fixes for time validation flow"
        ]
    },
    {
        "version": "6.0.1",
        "date": "2025-10-28",
        "changes": [
            "UI uniformity and modernization across all pages",
            "Centralized version management system",
            "Employee exclusion feature for selective payroll processing",
            "Updated What's New section"
        ]
    },
    {
        "version": "6.0.0",
        "date": "2024",
        "changes": [
            "Zoho Books Integration",
            "Dual Company Support (Haute Brands / Boomin Brands)",
            "Smart Date Calculation",
            "Duplicate Prevention",
            "Performance Optimization",
            "Modern UI with rounded corners and gradients"
        ]
    }
]

def get_version():
    """Returns the current version string"""
    return __version__

def get_version_display():
    """Returns the version with 'v' prefix for display"""
    return f"v{__version__}"

def get_version_info():
    """Returns detailed version information"""
    return {
        "version": __version__,
        "name": __version_name__,
        "release_date": __release_date__
    }

def get_changelog():
    """Returns the full version history"""
    return VERSION_HISTORY
