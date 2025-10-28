"""
Template Helpers for Payroll Management System
Provides unified CSS framework and common HTML components for consistent UI
"""

from version import get_version, get_version_display

def get_unified_css():
    """Returns unified CSS framework for all pages"""
    return """
    <style>
        :root {
            /* Color Palette */
            --bg-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            --bg-pattern: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.1) 0%, transparent 50%);
            --card-bg: #ffffff;
            --card-hover: #fefefe;
            --text-primary: #1a202c;
            --text-secondary: #4a5568;
            --text-muted: #718096;
            
            /* Gradient Colors */
            --gradient-primary: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            --gradient-primary-hover: linear-gradient(135deg, #5a67d8 0%, #6b46c1 100%);
            --gradient-accent: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
            --gradient-accent-hover: linear-gradient(135deg, #43a3f5 0%, #00d4ff 100%);
            --gradient-success: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%);
            --gradient-warning: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%);
            --gradient-danger: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%);
            
            /* Solid Colors for fallback */
            --color-primary: #667eea;
            --color-primary-dark: #5a67d8;
            --color-success: #4CAF50;
            --color-success-dark: #388e3c;
            --color-warning: #ffa726;
            --color-danger: #ef5350;
            --color-info: #29b6f6;
            
            /* Borders & Shadows */
            --border-color: rgba(226, 232, 240, 0.8);
            --border-hover: rgba(203, 213, 224, 0.9);
            --shadow-sm: 0 4px 6px rgba(0, 0, 0, 0.05);
            --shadow-md: 0 10px 25px rgba(0, 0, 0, 0.1);
            --shadow-lg: 0 20px 40px rgba(0, 0, 0, 0.1);
            --shadow-xl: 0 25px 50px rgba(0, 0, 0, 0.15);
            
            /* Border Radius */
            --radius-sm: 8px;
            --radius-md: 12px;
            --radius-lg: 16px;
            --radius-xl: 20px;
            
            /* Spacing */
            --spacing-xs: 0.25rem;
            --spacing-sm: 0.5rem;
            --spacing-md: 1rem;
            --spacing-lg: 1.5rem;
            --spacing-xl: 2rem;
        }
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: var(--bg-gradient), var(--bg-pattern);
            background-attachment: fixed;
            color: var(--text-primary);
            line-height: 1.6;
            min-height: 100vh;
            padding: 2rem;
            position: relative;
        }
        
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-image: 
                radial-gradient(circle at 25% 25%, rgba(255,255,255,0.1) 0%, transparent 25%),
                radial-gradient(circle at 75% 75%, rgba(255,255,255,0.05) 0%, transparent 25%);
            pointer-events: none;
            z-index: -1;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            position: relative;
            z-index: 1;
        }
        
        /* Header Styles */
        .app-title {
            background: var(--card-bg);
            padding: 2rem 2.5rem;
            border-radius: var(--radius-xl);
            box-shadow: var(--shadow-lg);
            margin-bottom: 2rem;
            text-align: center;
            border: 1px solid var(--border-color);
            position: relative;
            overflow: hidden;
        }
        
        .app-title::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
            transition: left 0.5s;
        }
        
        .app-title:hover::before {
            left: 100%;
        }
        
        h1 {
            margin: 0;
            font-weight: 800;
            color: var(--text-primary);
            font-size: 2.5rem;
            background: var(--gradient-primary);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        h2 {
            color: var(--text-primary);
            font-weight: 700;
            margin-bottom: 1.5rem;
            font-size: 1.75rem;
        }
        
        h3 {
            color: var(--text-secondary);
            font-weight: 600;
            margin-bottom: 1rem;
            font-size: 1.25rem;
        }
        
        /* Version Badge */
        .version-badge {
            font-size: 0.875rem;
            color: var(--text-muted);
            font-weight: 600;
            background: var(--card-bg);
            padding: 0.25rem 0.75rem;
            border-radius: var(--radius-sm);
            border: 1px solid var(--border-color);
            display: inline-block;
            margin-left: 1rem;
            box-shadow: var(--shadow-sm);
        }
        
        /* Card Styles */
        .card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-lg);
            padding: 2rem;
            box-shadow: var(--shadow-md);
            margin-bottom: 2rem;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        
        .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: var(--gradient-primary);
            transform: scaleX(0);
            transition: transform 0.3s ease;
        }
        
        .card:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-lg);
            border-color: var(--border-hover);
        }
        
        .card:hover::before {
            transform: scaleX(1);
        }
        
        /* Button Styles */
        .button, .btn {
            display: inline-block;
            padding: 0.75rem 1.5rem;
            background: var(--gradient-primary);
            color: #fff;
            border: none;
            cursor: pointer;
            border-radius: var(--radius-md);
            font-weight: 700;
            box-shadow: var(--shadow-sm);
            transition: all 0.3s ease;
            text-decoration: none;
            text-align: center;
            font-size: 1rem;
        }
        
        .button:hover, .btn:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-md);
            background: var(--gradient-primary-hover);
        }
        
        .button:active, .btn:active {
            transform: translateY(0);
        }
        
        .button-secondary {
            background: var(--gradient-accent);
        }
        
        .button-secondary:hover {
            background: var(--gradient-accent-hover);
        }
        
        .button-success {
            background: var(--gradient-success);
        }
        
        .button-warning {
            background: var(--gradient-warning);
            color: var(--text-primary);
        }
        
        .button-danger {
            background: var(--gradient-danger);
        }
        
        /* Form Styles */
        .form-group {
            margin-bottom: 1.5rem;
        }
        
        label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
            color: var(--text-secondary);
        }
        
        input[type="text"],
        input[type="password"],
        input[type="email"],
        input[type="number"],
        input[type="date"],
        select,
        textarea {
            width: 100%;
            padding: 0.75rem 1rem;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            outline: none;
            transition: all 0.3s ease;
            font-size: 1rem;
            background: #fff;
        }
        
        input:focus,
        select:focus,
        textarea:focus {
            border-color: var(--color-primary);
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
        }
        
        /* Table Styles */
        table {
            width: 100%;
            border-collapse: collapse;
            background: var(--card-bg);
            border-radius: var(--radius-md);
            overflow: hidden;
            box-shadow: var(--shadow-sm);
        }
        
        th {
            background: var(--gradient-primary);
            color: #fff;
            padding: 1rem;
            text-align: left;
            font-weight: 700;
        }
        
        td {
            padding: 0.875rem 1rem;
            border-bottom: 1px solid var(--border-color);
        }
        
        tr:last-child td {
            border-bottom: none;
        }
        
        tr:hover {
            background: rgba(102, 126, 234, 0.05);
        }
        
        /* Alert Styles */
        .alert {
            padding: 1rem 1.25rem;
            border-radius: var(--radius-md);
            margin-bottom: 1.5rem;
            font-weight: 500;
        }
        
        .alert-success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .alert-error, .error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .alert-warning {
            background: #fff3cd;
            color: #856404;
            border: 1px solid #ffeaa7;
        }
        
        .alert-info {
            background: #d1ecf1;
            color: #0c5460;
            border: 1px solid #bee5eb;
        }
        
        /* Footer Styles */
        .app-footer {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-lg);
            padding: 1.5rem 2rem;
            margin-top: 3rem;
            text-align: center;
            box-shadow: var(--shadow-md);
        }
        
        .app-footer p {
            margin: 0.25rem 0;
            color: var(--text-muted);
            font-size: 0.875rem;
        }
        
        .app-footer .version-info {
            font-weight: 600;
            color: var(--text-secondary);
        }
        
        /* Utility Classes */
        .text-center { text-align: center; }
        .text-left { text-align: left; }
        .text-right { text-align: right; }
        .text-muted { color: var(--text-muted); }
        .mt-0 { margin-top: 0; }
        .mt-1 { margin-top: var(--spacing-sm); }
        .mt-2 { margin-top: var(--spacing-md); }
        .mt-3 { margin-top: var(--spacing-lg); }
        .mb-0 { margin-bottom: 0; }
        .mb-1 { margin-bottom: var(--spacing-sm); }
        .mb-2 { margin-bottom: var(--spacing-md); }
        .mb-3 { margin-bottom: var(--spacing-lg); }
        
        /* Responsive Design */
        @media (max-width: 768px) {
            body { padding: 1rem; }
            .container { padding: 0; }
            .card { padding: 1.5rem; }
            h1 { font-size: 2rem; }
            h2 { font-size: 1.5rem; }
        }
    </style>
    """

