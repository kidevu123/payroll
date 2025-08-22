from flask import Flask, render_template_string, request, redirect, url_for, send_file
import os
import pandas as pd
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
        <title>Step 2 Payroll App</title>
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
        <h1>Step 2 Payroll App</h1>
        
        <form action="/process" method="post" enctype="multipart/form-data">
            <p>Upload CSV file:</p>
            <input type="file" name="file" required>
            <button type="submit" class="button">Process File</button>
        </form>
    </body>
    </html>
    """
    return render_template_string(html)

@app.route('/process', methods=['POST'])
def process():
    """Process the uploaded file with pandas"""
    try:
        if 'file' not in request.files:
            return "No file part", 400

        file = request.files['file']
        if file.filename == '':
            return "No selected file", 400

        # Save the file
        file_path = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(file_path)
        
        # Read with pandas if it's a CSV
        if file.filename.endswith('.csv'):
            # Read CSV 
            df = pd.read_csv(file_path)
            
            # Create a simple CSV report
            report_path = os.path.join(REPORT_FOLDER, 'pandas_report.csv')
            
            # Generate a simple summary
            summary = pd.DataFrame({
                'Column': df.columns,
                'Data Type': df.dtypes.astype(str),
                'Non-Null Count': df.count(),
                'Example Value': [df[col].iloc[0] if len(df) > 0 else None for col in df.columns]
            })
            
            # Save summary to CSV
            summary.to_csv(report_path, index=False)
        else:
            # For non-CSV files, just create a text report
            report_path = os.path.join(REPORT_FOLDER, 'simple_report.txt')
            with open(report_path, 'w') as f:
                f.write(f"Report for {file.filename}\n")
                f.write(f"File size: {os.path.getsize(file_path)} bytes\n")
        
        return redirect(url_for('success'))
        
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        return f"Error: {str(e)}<br><pre>{error_details}</pre>", 500

@app.route('/success')
def success():
    """Success page with a download link"""
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Processing Successful</title>
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
        <h1>Processing Successful</h1>
        
        <p>Your file was successfully processed.</p>
        
        <p><a href="/download" class="button">Download Report</a></p>
        
        <p><a href="/">Process Another File</a></p>
    </body>
    </html>
    """
    return render_template_string(html)

@app.route('/download')
def download():
    """Download the report file"""
    try:
        # Try both possible report paths
        csv_path = os.path.join(REPORT_FOLDER, 'pandas_report.csv')
        txt_path = os.path.join(REPORT_FOLDER, 'simple_report.txt')
        
        if os.path.exists(csv_path):
            return send_file(csv_path, as_attachment=True)
        elif os.path.exists(txt_path):
            return send_file(txt_path, as_attachment=True)
        else:
            return "Report file not found", 404
    except Exception as e:
        return f"Error downloading file: {str(e)}", 500

if __name__ == '__main__':
    app.run(debug=True)
