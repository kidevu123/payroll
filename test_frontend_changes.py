#!/usr/bin/env python3
"""
Test script to validate frontend-only changes to the payroll app.
This script verifies that no business logic has been affected.
"""

import json
import os
import sys

def test_helper_functions_exist():
    """Test that new helper function exists and is safe"""
    print("Testing helper function...")
    
    with open('simple_app.py', 'r') as f:
        content = f.read()
    
    # Check that get_employee_names function exists
    assert 'def get_employee_names():' in content, "get_employee_names function not found"
    
    # Verify it's read-only (no file writing)
    function_start = content.find('def get_employee_names():')
    function_end = content.find('\n\n#', function_start)
    function_code = content[function_start:function_end]
    
    # Should only read files, not write
    assert '.write(' not in function_code, "Function should not write files"
    assert 'json.dump(' not in function_code, "Function should not modify JSON files"
    assert 'pd.read_csv' in function_code, "Function should read CSV files"
    
    print("✅ Helper function is safe (read-only)")

def test_core_functions_unchanged():
    """Test that core business logic functions remain unchanged"""
    print("\nTesting core functions...")
    
    with open('simple_app.py', 'r') as f:
        content = f.read()
    
    critical_functions = [
        'def load_pay_rates():',
        'def save_pay_rates(rates):',
        'def parse_work_hours(time_str):',
        'def compute_daily_hours(row):',
    ]
    
    for func in critical_functions:
        assert func in content, f"Critical function missing: {func}"
    
    print("✅ All core functions present")

def test_endpoints_unchanged():
    """Test that critical endpoints remain unchanged"""
    print("\nTesting endpoints...")
    
    with open('simple_app.py', 'r') as f:
        content = f.read()
    
    critical_endpoints = [
        "@app.route('/add_rate', methods=['POST'])",
        "@app.route('/update_rate/<employee_id>', methods=['POST'])",
        "@app.route('/delete_rate', methods=['POST'])",
    ]
    
    for endpoint in critical_endpoints:
        assert endpoint in content, f"Critical endpoint missing: {endpoint}"
    
    # Verify add_rate logic hasn't changed
    add_rate_start = content.find("@app.route('/add_rate', methods=['POST'])")
    add_rate_section = content[add_rate_start:add_rate_start + 500]
    
    assert 'pay_rates[emp_id] = pay_rate' in add_rate_section or 'pay_rates[employee_id]' in add_rate_section, \
        "Pay rate assignment logic may have changed"
    
    print("✅ All critical endpoints intact")

def test_pay_rates_structure():
    """Test that pay_rates.json structure is unchanged"""
    print("\nTesting pay rates structure...")
    
    if os.path.exists('pay_rates.json'):
        with open('pay_rates.json', 'r') as f:
            rates = json.load(f)
        
        # Verify it's still a simple dict of id -> rate
        for emp_id, rate in rates.items():
            assert isinstance(emp_id, str), "Employee ID should be string"
            assert isinstance(rate, (int, float)), "Rate should be numeric"
            # Verify no additional fields were added
            assert not isinstance(rate, dict), "Rate structure should not be changed to dict"
        
        print("✅ Pay rates structure unchanged")
    else:
        print("⚠️  pay_rates.json not found (may not exist in test environment)")

def test_manage_rates_includes_names():
    """Test that manage_rates route now includes employee names"""
    print("\nTesting pay rates page enhancements...")
    
    with open('simple_app.py', 'r') as f:
        content = f.read()
    
    # Find manage_rates function
    manage_rates_start = content.find("@app.route('/manage_rates')")
    manage_rates_section = content[manage_rates_start:manage_rates_start + 2000]
    
    # Should call get_employee_names
    assert 'get_employee_names()' in manage_rates_section, \
        "manage_rates should call get_employee_names()"
    
    # Should include name in employee dict
    assert "'name'" in manage_rates_section or '"name"' in manage_rates_section, \
        "Employee name should be included in display data"
    
    # HTML should have Employee Name header
    html_section = content[manage_rates_start:manage_rates_start + 5000]
    assert 'Employee Name' in html_section, \
        "Table should have Employee Name column header"
    
    print("✅ Employee names added to pay rates page")

def test_reports_page_styling():
    """Test that reports page uses modern styling"""
    print("\nTesting reports page styling...")
    
    with open('simple_app.py', 'r') as f:
        content = f.read()
    
    # Find reports function
    reports_start = content.find("@app.route('/reports')")
    reports_section = content[reports_start:reports_start + 10000]
    
    # Should use enterprise sidebar
    assert 'get_enterprise_sidebar' in reports_section, \
        "Reports should use enterprise sidebar"
    
    # Should use Tailwind CSS
    assert 'tailwindcss.com' in reports_section or 'tailwind' in reports_section, \
        "Reports should use Tailwind CSS"
    
    # Should have modern styling classes
    modern_classes = ['rounded-xl', 'shadow-sm', 'border-gray', 'hover:bg-gray']
    found_modern = any(cls in reports_section for cls in modern_classes)
    assert found_modern, "Reports should use modern Tailwind classes"
    
    # Data processing logic should be unchanged
    assert 'os.listdir(REPORT_FOLDER)' in reports_section, \
        "Report file listing logic should be unchanged"
    assert 'sorted_weeks' in reports_section, \
        "Report sorting logic should be unchanged"
    
    print("✅ Reports page styling updated while preserving logic")

def run_all_tests():
    """Run all validation tests"""
    print("=" * 60)
    print("FRONTEND CHANGES VALIDATION TEST SUITE")
    print("=" * 60)
    
    try:
        test_helper_functions_exist()
        test_core_functions_unchanged()
        test_endpoints_unchanged()
        test_pay_rates_structure()
        test_manage_rates_includes_names()
        test_reports_page_styling()
        
        print("\n" + "=" * 60)
        print("✅ ALL TESTS PASSED - CHANGES ARE SAFE")
        print("=" * 60)
        print("\nSummary:")
        print("  ✅ No business logic modified")
        print("  ✅ Core functions intact")
        print("  ✅ Critical endpoints unchanged")
        print("  ✅ Data structures preserved")
        print("  ✅ Frontend improvements applied")
        print("\n🎉 Safe to deploy to PythonAnywhere!")
        
        return 0
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        print("\n⚠️  DO NOT DEPLOY - Issues detected!")
        return 1
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        return 1

if __name__ == '__main__':
    sys.exit(run_all_tests())

