from flask import Flask, render_template_string, request, redirect, url_for, send_file
import os
from pathlib import Path

app = Flask(__name__)

# Configuration
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
        <title>Step 1 Payroll App</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .button { 
                display: inline-block; 
                padding: 10px 15px; 
                background-color: #4CAF50; 
                color: white; 
                border: none;
                cursor: pointer;
            }
        </style>
    </head>
    <body>
        <h1>Step 1 Payroll App</h1>
        
        <form action="/process" method="post" enctype="multipart/form-data">
            <p>Upload CSV file:</p>
            <input type="file" name="file" required>
            <button type="submit" class="button">Upload File</button>
        </form>
    </body>
    </html>
    """
    return render_template_string(html)

@app.route('/process', methods=['POST'])
def process():
    """Process the uploaded file - just save it for now"""
    try:
        if 'file' not in request.files:
            return "No file part", 400

        file = request.files['file']
        if file.filename == '':
            return "No selected file", 400

        # Save the file
        file_path = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(file_path)
        
        # Create a simple text file as a "report"
        report_path = os.path.join(REPORT_FOLDER, 'simple_report.txt')
        with open(report_path, 'w') as f:
            f.write(f"Report for {file.filename}\n")
            f.write(f"File size: {os.path.getsize(file_path)} bytes\n")
        
        return redirect(url_for('success'))
        
    except Exception as e:
        return f"Error: {str(e)}", 500

@app.route('/success')
def success():
    """Success page with a download link"""
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Upload Successful</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .button { 
                display: inline-block; 
                padding: 10px 15px; 
                background-color: #4CAF50; 
                color: white; 
                text-decoration: none;
            }
        </style>
    </head>
    <body>
        <h1>Upload Successful</h1>
        
        <p>Your file was successfully uploaded.</p>
        
        <p><a href="/download" class="button">Download Report</a></p>
        
        <p><a href="/">Upload Another File</a></p>
    </body>
    </html>
    """
    return render_template_string(html)

@app.route('/download')
def download():
    """Download the report file"""
    try:
        report_path = os.path.join(REPORT_FOLDER, 'simple_report.txt')
        return send_file(report_path, as_attachment=True)
    except Exception as e:
        return f"Error downloading file: {str(e)}", 500

if __name__ == '__main__':
    app.run(debug=True)
