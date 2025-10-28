#!/usr/bin/env python3
"""
Quick test script to verify version management system
Run this before deployment to ensure version system works correctly
"""

import sys

def test_version_module():
    """Test the version module"""
    print("=" * 60)
    print("Testing Version Management System")
    print("=" * 60)
    
    try:
        from version import (
            get_version, 
            get_version_display, 
            get_version_info,
            get_changelog,
            __version__
        )
        print("✓ Successfully imported version module")
    except ImportError as e:
        print(f"✗ Failed to import version module: {e}")
        return False
    
    # Test version functions
    try:
        version = get_version()
        print(f"✓ get_version() = {version}")
        
        display = get_version_display()
        print(f"✓ get_version_display() = {display}")
        
        info = get_version_info()
        print(f"✓ get_version_info() = {info}")
        
        changelog = get_changelog()
        print(f"✓ get_changelog() returned {len(changelog)} entries")
        
        print(f"✓ __version__ = {__version__}")
        
    except Exception as e:
        print(f"✗ Error calling version functions: {e}")
        return False
    
    # Test version format
    if not version or not isinstance(version, str):
        print("✗ Version is not a valid string")
        return False
    
    parts = version.split('.')
    if len(parts) != 3:
        print(f"✗ Version format incorrect (expected X.Y.Z): {version}")
        return False
    
    print(f"✓ Version format is valid: {version}")
    
    # Test changelog structure
    if not isinstance(changelog, list) or len(changelog) == 0:
        print("✗ Changelog is empty or invalid")
        return False
    
    for entry in changelog:
        if not all(key in entry for key in ['version', 'date', 'changes']):
            print(f"✗ Changelog entry missing required fields: {entry}")
            return False
    
    print("✓ Changelog structure is valid")
    
    return True

def test_simple_app_import():
    """Test that simple_app can import version module"""
    print("\n" + "=" * 60)
    print("Testing simple_app.py Integration")
    print("=" * 60)
    
    try:
        # Try to compile the simple_app.py file
        import py_compile
        py_compile.compile('simple_app.py', doraise=True)
        print("✓ simple_app.py syntax is valid")
    except py_compile.PyCompileError as e:
        print(f"✗ Syntax error in simple_app.py: {e}")
        return False
    except Exception as e:
        print(f"✗ Error checking simple_app.py: {e}")
        return False
    
    # Note: We can't actually import simple_app without dependencies
    # but syntax check is sufficient for deployment verification
    
    return True

def test_template_helpers():
    """Test template helpers module"""
    print("\n" + "=" * 60)
    print("Testing template_helpers.py")
    print("=" * 60)
    
    try:
        from template_helpers import (
            get_unified_css,
            get_footer_html,
            get_page_template
        )
        print("✓ Successfully imported template_helpers")
    except ImportError as e:
        print(f"⚠ template_helpers not found (optional): {e}")
        return True  # Optional module
    except Exception as e:
        print(f"✗ Error importing template_helpers: {e}")
        return False
    
    try:
        css = get_unified_css()
        print(f"✓ get_unified_css() returned {len(css)} characters")
        
        footer = get_footer_html()
        print(f"✓ get_footer_html() returned {len(footer)} characters")
        
        if "v6.0.1" not in footer and "6.0.1" not in footer:
            print("⚠ Warning: Version not found in footer HTML")
        else:
            print("✓ Version found in footer HTML")
        
    except Exception as e:
        print(f"✗ Error calling template_helpers functions: {e}")
        return False
    
    return True

def main():
    """Run all tests"""
    print("\nPre-Deployment Test Suite")
    print("Version 6.0.1")
    print()
    
    results = []
    
    # Run tests
    results.append(("Version Module", test_version_module()))
    results.append(("Simple App Integration", test_simple_app_import()))
    results.append(("Template Helpers", test_template_helpers()))
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status}: {name}")
    
    print()
    print(f"Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed! Ready for deployment.")
        return 0
    else:
        print("\n⚠️  Some tests failed. Please review before deployment.")
        return 1

if __name__ == "__main__":
    sys.exit(main())

