from flask import Flask, render_template_string, request, redirect, url_for
import os
from pathlib import Path

app = Flask(__name__)

# Ultra minimal config
UPLOAD_FOLDER = 'uploads'
REPORT_FOLDER = 'static/reports'

# Create directories
Path(UPLOAD_FOLDER).mkdir(parents=True, exist_ok=True)
Path(REPORT_FOLDER).mkdir(parents=True, exist_ok=True)

@app.route('/')
def index():
    """Simple upload form"""
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Minimal Payroll App</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
        </style>
    </head>
    <body>
        <h1>Minimal Payroll App</h1>
        <p>This is a minimal working version to test functionality.</p>
        
        <form action="/test" method="post">
            <button type="submit">Test App</button>
        </form>
    </body>
    </html>
    """
    return render_template_string(html)

@app.route('/test', methods=['POST'])
def test():
    """Simple test route"""
    return "Test successful! The app is working correctly."

if __name__ == '__main__':
    app.run(debug=True)
