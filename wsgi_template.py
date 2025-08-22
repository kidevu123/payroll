import sys
import os

# Add your project directory to path
path = '/home/YOUR_USERNAME/payroll'  # Replace with your username
if path not in sys.path:
    sys.path.insert(0, path)

# Set working directory
os.chdir(path)

# Environment Variables - SET THESE WITH YOUR ACTUAL VALUES
os.environ.update({
    # Zoho Books API Configuration for Haute Brands
    'ZB_HAUTE_ORG_ID': 'YOUR_HAUTE_ORG_ID',
    'ZB_HAUTE_CLIENT_ID': 'YOUR_HAUTE_CLIENT_ID',
    'ZB_HAUTE_CLIENT_SECRET': 'YOUR_HAUTE_CLIENT_SECRET',
    'ZB_HAUTE_REFRESH_TOKEN': 'YOUR_HAUTE_REFRESH_TOKEN',
    'ZB_HAUTE_EXPENSE_ACCOUNT_NAME': 'Payroll Expenses',  # Exact name from Chart of Accounts
    'ZB_HAUTE_PAID_THROUGH_ACCOUNT_NAME': 'Cash on hand',  # Exact name from Bank Accounts
    
    # Zoho Books API Configuration for Boomin Brands
    'ZB_BOOMIN_ORG_ID': 'YOUR_BOOMIN_ORG_ID',
    'ZB_BOOMIN_CLIENT_ID': 'YOUR_BOOMIN_CLIENT_ID',
    'ZB_BOOMIN_CLIENT_SECRET': 'YOUR_BOOMIN_CLIENT_SECRET',
    'ZB_BOOMIN_REFRESH_TOKEN': 'YOUR_BOOMIN_REFRESH_TOKEN',
    'ZB_BOOMIN_EXPENSE_ACCOUNT_NAME': 'Payroll Expenses',  # Exact name from Chart of Accounts
    'ZB_BOOMIN_PAID_THROUGH_ACCOUNT_NAME': 'Cash on hand',  # Exact name from Bank Accounts
    
    # Zoho API Domains
    'ZB_DOMAIN': 'https://books.zoho.com',
    'ZB_ACCOUNTS_DOMAIN': 'https://accounts.zoho.com',
    
    # App Configuration
    'ZB_AUTO_PUSH_EXPENSE': 'false',  # Set to 'true' to enable auto-push (not recommended)
    'ZB_DEFAULT_COMPANY': 'haute',    # Default company: 'haute' or 'boomin'
    'REPORTS_LIST_LIMIT': '24',       # Number of reports to show on Reports page
})

# Import the application
from simple_app import app as application