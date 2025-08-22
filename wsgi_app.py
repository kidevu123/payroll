"""
WSGI configuration for PythonAnywhere

This file contains the WSGI configuration for PythonAnywhere.
It exposes the WSGI callable as a module-level variable named 'application'.

Example for PythonAnywhere configuration:
- In your PythonAnywhere dashboard, go to the Web tab.
- Set your WSGI file path to this file.
- Make sure this file is accessible from your web app path.
"""

import sys
import os

# Add the directory containing your app to the Python path
# Replace 'yourusername' with your actual PythonAnywhere username
# Replace '/home/yourusername/mysite' with your actual app directory
app_path = '/home/yourusername/mysite'

if app_path not in sys.path:
    sys.path.insert(0, app_path)

# Import your app
from simple_app import app as application 