def get_footer_html():
    """Returns unified footer HTML with version info"""
    version_info = get_version_display()
    return f"""
    <div class="app-footer">
        <p class="version-info">Payroll Management System {version_info}</p>
        <p>© 2024-2025 | Secure Payroll Processing</p>
    </div>
    """

def get_page_template(title, content, include_menu=True, username="Unknown"):
    """
    Returns a complete HTML page with unified styling
    
    Args:
        title: Page title
        content: Main content HTML
        include_menu: Whether to include navigation menu
        username: Current logged-in username
    """
    version_display = get_version_display()
    menu_html = ""
    
    if include_menu:
        # This will be implemented to match existing menu structure
        menu_html = f"""
        <div class="navigation-menu">
            <a href="/" class="menu-item">Upload</a>
            <a href="/reports" class="menu-item">Reports</a>
            <a href="/manage_rates" class="menu-item">Manage Rates</a>
            <a href="/change_password" class="menu-item">Change Password</a>
            <a href="/logout" class="menu-item">Logout</a>
            <span class="user-info">Logged in as: {username}</span>
        </div>
        """
    
    unified_css = get_unified_css()
    footer_html = get_footer_html()
    
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>{title}</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        {unified_css}
    </head>
    <body>
        <div class="container">
            <div class="app-title">
                <h1>Simple Payroll App <span class="version-badge">{version_display}</span></h1>
            </div>
            
            {menu_html}
            
            {content}
            
            {footer_html}
        </div>
    </body>
    </html>
    """

