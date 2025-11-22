"""
Payroll Management System - Version Management
Centralized version tracking for the payroll application
"""

__version__ = "7.1.0"
__version_name__ = "Security: XSS & Input Validation"
__release_date__ = "2025-11-22"

VERSION_HISTORY = [
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
