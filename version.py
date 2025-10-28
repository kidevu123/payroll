"""
Payroll Management System - Version Management
Centralized version tracking for the payroll application
"""

__version__ = "6.0.1"
__version_name__ = "Production"
__release_date__ = "2025-10-28"

# Version history
VERSION_HISTORY = [
    {
        "version": "6.0.1",
        "date": "2025-10-28",
        "changes": [
            "UI uniformity and modernization",
            "Centralized version management system",
            "Employee exclusion feature for selective payroll processing"
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

def get_version_info():
    """Returns complete version information"""
    return {
        "version": __version__,
        "name": __version_name__,
        "release_date": __release_date__
    }

def get_version_display():
    """Returns formatted version string for display"""
    return f"v{__version__}"

def get_changelog():
    """Returns the version history"""
    return VERSION_HISTORY

def increment_version(level="patch"):
    """
    Helper function to increment version number
    level: 'major', 'minor', or 'patch'
    Returns new version string
    """
    parts = __version__.split('.')
    major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2])
    
    if level == "major":
        major += 1
        minor = 0
        patch = 0
    elif level == "minor":
        minor += 1
        patch = 0
    elif level == "patch":
        patch += 1
    
    return f"{major}.{minor}.{patch}"

# Quick reference for developers
if __name__ == "__main__":
    print(f"Payroll Management System - Version {get_version_display()}")
    print(f"Release Date: {__release_date__}")
    print("\nVersion History:")
    for entry in VERSION_HISTORY:
        print(f"\n{entry['version']} ({entry['date']}):")
        for change in entry['changes']:
            print(f"  • {change}")

