# Simple Payroll App

A dramatically simplified payroll report generator application for PythonAnywhere.

## Features

- Upload timesheet CSV files
- Process employee hours
- Generate Excel payroll reports
- Simple and reliable download links

## Installation

1. Clone this repository or upload the files to your PythonAnywhere account

2. Install dependencies:
```
pip install -r requirements.txt
```

3. Set up the Flask app in PythonAnywhere:
   - Go to the Web tab
   - Create a new web app
   - Choose "Manual configuration" with your Python version
   - Set the source directory to your app directory
   - Set the WSGI file path to point to simple_app.py

4. Configure the WSGI file:
```python
import sys
path = '/home/yourusername/path/to/app'
if path not in sys.path:
    sys.path.append(path)

from simple_app import app as application
```

## Usage

1. Access your PythonAnywhere URL
2. Upload a CSV file with timesheet data
3. Download the generated Excel report

## CSV Format

The CSV file should have the following columns:
- Person ID
- First Name
- Last Name
- Date
- Clock In
- Clock Out
- Total Work Time(h)

## Troubleshooting

If you encounter any issues:
- Check that your directories have proper write permissions
- Verify that the CSV file format matches the expected format
- Check the PythonAnywhere error logs

## License

This project is licensed under the MIT License. 