"""
Payroll Management System - Version Management
Centralized version tracking for the payroll application
"""

__version__ = "6.0.2"
__version_name__ = "Production"
__release_date__ = "2025-10-28"

VERSION_HISTORY = [
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
