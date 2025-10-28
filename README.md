# Payroll Management App

A Flask-based payroll management system with automated expense posting to Zoho Books.

## Version

Current version: **6.0.1** (see `version.py` for version management)

To check version programmatically:
```python
from version import get_version, get_version_info
print(get_version())  # Returns: 6.0.1
```

### Features
- CSV timesheet processing and validation
- Automated payroll calculations with custom rates
- Excel report generation (Admin, Payslips, Combined)
- PDF report generation
- Zoho Books integration for expense automation
- User management and authentication
- Drag-and-drop file upload
- Modern responsive UI

### Recent Updates (v6.0+)
- **Zoho Books Integration**: Automatically create expense entries and attach reports
- **Dual Company Support**: Route expenses to Haute Brands or Boomin Brands
- **Smart Date Calculation**: Expenses posted for end-of-week + 1 day
- **Duplicate Prevention**: Prevents creating duplicate expenses in Zoho
- **Performance Optimization**: Cached metadata for faster Reports page loading
- **Modern UI**: Rounded corners, gradients, improved user experience

## Deployment on PythonAnywhere

### 1. Upload Files
Upload `simple_app.py` to `/home/YOUR_USERNAME/payroll/`

### 2. Configure WSGI
Copy `wsgi_template.py` to `/var/www/YOUR_USERNAME_pythonanywhere_com_wsgi.py` and update:
- Replace `YOUR_USERNAME` with your PythonAnywhere username
- Replace all `YOUR_*` placeholders with actual Zoho API credentials
- Set correct account names from your Zoho Chart of Accounts

### 3. Install Dependencies
```bash
pip3.10 install --user -r requirements.txt
```

### 4. Create Required Directories
```bash
mkdir -p /home/YOUR_USERNAME/payroll/static/reports
```

### 5. Reload Web App
Click "Reload" on your PythonAnywhere Web tab

## Environment Variables

### Required Zoho API Credentials

#### Haute Brands
- `ZB_HAUTE_ORG_ID`: Zoho organization ID
- `ZB_HAUTE_CLIENT_ID`: OAuth client ID  
- `ZB_HAUTE_CLIENT_SECRET`: OAuth client secret
- `ZB_HAUTE_REFRESH_TOKEN`: OAuth refresh token
- `ZB_HAUTE_EXPENSE_ACCOUNT_NAME`: Chart of Accounts expense account name
- `ZB_HAUTE_PAID_THROUGH_ACCOUNT_NAME`: Bank account name for "Paid Through"

#### Boomin Brands
- `ZB_BOOMIN_ORG_ID`: Zoho organization ID
- `ZB_BOOMIN_CLIENT_ID`: OAuth client ID
- `ZB_BOOMIN_CLIENT_SECRET`: OAuth client secret  
- `ZB_BOOMIN_REFRESH_TOKEN`: OAuth refresh token
- `ZB_BOOMIN_EXPENSE_ACCOUNT_NAME`: Chart of Accounts expense account name
- `ZB_BOOMIN_PAID_THROUGH_ACCOUNT_NAME`: Bank account name for "Paid Through"

### Optional Configuration
- `ZB_AUTO_PUSH_EXPENSE`: Set to 'true' to enable automatic expense posting (default: 'false')
- `ZB_DEFAULT_COMPANY`: Default company selection ('haute' or 'boomin', default: 'haute')
- `REPORTS_LIST_LIMIT`: Number of reports to display on Reports page (default: 24)

## Usage

1. **Login**: Access the app and log in with your credentials
2. **Upload Timesheet**: Drag and drop or select CSV timesheet file
3. **Process**: Review and fix any validation issues
4. **Generate Reports**: Creates Admin report, payslips, and combined files
5. **Push to Zoho**: Manually push expense to appropriate company in Zoho Books

## Security Notes

- Never commit actual API credentials to version control
- Use the wsgi_template.py as a guide but set real values in your deployment
- Keep your Zoho refresh tokens secure and regenerate if compromised
- The .gitignore excludes sensitive files and data

## Support

This app integrates with:
- Zoho Books API for expense management
- PythonAnywhere for hosting
- Excel/PDF generation for reporting