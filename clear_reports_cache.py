#!/usr/bin/env python3
"""
Helper script to clear the reports metadata cache.
This will force the app to re-read creator information from Excel files.
"""

import os
import json

# Path to the reports metadata file
REPORTS_METADATA_FILE = 'static/reports/reports_metadata.json'

def clear_cache():
    """Clear the reports metadata cache"""
    try:
        if os.path.exists(REPORTS_METADATA_FILE):
            # Backup the old cache
            backup_file = REPORTS_METADATA_FILE + '.backup'
            os.rename(REPORTS_METADATA_FILE, backup_file)
            print(f"✅ Cache cleared!")
            print(f"   Old cache backed up to: {backup_file}")
            print(f"   Next time you visit the Reports page, creator info will be re-read from Excel files")
        else:
            print("ℹ️  No cache file found - nothing to clear")
    except Exception as e:
        print(f"❌ Error clearing cache: {e}")

if __name__ == '__main__':
    print("=" * 60)
    print("REPORTS METADATA CACHE CLEARER")
    print("=" * 60)
    clear_cache()
    print("\nNext steps:")
    print("1. Reload your web app in PythonAnywhere")
    print("2. Visit the Reports page")
    print("3. Creator information will be freshly read from Excel files")
    print("=" * 60)

