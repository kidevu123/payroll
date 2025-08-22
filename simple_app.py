import os
import pandas as pd
from pathlib import Path
from flask import Flask, request, send_file, render_template_string, redirect, url_for, jsonify, session, flash, get_flashed_messages
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
import json
import re
from datetime import datetime, timedelta
from functools import wraps
import csv
import random
import string
import sqlite3
import hashlib
from collections import defaultdict
import requests
from bs4 import BeautifulSoup
import time
# Selenium imports removed - not supported on PythonAnywhere

app = Flask(__name__)
app.secret_key = 'a_very_secret_key'
APP_VERSION = '6.0.1'

# Configuration
UPLOAD_FOLDER = 'uploads'
REPORT_FOLDER = 'static/reports'
CONFIG_FILE = 'pay_rates.json'
USERS_FILE = 'users.json'
DATABASE = 'payroll.db'
PAY_RATES_FILE = 'pay_rates.csv'
MISSING_TIMES_FILE = 'missing_times.csv'

# Caching for report data
report_cache = {}
report_cache_expiry = {}
REPORTS_METADATA_FILE = os.path.join(REPORT_FOLDER, 'reports_metadata.json')
REPORTS_LIST_LIMIT = int(os.getenv('REPORTS_LIST_LIMIT', '24'))

def _load_reports_metadata() -> dict:
    try:
        if os.path.exists(REPORTS_METADATA_FILE):
            with open(REPORTS_METADATA_FILE, 'r') as f:
                return json.load(f)
    except Exception:
        pass
    return {}

def _save_reports_metadata(meta: dict) -> None:
    try:
        tmp = REPORTS_METADATA_FILE + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(meta, f)
        os.replace(tmp, REPORTS_METADATA_FILE)
    except Exception:
        pass

def _ensure_report_metadata(file_path: str, filename: str, meta: dict) -> dict:
    """Ensure metadata for a report file exists and is up-to-date. Returns the record."""
    try:
        mtime = os.path.getmtime(file_path)
        rec = meta.get(filename)
        if rec and abs(rec.get('mtime', 0) - mtime) < 0.1:
            return rec

        # Extract minimal info once
        from openpyxl import load_workbook
        creator, total_amount = 'Unknown', None
        try:
            wb = load_workbook(file_path, read_only=True, data_only=True)
            ws = wb.active
            # Creator
            try:
                if 'AA1' in ws and ws['AA1'].value:
                    creator = str(ws['AA1'].value)
                elif 'A2' in ws and ws['A2'].value and 'Processed by:' in str(ws['A2'].value):
                    creator = str(ws['A2'].value).replace('Processed by:', '').strip()
            except Exception:
                pass
            # Amount: search first 30 rows for GRAND TOTAL and pick rightmost numeric
            try:
                max_rows = min(ws.max_row, 40)
                for r in range(3, max_rows + 1):
                    row_text = ''.join([str(ws.cell(row=r, column=c).value or '') for c in range(1, min(ws.max_column, 18))])
                    if 'GRAND TOTAL' in row_text.upper():
                        for c in range(min(ws.max_column, 20), 1, -1):
                            val = ws.cell(row=r, column=c).value
                            if isinstance(val, (int, float)) and val > 0:
                                total_amount = float(val)
                                break
                        break
            except Exception:
                pass
        except Exception:
            pass

        rec = {
            'mtime': mtime,
            'creator': creator,
            'total_amount': total_amount,
        }
        meta[filename] = rec
        return rec
    except Exception:
        return meta.get(filename) or {}

# ========== ZOHO BOOKS INTEGRATION CONFIG ==========
# Configuration is read from environment variables so secrets are not stored in code.
# For each company (haute, boomin) set:
#   ZB_<COMPANY>_ORG_ID, ZB_<COMPANY>_CLIENT_ID, ZB_<COMPANY>_CLIENT_SECRET, ZB_<COMPANY>_REFRESH_TOKEN
# Optional helpers (recommended to avoid extra lookups):
#   ZB_<COMPANY>_EXPENSE_ACCOUNT_NAME  (e.g., "5300 Payroll Expenses")
#   ZB_<COMPANY>_EXPENSE_ACCOUNT_ID    (Chart of Accounts ID for the expense account)
#   ZB_<COMPANY>_PAID_THROUGH_NAME     (Bank/Cash account name shown in Zoho)
#   ZB_<COMPANY>_PAID_THROUGH_ID       (Bank/Cash account ID)
#   ZB_<COMPANY>_VENDOR_ID             (Optional: vendor/contact id to tag)
# Global options:
#   ZB_DOMAIN (default https://www.zohoapis.com)
ZB_DOMAIN = os.getenv('ZB_DOMAIN', 'https://www.zohoapis.com')
ZB_ACCOUNTS_DOMAIN = os.getenv('ZB_ACCOUNTS_DOMAIN', 'https://accounts.zoho.com')

# In-memory token cache to avoid refreshing every call
zoho_token_cache = {  # company -> {access_token, expires_at}
}

def get_zoho_company_key(company_raw):
    company = (company_raw or '').strip().lower()
    if company in ('haute', 'haute-brands', 'hautebrands', 'haute_brands'):
        return 'HAUTE'
    if company in ('boomin', 'boomin-brands', 'boominbrands', 'boomin_brands', 'boominbrand', 'boomin_brand'):
        return 'BOOMIN'
    return None

def get_zoho_company_cfg(company_raw):
    key = get_zoho_company_key(company_raw)
    if not key:
        return None
    prefix = f'ZB_{key}_'
    cfg = {
        'org_id': os.getenv(prefix + 'ORG_ID', '').strip(),
        'client_id': os.getenv(prefix + 'CLIENT_ID', '').strip(),
        'client_secret': os.getenv(prefix + 'CLIENT_SECRET', '').strip(),
        'refresh_token': os.getenv(prefix + 'REFRESH_TOKEN', '').strip(),
        'expense_account_id': os.getenv(prefix + 'EXPENSE_ACCOUNT_ID', '').strip(),
        'expense_account_name': os.getenv(prefix + 'EXPENSE_ACCOUNT_NAME', '').strip(),
        'paid_through_id': os.getenv(prefix + 'PAID_THROUGH_ID', '').strip(),
        'paid_through_name': os.getenv(prefix + 'PAID_THROUGH_NAME', '').strip(),
        'vendor_id': os.getenv(prefix + 'VENDOR_ID', '').strip()
    }
    # Basic validation
    if not (cfg['org_id'] and cfg['client_id'] and cfg['client_secret'] and cfg['refresh_token']):
        return None
    return cfg

def zoho_refresh_access_token(company_raw):
    """Refresh and cache access token for a company using its refresh token."""
    cfg = get_zoho_company_cfg(company_raw)
    if not cfg:
        raise ValueError('Zoho Books credentials not configured for company: ' + str(company_raw))

    # Return cached token if valid for at least 60 seconds
    cached = zoho_token_cache.get(company_raw)
    if cached and cached.get('expires_at', 0) - time.time() > 60:
        return cached['access_token']

    token_url = f'{ZB_ACCOUNTS_DOMAIN}/oauth/v2/token'
    params = {
        'refresh_token': cfg['refresh_token'],
        'client_id': cfg['client_id'],
        'client_secret': cfg['client_secret'],
        'grant_type': 'refresh_token'
    }
    resp = requests.post(token_url, params=params, timeout=20)
    if resp.status_code != 200:
        raise RuntimeError(f"Zoho token refresh failed: {resp.status_code} {resp.text}")
    data = resp.json()
    access_token = data.get('access_token')
    expires_in = int(data.get('expires_in', 3600))
    if not access_token:
        raise RuntimeError('Zoho token refresh returned no access_token')
    zoho_token_cache[company_raw] = {
        'access_token': access_token,
        'expires_at': time.time() + expires_in
    }
    return access_token

def zoho_headers(company_raw):
    access_token = zoho_refresh_access_token(company_raw)
    return {
        'Authorization': f'Zoho-oauthtoken {access_token}',
        'Content-Type': 'application/json'
    }

def zoho_find_account_id_by_name(company_raw, account_name):
    """Find Chart of Accounts account_id by name; returns None if not found."""
    cfg = get_zoho_company_cfg(company_raw)
    url = f"{ZB_DOMAIN}/books/v3/chartofaccounts?organization_id={cfg['org_id']}&filter_by=AccountType.All&search_text={requests.utils.quote(account_name)}"
    resp = requests.get(url, headers=zoho_headers(company_raw), timeout=20)
    if resp.status_code != 200:
        return None
    for acc in resp.json().get('chartofaccounts', []) or []:
        if str(acc.get('account_name', '')).strip().lower() == account_name.strip().lower():
            return str(acc.get('account_id', '') or '')
    return None

def zoho_find_bank_account_id_by_name(company_raw, account_name):
    """Find bank/cash account id (paid through) by name; returns None if not found. Kept for potential future use."""
    cfg = get_zoho_company_cfg(company_raw)
    url = f"{ZB_DOMAIN}/books/v3/bankaccounts?organization_id={cfg['org_id']}&search_text={requests.utils.quote(account_name)}"
    resp = requests.get(url, headers=zoho_headers(company_raw), timeout=20)
    if resp.status_code != 200:
        return None
    for acc in resp.json().get('bankaccounts', []) or []:
        if str(acc.get('account_name', '')).strip().lower() == account_name.strip().lower():
            return str(acc.get('account_id', '') or '')
    return None

def compute_grand_totals_for_expense(df):
    """Recompute totals like our reports do, and return (total_hours, total_pay, total_rounded)."""
    pay_rates = load_pay_rates()
    df = df.copy()
    df['Daily Hours'] = df.apply(compute_daily_hours, axis=1)
    df['Hourly Rate'] = df['Person ID'].astype(str).map(pay_rates).fillna(15.0)
    df['Daily Pay'] = (df['Daily Hours'] * df['Hourly Rate']).round(2)
    weekly_totals = df.groupby('Person ID').agg(
        Total_Hours=('Daily Hours', 'sum'),
        Weekly_Total=('Daily Pay', 'sum')
    ).reset_index()
    weekly_totals['Total_Hours'] = weekly_totals['Total_Hours'].round(2)
    weekly_totals['Weekly_Total'] = weekly_totals['Weekly_Total'].round(2)
    weekly_totals['Rounded_Weekly'] = weekly_totals['Weekly_Total'].round(0).astype(int)
    total_hours = float(weekly_totals['Total_Hours'].sum().round(2)) if len(weekly_totals) else 0.0
    total_pay = float(weekly_totals['Weekly_Total'].sum().round(2)) if len(weekly_totals) else 0.0
    total_rounded = int(weekly_totals['Rounded_Weekly'].sum()) if len(weekly_totals) else 0
    return total_hours, total_pay, total_rounded

def compute_expense_date_from_data(week_str: str) -> str:
    """Compute expense posting date as end-of-week + 1 day.
    Preference: use the uploaded CSV's max(Date) + 1. Fallback: parse week_str and add 7 days.
    Returns YYYY-MM-DD string.
    """
    try:
        uploaded_file = session.get('uploaded_file')
        if uploaded_file and os.path.exists(uploaded_file):
            df = pd.read_csv(uploaded_file)
            if 'Date' in df.columns:
                try:
                    df['Date'] = pd.to_datetime(df['Date'])
                    post_date = (df['Date'].max() + pd.Timedelta(days=1)).date()
                    return post_date.strftime('%Y-%m-%d')
                except Exception:
                    pass
    except Exception:
        pass

    # Fallback: week_str (usually min date) + 7 days
    try:
        base = pd.to_datetime(week_str).date()
        return (base + timedelta(days=7)).strftime('%Y-%m-%d')
    except Exception:
        # Last resort: today's date
        return datetime.now().strftime('%Y-%m-%d')

def compute_week_range_strings(week_str: str):
    """Return (start_date_str, end_date_str) for the current run.
    Prefers actual min/max from uploaded CSV; falls back to week_str .. week_str+6.
    """
    try:
        uploaded_file = session.get('uploaded_file')
        if uploaded_file and os.path.exists(uploaded_file):
            df = pd.read_csv(uploaded_file)
            if 'Date' in df.columns:
                try:
                    df['Date'] = pd.to_datetime(df['Date'])
                    start = df['Date'].min().date()
                    end = df['Date'].max().date()
                    return start.strftime('%Y-%m-%d'), end.strftime('%Y-%m-%d')
                except Exception:
                    pass
    except Exception:
        pass

    try:
        base = pd.to_datetime(week_str).date()
        return base.strftime('%Y-%m-%d'), (base + timedelta(days=6)).strftime('%Y-%m-%d')
    except Exception:
        today = datetime.now().date()
        return today.strftime('%Y-%m-%d'), (today + timedelta(days=6)).strftime('%Y-%m-%d')

def _get_existing_expense(company: str, week: str):
    """Return previously created expense_id for company+week from session, if any."""
    try:
        key = f"{company}|{week}"
        mapping = session.get('zoho_expenses', {}) or {}
        return mapping.get(key)
    except Exception:
        return None

def _set_existing_expense(company: str, week: str, expense_id: str):
    """Persist expense id in session to avoid duplicate creations for same run."""
    try:
        key = f"{company}|{week}"
        mapping = session.get('zoho_expenses', {}) or {}
        mapping[key] = str(expense_id)
        session['zoho_expenses'] = mapping
    except Exception:
        pass

def _clear_existing_expense(company: str, week: str):
    """Remove stored expense id for company+week from session mapping."""
    try:
        key = f"{company}|{week}"
        mapping = session.get('zoho_expenses', {}) or {}
        if key in mapping:
            del mapping[key]
            session['zoho_expenses'] = mapping
    except Exception:
        pass

def zoho_get_expense(company_raw, expense_id: str):
    """Return expense JSON if it exists, else None."""
    try:
        cfg = get_zoho_company_cfg(company_raw)
        url = f"{ZB_DOMAIN}/books/v3/expenses/{expense_id}?organization_id={cfg['org_id']}"
        resp = requests.get(url, headers=zoho_headers(company_raw), timeout=20)
        if resp.status_code == 200:
            return resp.json()
        return None
    except Exception:
        return None

def build_admin_summary_text_from_csv(file_path: str, start_str: str, end_str: str) -> str:
    """Create a compact text version of the admin summary (top table) for Notes.
    Uses the uploaded CSV to recompute the same summary to avoid brittle Excel parsing.
    """
    try:
        if not file_path or not os.path.exists(file_path):
            return ''
        df = pd.read_csv(file_path)
        # Ensure required columns
        req_cols = ['Person ID', 'First Name', 'Last Name', 'Date']
        if not all(col in df.columns for col in req_cols):
            return ''
        # Compute like report
        pay_rates = load_pay_rates()
        if 'Daily Hours' not in df.columns:
            # Derive from Total Work Time when present
            if 'Total Work Time(h)' in df.columns:
                df['Daily Hours'] = df['Total Work Time(h)'].apply(parse_work_hours)
            else:
                # Fallback from Clock In/Out
                df['Daily Hours'] = df.apply(compute_daily_hours, axis=1)
        df['Hourly Rate'] = df['Person ID'].astype(str).map(pay_rates).fillna(15.0)
        df['Daily Pay'] = (df['Daily Hours'] * df['Hourly Rate']).round(2)
        weekly_totals = df.groupby('Person ID').agg(
            Total_Hours=('Daily Hours', 'sum'),
            Weekly_Total=('Daily Pay', 'sum'),
            First_Name=('First Name', 'first'),
            Last_Name=('Last Name', 'first')
        ).reset_index()
        weekly_totals['Total_Hours'] = weekly_totals['Total_Hours'].round(2)
        weekly_totals['Weekly_Total'] = weekly_totals['Weekly_Total'].round(2)
        weekly_totals['Rounded_Weekly'] = weekly_totals['Weekly_Total'].round(0).astype(int)
        # Grand totals
        grand_hours = float(weekly_totals['Total_Hours'].sum().round(2)) if len(weekly_totals) else 0.0
        grand_pay = float(weekly_totals['Weekly_Total'].sum().round(2)) if len(weekly_totals) else 0.0
        grand_rounded = int(weekly_totals['Rounded_Weekly'].sum()) if len(weekly_totals) else 0
        # Build lines
        lines = [
            f"Payroll Summary — {start_str} to {end_str}",
            "Person ID | Employee | Hours | Pay | Rounded"
        ]
        # Sort by employee name for readability
        weekly_totals = weekly_totals.sort_values(['First_Name', 'Last_Name'])
        for _, row in weekly_totals.iterrows():
            full_name = f"{row['First_Name']} {row['Last_Name']}".strip()
            lines.append(
                f"{row['Person ID']} | {full_name} | {row['Total_Hours']:.2f} | ${row['Weekly_Total']:.2f} | ${int(row['Rounded_Weekly'])}"
            )
        lines.append(f"GRAND TOTAL | | {grand_hours:.2f} | ${grand_pay:.2f} | ${grand_rounded}")
        return "\n".join(lines)
    except Exception:
        return ''

def _compose_zoho_description(base_desc: str, auto_notes: str, extra_desc: str, max_len: int = 500) -> str:
    """Build description prioritizing user notes over auto summary within Zoho's 500-char limit.
    Order: base, user extra notes, then as much of auto summary as fits.
    """
    try:
        base = (base_desc or '').strip()
        extra = (extra_desc or '').strip()
        auto = (auto_notes or '').strip()

        # Start with base and extra notes
        header_parts = [p for p in [base, extra] if p]
        header = "\n\n".join(header_parts)
        if len(header) >= max_len:
            # Trim header but keep user note visible
            return (header[: max_len - 1] + '…') if max_len > 1 else header[:max_len]

        # Fit as much auto summary as possible in remaining space
        remaining = max_len - len(header)
        # account for separator if both header and auto present
        if header and auto:
            remaining -= 2  # for "\n\n"
        if remaining <= 0 or not auto:
            return header

        if len(auto) <= remaining:
            return header + ("\n\n" if header else "") + auto

        # Need to trim auto summary; add friendly suffix
        suffix = " … (see attachment)"
        room = max(0, remaining - len(suffix))
        trimmed_auto = (auto[:room].rstrip() + suffix) if room > 0 else suffix.strip()
        return header + ("\n\n" if header else "") + trimmed_auto
    except Exception:
        return (base_desc or '')[:max_len]

def zoho_create_expense(company_raw, *, date_str, amount, account_id=None, account_name=None,
                        description=None, reference_number=None, tax_id=None,
                        is_inclusive_tax=False, paid_through_account_id=None, paid_through_account_name=None):
    """Create an Expense in Zoho Books and return expense_id."""
    cfg = get_zoho_company_cfg(company_raw)
    if not cfg:
        raise ValueError('Missing Zoho configuration for company: ' + str(company_raw))

    # Resolve IDs if not provided but names are configured
    resolved_account_id = account_id or (cfg['expense_account_id'] if cfg['expense_account_id'] else None)
    if not resolved_account_id and (account_name or cfg['expense_account_name']):
        resolved_account_id = zoho_find_account_id_by_name(company_raw, account_name or cfg['expense_account_name'])

    payload = {
        'account_id': resolved_account_id,
        'date': date_str,
        'amount': amount,
        'is_inclusive_tax': bool(is_inclusive_tax),
        'reference_number': reference_number or '',
        'description': description or ''
    }

    # Enforce Zoho's 500-character limit on description defensively
    try:
        if isinstance(payload.get('description'), str) and len(payload['description']) > 490:
            suffix = ' … (see attachment)'
            cutoff = 500 - len(suffix)
            if cutoff > 0:
                payload['description'] = payload['description'][:cutoff].rstrip() + suffix
            else:
                payload['description'] = payload['description'][:500]
    except Exception:
        pass

    # Prefer resolving Paid Through to an account_id if possible
    resolved_paid_id = paid_through_account_id
    if not resolved_paid_id:
        name_to_use = paid_through_account_name or cfg.get('paid_through_name')
        if name_to_use:
            try:
                resolved_paid_id = zoho_find_bank_account_id_by_name(company_raw, name_to_use)
            except Exception:
                resolved_paid_id = None
    if resolved_paid_id:
        payload['paid_through_account_id'] = resolved_paid_id
    elif paid_through_account_name or cfg.get('paid_through_name'):
        # Fallback to name if ID lookup fails
        payload['paid_through_account_name'] = paid_through_account_name or cfg.get('paid_through_name')

    if tax_id:
        payload['tax_id'] = tax_id

    url = f"{ZB_DOMAIN}/books/v3/expenses?organization_id={cfg['org_id']}"
    resp = requests.post(url, headers=zoho_headers(company_raw), data=json.dumps(payload), timeout=30)
    if resp.status_code not in (200, 201):
        # Retry once with a trimmed description if server complains about Description length
        try:
            txt = resp.text or ''
            if 'Description' in txt or '500 characters' in txt or 'code":15' in txt:
                desc = payload.get('description') or ''
                suffix = ' …'
                payload['description'] = (desc[: max(0, 500 - len(suffix))] + suffix)[:500]
                resp = requests.post(url, headers=zoho_headers(company_raw), data=json.dumps(payload), timeout=30)
        except Exception:
            pass
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Failed to create expense: {resp.status_code} {resp.text}")
    data = resp.json()
    expense_id = str((data.get('expense') or {}).get('expense_id') or (data.get('expenses') or {}).get('expense_id') or '')
    if not expense_id:
        # Some responses wrap under 'expense'
        expense_id = str((data.get('expense') or {}).get('expense_id') or '')
    if not expense_id:
        raise RuntimeError('Expense created but no expense_id returned: ' + str(data))
    return expense_id

def zoho_attach_receipt(company_raw, expense_id, file_path):
    """Attach a file to an expense as receipt. Will attempt direct upload; if unsupported type, raise error."""
    cfg = get_zoho_company_cfg(company_raw)
    url = f"{ZB_DOMAIN}/books/v3/expenses/{expense_id}/receipt?organization_id={cfg['org_id']}"
    headers = {
        'Authorization': zoho_headers(company_raw)['Authorization']
    }
    filename = os.path.basename(file_path)
    # Guess mime
    mime = 'application/octet-stream'
    if filename.lower().endswith('.pdf'):
        mime = 'application/pdf'
    elif filename.lower().endswith('.xlsx'):
        mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    elif filename.lower().endswith('.xls'):
        mime = 'application/vnd.ms-excel'

    with open(file_path, 'rb') as f:
        files = {
            'receipt': (filename, f, mime)
        }
        resp = requests.post(url, headers=headers, files=files, timeout=60)
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Failed to attach receipt: {resp.status_code} {resp.text}")
    return True

# Make sure required directories exist
Path(UPLOAD_FOLDER).mkdir(parents=True, exist_ok=True)
Path(REPORT_FOLDER).mkdir(parents=True, exist_ok=True)

# Default admin user (will be created if no users exist)
DEFAULT_USERNAME = 'admin'
DEFAULT_PASSWORD = 'password'

# User management functions
def load_users():
    """Load users from JSON file"""
    try:
        with open(USERS_FILE, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        # Create default user if no users file exists
        users = {DEFAULT_USERNAME: DEFAULT_PASSWORD}
        save_users(users)
        return users

def save_users(users):
    """Save users to JSON file"""
    with open(USERS_FILE, 'w') as f:
        json.dump(users, f, indent=2)

# Login required decorator
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

# Pay rate management functions
def load_pay_rates():
    """Load pay rates from JSON file"""
    try:
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}  # Return empty dict if file doesn't exist or is invalid

def save_pay_rates(rates):
    """Save pay rates to JSON file"""
    with open(CONFIG_FILE, 'w') as f:
        json.dump(rates, f, indent=2)

# ========== LOGIN ROUTES ==========

@app.route('/login', methods=['GET', 'POST'])
def login():
    """Handle user login"""
    error = None
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']

        users = load_users()

        if username in users and users[username] == password:
            session['logged_in'] = True
            session['username'] = username
            next_page = request.args.get('next')
            if next_page and next_page.startswith('/'):
                return redirect(next_page)
            return redirect(url_for('index'))
        else:
            error = 'Invalid credentials. Please try again.'

    # Login form
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Login - Simple Payroll App</title>
        <style>
            :root{ --bg:#f5f7fb; --card:#ffffff; --text:#2d3748; --muted:#6c757d; --primary:#4CAF50; --primary-700:#388e3c; --border:#e6e9f0; }
            *{ box-sizing:border-box; }
            body{ font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; margin:32px; line-height:1.6; background:var(--bg); color:var(--text); }
            h1{ color:var(--text); margin:0; font-weight:800; }
            .login-container{ max-width:420px; margin:0 auto; padding:22px; background:var(--card); border:1px solid var(--border); border-radius:14px; box-shadow:0 10px 24px rgba(17,24,39,.06); }
            .form-group{ margin-bottom:15px; }
            label{ display:block; margin-bottom:6px; font-weight:600; }
            input[type="text"], input[type="password"]{ width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:10px; outline:none; }
            input[type="text"]:focus, input[type="password"]:focus{ border-color:var(--primary-700); box-shadow:0 0 0 3px rgba(76,175,80,.15); }
            .button{ display:inline-block; width:100%; padding:10px 16px; background:linear-gradient(135deg,var(--primary) 0%,var(--primary-700) 100%); color:#fff; border:none; cursor:pointer; border-radius:10px; font-weight:700; box-shadow:0 6px 14px rgba(0,0,0,.08); }
            .button:hover{ transform:translateY(-1px); box-shadow:0 10px 18px rgba(0,0,0,.12); }
            .error{ color:#dc3545; padding:10px; margin-bottom:15px; border-radius:10px; background:#f8d7da; border:1px solid #f5c6cb; }
            .app-title{ text-align:center; margin-bottom:22px; background:linear-gradient(135deg,#e3f2fd 0%, #f1f8e9 100%); padding:14px; border-radius:14px; border:1px solid var(--border); box-shadow:0 4px 10px rgba(17,24,39,.04); }
        </style>
    </head>
    <body>
        <div class=\"app-title\">\n            <h1>Simple Payroll App <span style=\"font-size:.6em; color:#6c757d; font-weight:600;\">v{APP_VERSION}</span></h1>\n        </div>

        <div class="login-container">
            <h2>Login</h2>

            {% if error %}
            <div class="error">{{ error }}</div>
            {% endif %}

            <form action="{{ url_for('login', next=request.args.get('next', '')) }}" method="post">
                <div class="form-group">
                    <label for="username">Username:</label>
                    <input type="text" id="username" name="username" required autofocus>
                </div>

                <div class="form-group">
                    <label for="password">Password:</label>
                    <input type="password" id="password" name="password" required>
                </div>

                <button type="submit" class="button">Login</button>
            </form>
        </div>
    </body>
    </html>
    """
    return render_template_string(html, error=error, request=request)

@app.route('/logout')
def logout():
    """Log out user"""
    session.pop('logged_in', None)
    session.pop('username', None)
    return redirect(url_for('login'))

@app.route('/change_password', methods=['GET', 'POST'])
@login_required
def change_password():
    """Change user password"""
    error = None
    success = None
    username = session.get('username', 'Unknown')
    menu_html = get_menu_html(username)

    if request.method == 'POST':
        current_password = request.form['current_password']
        new_password = request.form['new_password']
        confirm_password = request.form['confirm_password']

        users = load_users()

        if users.get(username) != current_password:
            error = 'Current password is incorrect'
        elif new_password != confirm_password:
            error = 'New passwords do not match'
        elif len(new_password) < 4:
            error = 'Password must be at least 4 characters'
        else:
            users[username] = new_password
            save_users(users)
            success = 'Password changed successfully'

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Change Password</title>
        <style>
            body {{ font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }}
            h1 {{ color: #333; }}
            .form-container {{
                max-width: 500px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f8f9fa;
                border-radius: 5px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            }}
            .form-group {{
                margin-bottom: 15px;
            }}
            label {{
                display: block;
                margin-bottom: 5px;
                font-weight: bold;
            }}
            input[type="password"] {{
                width: 100%;
                padding: 10px;
                border: 1px solid #ddd;
                border-radius: 3px;
                box-sizing: border-box;
            }}
            .button {{
                display: inline-block;
                padding: 10px 15px;
                background-color: #4CAF50;
                color: white;
                border: none;
                cursor: pointer;
                border-radius: 3px;
            }}
            .error {{
                color: #dc3545;
                padding: 10px;
                margin-bottom: 15px;
                border-radius: 3px;
                background-color: #f8d7da;
                border: 1px solid #f5c6cb;
            }}
            .success {{
                color: #28a745;
                padding: 10px;
                margin-bottom: 15px;
                border-radius: 3px;
                background-color: #d4edda;
                border: 1px solid #c3e6cb;
            }}
            .menu {{
                background-color: #f8f9fa;
                padding: 15px;
                margin-bottom: 20px;
                border-radius: 5px;
            }}
            .menu a {{
                margin-right: 15px;
                text-decoration: none;
                color: #0275d8;
            }}
            .menu a:hover {{
                text-decoration: underline;
            }}
            .user-info {{
                float: right;
                font-size: 0.9em;
                color: #6c757d;
            }}
        </style>
    </head>
    <body>
        <h1>Change Password</h1>
        {menu_html}
        <div class="form-container">
            {('<div class="error">' + error + '</div>') if error else ''}
            {('<div class="success">' + success + '</div>') if success else ''}

            <form action="/change_password" method="post">
                <div class="form-group">
                    <label for="current_password">Current Password:</label>
                    <input type="password" id="current_password" name="current_password" required>
                </div>

                <div class="form-group">
                    <label for="new_password">New Password:</label>
                    <input type="password" id="new_password" name="new_password" required>
                </div>

                <div class="form-group">
                    <label for="confirm_password">Confirm New Password:</label>
                    <input type="password" id="confirm_password" name="confirm_password" required>
                </div>

                <button type="submit" class="button">Change Password</button>
            </form>
        </div>
    </body>
    </html>
    """
    return render_template_string(html, error=error, success=success)

# ========== CORE FUNCTIONS ==========

def process_csv_data(file_path):
    """Process CSV timesheet data"""
    df = pd.read_csv(file_path, parse_dates=['Date'])

    # Clean data
    df = df.dropna(subset=['Person ID', 'First Name', 'Last Name'])

    # Calculate daily hours - simplified approach
    def parse_work_hours(time_str):
        try:
            if pd.isna(time_str) or str(time_str).strip() == '':
                return 0.0
            parts = list(map(float, str(time_str).split(':')))
            return round(parts[0] + parts[1]/60 + parts[2]/3600, 2)
        except:
            return 0.0

    df['Daily Hours'] = df['Total Work Time(h)'].apply(parse_work_hours)

    # Use fixed pay rates for this simplified version
    df['Hourly Rate'] = 15.0  # Fixed hourly rate

    # Calculate daily pay
    df['Daily Pay'] = (df['Daily Hours'] * df['Hourly Rate']).round(2)

    # Calculate weekly totals
    weekly_totals = df.groupby('Person ID').agg(
        Total_Hours=('Daily Hours', 'sum'),
        Weekly_Total=('Daily Pay', 'sum'),
        First_Name=('First Name', 'first'),
        Last_Name=('Last Name', 'first')
    ).reset_index()

    # Apply rounding
    weekly_totals['Total_Hours'] = weekly_totals['Total_Hours'].round(2)
    weekly_totals['Weekly_Total'] = weekly_totals['Weekly_Total'].round(2)
    weekly_totals['Rounded_Weekly'] = weekly_totals['Weekly_Total'].round(0).astype(int)

    # Merge weekly totals back to each employee's daily records
    df = pd.merge(
        df,
        weekly_totals[['Person ID', 'Total_Hours', 'Weekly_Total', 'Rounded_Weekly']],
        on='Person ID'
    )

    return df[df['Daily Hours'] > 0]

def create_report(df, week_str):
    """Create a simple Excel report"""
    wb = Workbook()
    ws = wb.active
    ws.title = "Payroll Report"

    # Simple header
    ws['A1'] = f"Payroll Report - {week_str}"
    ws['A1'].font = Font(bold=True, size=14)

    # Headers
    headers = ["ID", "Employee", "Total Hours", "Pay", "Rounded Pay"]
    ws.append(headers)

    # Data rows
    seen_employees = set()
    for emp_id, group in df.groupby('Person ID'):
        if emp_id in seen_employees:
            continue

        seen_employees.add(emp_id)
        employee = group.iloc[0]

        ws.append([
            emp_id,
            f"{employee['First Name']} {employee['Last Name']}",
            employee['Total_Hours'],
            employee['Weekly_Total'],
            employee['Rounded_Weekly']
        ])

    # Save the report
    report_path = Path(REPORT_FOLDER) / f"Payroll_Report_{week_str}.xlsx"
    wb.save(report_path)

    return report_path

# ========== ROUTES ==========

def get_menu_html(username):
    """Generate HTML for the menu bar based on user role"""
    is_admin = username == 'admin'

    # Use proper string concatenation to avoid issues with nested quotes and f-strings
    admin_link = '<a href="/manage_users">Manage Users</a>' if is_admin else ''

    return '''
    <div class="menu">
        <a href="/">Home</a>
        <a href="/fetch_timecard" style="background-color: #2196F3;">Fetch from NGTeco</a>
        <a href="/manage_rates">Manage Pay Rates</a>
        <a href="/reports">Reports</a>
        ''' + admin_link + '''
        <a href="/change_password">Change Password</a>
        <a href="/logout">Logout</a>
        <span class="user-info">Logged in as: ''' + username + '''</span>
    </div>
    '''

@app.route('/')
@login_required
def index():
    """Simple upload form"""
    username = session.get('username', 'Unknown')
    menu_html = get_menu_html(username)

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Simple Payroll App</title>
        <style>
            :root{{ --bg:#f5f7fb; --card:#ffffff; --text:#2d3748; --muted:#6c757d; --primary:#4CAF50; --primary-700:#388e3c; --accent:#2196F3; --accent-700:#1976d2; --border:#e6e9f0; }}
            *{{ box-sizing: border-box; }}
            body{{ font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; margin:32px; line-height:1.6; background:var(--bg); color:var(--text); }}
            .app-title{{ background:linear-gradient(135deg,#e3f2fd 0%, #f1f8e9 100%); padding:16px 18px; border-radius:14px; border:1px solid var(--border); box-shadow:0 4px 10px rgba(17,24,39,.04); margin:0 0 16px; }}
            h1{{ margin:0; font-weight:800; color:var(--text); }}
            form{{ margin: 16px 0; }}
            .button{{ display:inline-block; padding:10px 16px; background:linear-gradient(135deg,var(--primary) 0%,var(--primary-700) 100%); color:#fff; border:none; cursor:pointer; border-radius:10px; box-shadow:0 6px 14px rgba(0,0,0,.08); font-weight:600; }}
            .button:hover{{ transform: translateY(-1px); box-shadow:0 10px 18px rgba(0,0,0,.12); }}
            .card{{ background:var(--card); border:1px solid var(--border); border-radius:14px; padding:20px; box-shadow:0 10px 24px rgba(17,24,39,.06); margin-bottom:20px; }}
            .info{{ border-left:6px solid var(--accent); }}
            .info h2{{ margin-top:0; color:var(--accent-700); }}
            .menu{{ background:var(--card); padding:14px 16px; margin-bottom:20px; border-radius:12px; border:1px solid var(--border); box-shadow:0 4px 10px rgba(17,24,39,.04); }}
            .menu a{{ margin-right:14px; text-decoration:none; color:var(--accent-700); font-weight:600; padding:6px 10px; border-radius:8px; }}
            .menu a:hover{{ background:rgba(33,150,243,.08); }}
            .user-info{{ float:right; font-size:.9em; color:var(--muted); }}

            /* Drag & drop */
            .dropzone{{ border:2px dashed var(--accent-700); border-radius:14px; padding:28px; text-align:center; background:linear-gradient(135deg,#ffffff 0%, #f5fbff 100%); cursor:pointer; transition: all .15s ease; }}
            .dropzone:hover{{ background:#f0f7ff; }}
            .dropzone.dragover{{ background:#e3f2fd; border-color:var(--accent); box-shadow:0 0 0 4px rgba(33,150,243,.15) inset; }}
            .file-note{{ margin-top:10px; color:var(--muted); font-size:.95em; }}
        </style>
    </head>
    <body>
        <div class="app-title"><h1>Simple Payroll App <span style=\"font-size:.6em; color:var(--muted); font-weight:600;\">v{APP_VERSION}</span></h1></div>
        {menu_html}
        <div class="card info">
            <h2>What's New</h2>
            <ul>
                <li><strong>v6.0</strong>: Zoho Books one‑click expense push with PDF/XLS attachment, auto summary in notes, duplicates guard, and sleek new UI.</li>
                <li>Drag & drop CSV uploader on the home page.</li>
                <li>Print‑friendly admin and payslip views with compact layout.</li>
                <li>Improved payroll date posting (end‑of‑week + 1 day).</li>
            </ul>
        </div>
        <div class="card">
            <form id="upload-form" action="/validate" method="post" enctype="multipart/form-data">
                <p>Upload CSV file with timesheet data:</p>
                <div id="dropzone" class="dropzone">
                    <strong>Drag & drop</strong> your CSV here, or <u>click to choose</u>
                    <div id="file-note" class="file-note">No file selected</div>
                    <input id="file-input" type="file" name="file" accept=".csv" style="display:none" required>
                </div>
                <div style="margin-top:14px;">
                    <button type="submit" class="button">Process File</button>
                </div>
            </form>
        </div>
        <script>
        (function(){{
            const dz = document.getElementById('dropzone');
            const input = document.getElementById('file-input');
            const note = document.getElementById('file-note');
            const updateNote = (file)=>{{ if(!file){{ note.textContent='No file selected'; return; }} note.textContent = 'Selected: ' + file.name; }};
            dz.addEventListener('click', ()=> input.click());
            input.addEventListener('change', ()=> updateNote(input.files && input.files[0]));
            ;['dragenter','dragover'].forEach(evt=> dz.addEventListener(evt, (e)=>{{ e.preventDefault(); e.stopPropagation(); dz.classList.add('dragover'); }}));
            ;['dragleave','drop'].forEach(evt=> dz.addEventListener(evt, (e)=>{{ e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragover'); }}));
            dz.addEventListener('drop', (e)=>{{
                const files = e.dataTransfer && e.dataTransfer.files; if(!files || !files.length) return;
                try{{
                    const dt = new DataTransfer(); dt.items.add(files[0]); input.files = dt.files;
                }}catch(err){{
                    // Fallback: set via click prompt if assignment blocked
                }}
                updateNote(files[0]);
            }});
        }})();
        </script>
    </body>
    </html>
    """
    return render_template_string(html)

@app.route('/manage_rates')
@login_required
def manage_rates():
    """Manage employee pay rates"""
    username = session.get('username', 'Unknown')
    menu_html = get_menu_html(username)
    pay_rates = load_pay_rates()

    # Convert to sorted list for display
    employees = []
    for emp_id, rate in pay_rates.items():
        employees.append({
            'id': emp_id,
            'rate': rate
        })

    # Sort by ID
    employees.sort(key=lambda x: x['id'])

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Manage Pay Rates</title>
        <style>
            :root{{ --bg:#f5f7fb; --card:#ffffff; --text:#2d3748; --muted:#6c757d; --primary:#4CAF50; --accent:#2196F3; --border:#e6e9f0; }}
            body{{ font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; margin:32px; line-height:1.6; background:var(--bg); color:var(--text); }}
            h1,h2{{ color:var(--text); }}
            form{{ margin: 20px 0; }}
            .button{{ display:inline-block; padding:10px 15px; background:linear-gradient(135deg,var(--primary) 0%, #388e3c 100%); color:#fff; border:none; cursor:pointer; margin-top:10px; border-radius:10px; font-weight:600; box-shadow:0 6px 14px rgba(0,0,0,.08); }}
            table{{ width:100%; border-collapse:collapse; margin:20px 0; }}
            th,td{{ padding:10px; border:1px solid var(--border); text-align:left; }}
            th{{ background:#f2f6ff; }}
            tr:nth-child(even){{ background:#fafbff; }}
            .menu{{ background:var(--card); padding:14px 16px; margin-bottom:20px; border-radius:12px; border:1px solid var(--border); box-shadow:0 4px 10px rgba(17,24,39,.04); }}
            .menu a{{ margin-right:14px; text-decoration:none; color:#1976d2; font-weight:600; padding:6px 10px; border-radius:8px; }}
            .menu a:hover{{ background:rgba(33,150,243,.08); }}
            .user-info{{ float:right; font-size:.9em; color:var(--muted); }}
        </style>
    </head>
    <body>
        <h1>Manage Pay Rates <span style="font-size:.6em; color:#6c757d; font-weight:600;">v{APP_VERSION}</span></h1>
        {menu_html}
        <h2>Current Pay Rates</h2>
    """

    if employees:
        html += """
        <table>
            <tr>
                <th>Employee ID</th>
                <th>Pay Rate ($/hour)</th>
                <th>Action</th>
            </tr>
        """

        for emp in employees:
            html += f"""
            <tr>
                <td>{emp['id']}</td>
                <td>${emp['rate']:.2f}</td>
                <td>
                    <form action="/delete_rate" method="post" style="margin:0;">
                        <input type="hidden" name="emp_id" value="{emp['id']}">
                        <button type="submit" onclick="return confirm('Are you sure you want to delete this pay rate?');">Delete</button>
                    </form>
                </td>
            </tr>
            """

        html += "</table>"
    else:
        html += "<p>No pay rates configured yet. Add your first rate below.</p>"

    html += """
        <h2>Add New Pay Rate</h2>
        <form action="/add_rate" method="post">
            <div>
                <label for="emp_id">Employee ID:</label>
                <input type="text" id="emp_id" name="emp_id" required>
            </div>
            <div style="margin-top: 10px;">
                <label for="pay_rate">Pay Rate ($/hour):</label>
                <input type="number" id="pay_rate" name="pay_rate" step="0.01" min="0" required>
            </div>
            <button type="submit" class="button">Add Pay Rate</button>
        </form>

        <div style="margin-top: 30px;">
            <h2>Bulk Import Pay Rates</h2>
            <p>Upload a CSV file with columns "Person ID" and "Rate".</p>
            <form action="/import_rates" method="post" enctype="multipart/form-data">
                <input type="file" name="rates_file" required>
                <button type="submit" class="button">Import Rates</button>
            </form>
        </div>
    </body>
    </html>
    """

    return render_template_string(html)

@app.route('/add_rate', methods=['POST'])
def add_rate():
    """Add a new pay rate"""
    try:
        emp_id = request.form['emp_id']
        pay_rate = float(request.form['pay_rate'])

        # Validate
        if pay_rate <= 0:
            return "Pay rate must be greater than zero", 400

        # Load existing rates
        pay_rates = load_pay_rates()

        # Add new rate
        pay_rates[emp_id] = pay_rate

        # Save updated rates
        save_pay_rates(pay_rates)

        return redirect(url_for('manage_rates'))
    except Exception as e:
        return f"Error adding pay rate: {str(e)}", 400

@app.route('/delete_rate', methods=['POST'])
def delete_rate():
    """Delete a pay rate"""
    try:
        emp_id = request.form['emp_id']

        # Load existing rates
        pay_rates = load_pay_rates()

        # Delete rate if exists
        if emp_id in pay_rates:
            del pay_rates[emp_id]

        # Save updated rates
        save_pay_rates(pay_rates)

        return redirect(url_for('manage_rates'))
    except Exception as e:
        return f"Error deleting pay rate: {str(e)}", 400

@app.route('/import_rates', methods=['POST'])
def import_rates():
    """Import pay rates from CSV"""
    try:
        if 'rates_file' not in request.files:
            return "No file uploaded", 400

        file = request.files['rates_file']
        if file.filename == '':
            return "No file selected", 400

        # Check if it's a CSV
        if not file.filename.endswith('.csv'):
            return "Only CSV files allowed", 400

        # Save and process file
        file_path = os.path.join(UPLOAD_FOLDER, 'rates_' + file.filename)
        file.save(file_path)

        # Read CSV
        df = pd.read_csv(file_path)

        # Check for required columns
        required_cols = ['Person ID', 'Rate']
        if not all(col in df.columns for col in required_cols):
            return "CSV must have 'Person ID' and 'Rate' columns", 400

        # Load existing rates
        pay_rates = load_pay_rates()

        # Update rates
        for _, row in df.iterrows():
            emp_id = str(row['Person ID'])
            rate = float(row['Rate'])
            if rate > 0:
                pay_rates[emp_id] = rate

        # Save updated rates
        save_pay_rates(pay_rates)

        return redirect(url_for('manage_rates'))
    except Exception as e:
        return f"Error importing pay rates: {str(e)}", 400

def parse_work_hours(time_str):
    """Parse timesheet hours from string format"""
    try:
        if pd.isna(time_str) or str(time_str).strip() == '':
            return 0.0
        parts = list(map(float, str(time_str).split(':')))
        return round(parts[0] + parts[1]/60 + parts[2]/3600, 2)
    except:
        return 0.0

def compute_daily_hours(row):
    twh = row['Total Work Time(h)']
    # If Total Work Time is missing but Clock In/Out are present, derive it
    if pd.isna(twh) or str(twh).strip() == '':
        # Check if Clock In and Clock Out columns exist and have values
        if 'Clock In' in row and 'Clock Out' in row:
            clock_in = row['Clock In']
            clock_out = row['Clock Out']

            # Debug logging
            if 'Person ID' in row and row['Person ID'] in [2, 3]:  # Hilda and Sehreesh
                print(f"DEBUG compute_daily_hours for Person {row['Person ID']}:")
                print(f"  Clock In raw: '{clock_in}', type: {type(clock_in)}")
                print(f"  Clock Out raw: '{clock_out}', type: {type(clock_out)}")
                print(f"  Clock In stripped: '{str(clock_in).strip()}'")
                print(f"  Clock Out stripped: '{str(clock_out).strip()}'")

            # Verify both values are not empty/null
            if (pd.notna(clock_in) and pd.notna(clock_out) and
                str(clock_in).strip() != '' and str(clock_out).strip() != ''):
                try:
                    # Try to parse the time values
                    start = datetime.strptime(str(clock_in).strip(), '%H:%M:%S')
                    end = datetime.strptime(str(clock_out).strip(), '%H:%M:%S')
                    diff = end - start

                    # Handle overnight shift (e.g., Clock In at 22:00:00, Clock Out at 06:00:00)
                    if diff.total_seconds() < 0:
                        diff += timedelta(days=1)

                    # Return hours rounded to 2 decimal places
                    hours = diff.total_seconds() / 3600
                    return round(hours, 2)
                except ValueError as e:
                    # If time parsing fails, return 0
                    if 'Person ID' in row and row['Person ID'] in [2, 3]:
                        print(f"  ERROR parsing times: {e}")
                    return 0.0


        return 0.0
    # otherwise parse the provided Total Work Time
    return parse_work_hours(twh)

def create_excel_report(df, filename, creator=None):
    """Create an Excel report from the DataFrame with proper timesheet formatting"""
    wb = Workbook()
    ws = wb.active
    ws.title = "Payroll Report"

    # Get the creator (username) - use parameter or default to Unknown
    if not creator:
        creator = "Unknown"

    # Check if we have the original timesheet format
    is_timesheet_format = all(col in df.columns for col in
                             ['Person ID', 'First Name', 'Last Name', 'Date', 'Total Work Time(h)'])

    if is_timesheet_format:
        # This is the original timesheet format - process properly
        # Load pay rates
        pay_rates = load_pay_rates()

        # Calculate daily hours
        df['Daily Hours'] = df.apply(compute_daily_hours, axis=1)

        # Assign pay rates - use stored rates or default
        df['Hourly Rate'] = df['Person ID'].astype(str).map(pay_rates).fillna(15.0)

        # Calculate daily pay
        df['Daily Pay'] = (df['Daily Hours'] * df['Hourly Rate']).round(2)

        # Calculate weekly totals per employee
        weekly_totals = df.groupby('Person ID').agg(
            Total_Hours=('Daily Hours', 'sum'),
            Weekly_Total=('Daily Pay', 'sum'),
            First_Name=('First Name', 'first'),
            Last_Name=('Last Name', 'first'),
            Rate=('Hourly Rate', 'first')
        ).reset_index()

        # Apply rounding
        weekly_totals['Total_Hours'] = weekly_totals['Total_Hours'].round(2)
        weekly_totals['Weekly_Total'] = weekly_totals['Weekly_Total'].round(2)
        weekly_totals['Rounded_Weekly'] = weekly_totals['Weekly_Total'].round(0).astype(int)

        # Add header
        ws['A1'] = "Payroll Report"
        ws['A1'].font = Font(bold=True, size=14)

        # Add processor information
        ws['A2'] = f"Processed by: {creator}"
        ws['A2'].font = Font(size=10, italic=True)

        # Add creator to hidden cell for reporting
        ws['AA1'] = creator

        # Add column headers in row 2
        headers = ["Person ID", "Employee Name", "Total Hours", "Total Pay", "Rounded Pay"]
        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=2, column=col)
            cell.value = header
            cell.font = Font(bold=True)
            cell.fill = PatternFill(start_color="DDDDDD", fill_type="solid")

        # Add data rows - using iterrows instead of itertuples
        for i, (_, row) in enumerate(weekly_totals.iterrows(), 3):
            ws.cell(row=i, column=1).value = row['Person ID']
            ws.cell(row=i, column=2).value = f"{row['First_Name']} {row['Last_Name']}"
            ws.cell(row=i, column=3).value = round(row['Total_Hours'], 2)
            ws.cell(row=i, column=4).value = round(row['Weekly_Total'], 2)
            ws.cell(row=i, column=5).value = row['Rounded_Weekly']
    else:
        # Generic format - create a standard report

        # Add header
        ws['A1'] = "Payroll Report"
        ws['A1'].font = Font(bold=True, size=14)

        # Add column headers in row 2
        headers = ["ID", "Name", "Total Hours", "Pay Rate", "Total Pay"]
        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=2, column=col)
            cell.value = header
            cell.font = Font(bold=True)
            cell.fill = PatternFill(start_color="DDDDDD", fill_type="solid")

        # For demo data, just put it in the report
        row_num = 3
        for i, row in df.iterrows():
            if 'ID' in df.columns and 'Name' in df.columns and 'Hours' in df.columns and 'Rate' in df.columns:
                # Use actual column data if available
                ws.cell(row=row_num, column=1).value = row['ID']
                ws.cell(row=row_num, column=2).value = row['Name']
                ws.cell(row=row_num, column=3).value = row['Hours']
                ws.cell(row=row_num, column=4).value = row['Rate']
                ws.cell(row=row_num, column=5).value = round(row['Hours'] * row['Rate'], 2)
            else:
                # Otherwise use row number as a placeholder
                ws.cell(row=row_num, column=1).value = i + 1
                ws.cell(row=row_num, column=2).value = f"Row {i + 1}"
                for col_idx, col_name in enumerate(df.columns, 3):
                    if col_idx <= 5:  # Only show up to 3 columns of data
                        ws.cell(row=row_num, column=col_idx).value = row[col_name]
            row_num += 1

    # Format cells
    for row in range(3, ws.max_row + 1):
        ws.cell(row=row, column=4).number_format = '"$"#,##0.00'
        ws.cell(row=row, column=5).number_format = '"$"#,##0'

    # Set column widths
    column_widths = {'A': 15, 'B': 25, 'C': 15, 'D': 15, 'E': 15}
    for col, width in column_widths.items():
        ws.column_dimensions[col].width = width

    # Save the workbook
    report_path = os.path.join(REPORT_FOLDER, filename)
    wb.save(report_path)
    return report_path

def create_payslips(df, filename, creator=None):
    """Create individual payslips in Excel format"""
    wb = Workbook()
    ws = wb.active
    ws.title = "Employee Payslips"

    # Get the creator (username) - use parameter or default to Unknown
    if not creator:
        creator = "Unknown"

    # Disable grid lines through sheet properties to prevent Numbers from showing them
    ws.sheet_properties.showGridLines = False

    # Get week range for header
    try:
        start_date = pd.to_datetime(df['Date']).min().strftime('%Y-%m-%d')
        end_date = pd.to_datetime(df['Date']).max().strftime('%Y-%m-%d')
        date_range = f"{start_date} to {end_date}"
    except:
        date_range = "Current Period"

    # Add header
    ws['A1'] = f"Employee Payslips - {date_range}"
    ws['A1'].font = Font(bold=True, size=14)
    ws.merge_cells('A1:E1')
    ws['A1'].alignment = Alignment(horizontal='center')

    # Add processor information
    ws['A2'] = f"Processed by: {creator}"
    ws['A2'].font = Font(size=10, italic=True)
    ws.merge_cells('A2:E2')

    # Store creator in hidden cell for reporting
    ws['AA1'] = creator

    # Load pay rates
    pay_rates = load_pay_rates()

    # Process data
    df['Daily Hours'] = df.apply(compute_daily_hours, axis=1)
    df['Hourly Rate'] = df['Person ID'].astype(str).map(pay_rates).fillna(15.0)
    df['Daily Pay'] = (df['Daily Hours'] * df['Hourly Rate']).round(2)

    # Calculate totals per employee
    totals = df.groupby('Person ID').agg(
        Hours=('Daily Hours', 'sum'),
        Pay=('Daily Pay', 'sum'),
        First=('First Name', 'first'),
        Last=('Last Name', 'first'),
        Rate=('Hourly Rate', 'first')
    ).reset_index()

    # Add payslips for each employee
    row = 3
    for _, emp in totals.iterrows():
        # Employee header
        ws[f'A{row}'] = f"Employee: {emp['First']} {emp['Last']}"
        ws[f'A{row}'].font = Font(bold=True)
        ws.merge_cells(f'A{row}:E{row}')
        row += 1

        # Employee details
        ws[f'A{row}'] = "ID:"
        ws[f'B{row}'] = emp['Person ID']
        ws[f'C{row}'] = "Rate:"
        ws[f'D{row}'] = f"${emp['Rate']:.2f}/hour"
        row += 1

        # Add table headers
        headers = ["Date", "Clock In", "Clock Out", "Hours", "Pay"]
        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=row, column=col)
            cell.value = header
            cell.font = Font(bold=True)
            cell.fill = PatternFill(start_color="EEEEEE", fill_type="solid")
        row += 1

        # Add daily entries
        emp_df = df[df['Person ID'] == emp['Person ID']].sort_values('Date')
        for _, day in emp_df.iterrows():
            date_str = pd.to_datetime(day['Date']).strftime('%m/%d/%Y')
            ws.cell(row=row, column=1).value = date_str
            ws.cell(row=row, column=2).value = day['Clock In']
            ws.cell(row=row, column=3).value = day['Clock Out']
            ws.cell(row=row, column=4).value = day['Daily Hours']
            ws.cell(row=row, column=5).value = day['Daily Pay']
            row += 1

        # Add totals
        ws.cell(row=row, column=3).value = "Total:"
        ws.cell(row=row, column=3).font = Font(bold=True)
        ws.cell(row=row, column=4).value = emp['Hours']
        ws.cell(row=row, column=4).font = Font(bold=True)
        ws.cell(row=row, column=5).value = emp['Pay']
        ws.cell(row=row, column=5).font = Font(bold=True)
        row += 1

        # Add rounded total
        ws.cell(row=row, column=3).value = "Rounded Pay:"
        ws.cell(row=row, column=3).font = Font(bold=True)
        ws.cell(row=row, column=5).value = round(emp['Pay'])
        ws.cell(row=row, column=5).font = Font(bold=True)
        row += 2

        # Add signature line
        ws.cell(row=row, column=1).value = "Signature: _________________________"
        ws.merge_cells(f'A{row}:E{row}')
        ws.cell(row=row, column=1).alignment = Alignment(horizontal='right')
        row += 3  # Space between employees

    # Format monetary values
    for r in range(1, ws.max_row + 1):
        cell = ws.cell(row=r, column=5)
        if isinstance(cell.value, (int, float)):
            cell.number_format = '"$"#,##0.00'

    # Set column widths
    column_widths = {'A': 15, 'B': 15, 'C': 15, 'D': 15, 'E': 15}
    for col, width in column_widths.items():
        ws.column_dimensions[col].width = width

    # Save the workbook
    report_path = os.path.join(REPORT_FOLDER, filename)
    wb.save(report_path)
    return report_path

def create_combined_report(df, filename):
    """Create a combined report with summary and payslips with signatures"""
    wb = Workbook()

    # Create summary sheet
    ws_summary = wb.active
    ws_summary.title = "Payroll Summary"

    # Get week range for header
    try:
        start_date = pd.to_datetime(df['Date']).min().strftime('%Y-%m-%d')
        end_date = pd.to_datetime(df['Date']).max().strftime('%Y-%m-%d')
        date_range = f"{start_date} to {end_date}"
    except:
        date_range = "Current Period"

    # Add header
    ws_summary['A1'] = f"Payroll Summary - {date_range}"
    ws_summary['A1'].font = Font(bold=True, size=14)
    ws_summary.merge_cells('A1:E1')
    ws_summary['A1'].alignment = Alignment(horizontal='center')

    # Load pay rates
    pay_rates = load_pay_rates()

    # Process data
    df['Daily Hours'] = df['Total Work Time(h)'].apply(parse_work_hours)
    df['Hourly Rate'] = df['Person ID'].astype(str).map(pay_rates).fillna(15.0)
    df['Daily Pay'] = (df['Daily Hours'] * df['Hourly Rate']).round(2)

    # Calculate weekly totals per employee
    weekly_totals = df.groupby('Person ID').agg(
        Total_Hours=('Daily Hours', 'sum'),
        Weekly_Total=('Daily Pay', 'sum'),
        First_Name=('First Name', 'first'),
        Last_Name=('Last Name', 'first'),
        Rate=('Hourly Rate', 'first')
    ).reset_index()

    # Apply rounding
    weekly_totals['Total_Hours'] = weekly_totals['Total_Hours'].round(2)
    weekly_totals['Weekly_Total'] = weekly_totals['Weekly_Total'].round(2)
    weekly_totals['Rounded_Weekly'] = weekly_totals['Weekly_Total'].round(0).astype(int)

    # Calculate grand totals
    grand_total_hours = weekly_totals['Total_Hours'].sum().round(2)
    grand_total_pay = weekly_totals['Weekly_Total'].sum().round(2)
    grand_total_rounded = weekly_totals['Rounded_Weekly'].sum()

    # Add column headers in row 3
    headers = ["Person ID", "Employee Name", "Total Hours", "Total Pay", "Rounded Pay"]
    for col, header in enumerate(headers, 1):
        cell = ws_summary.cell(row=3, column=col)
        cell.value = header
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="DDDDDD", fill_type="solid")

    # Add summary data rows
    for i, (_, row) in enumerate(weekly_totals.iterrows(), 4):
        ws_summary.cell(row=i, column=1).value = row['Person ID']
        ws_summary.cell(row=i, column=2).value = f"{row['First_Name']} {row['Last_Name']}"
        ws_summary.cell(row=i, column=3).value = round(row['Total_Hours'], 2)
        ws_summary.cell(row=i, column=4).value = round(row['Weekly_Total'], 2)
        ws_summary.cell(row=i, column=5).value = row['Rounded_Weekly']

    # Add grand total row after employee rows
    grand_total_row = ws_summary.max_row + 1
    ws_summary.cell(row=grand_total_row, column=1).value = ""
    ws_summary.cell(row=grand_total_row, column=2).value = "GRAND TOTAL"
    ws_summary.cell(row=grand_total_row, column=2).font = Font(bold=True)
    ws_summary.cell(row=grand_total_row, column=3).value = grand_total_hours
    ws_summary.cell(row=grand_total_row, column=3).font = Font(bold=True)
    ws_summary.cell(row=grand_total_row, column=4).value = grand_total_pay
    ws_summary.cell(row=grand_total_row, column=4).font = Font(bold=True)
    ws_summary.cell(row=grand_total_row, column=5).value = grand_total_rounded
    ws_summary.cell(row=grand_total_row, column=5).font = Font(bold=True)
    ws_summary.cell(row=grand_total_row, column=3).number_format = '#,##0.00'
    ws_summary.cell(row=grand_total_row, column=4).number_format = '"$"#,##0.00'
    ws_summary.cell(row=grand_total_row, column=5).number_format = '"$"#,##0'

    # Add a header for detailed section
    current_row = grand_total_row + 2
    ws_summary.cell(row=current_row, column=1).value = "Detailed Breakdown by Employee"
    ws_summary.cell(row=current_row, column=1).font = Font(bold=True, size=12)
    ws_summary.merge_cells(f'A{current_row}:E{current_row}')
    current_row += 2

    # Define border styles - only outer borders
    outer_border = Border(
        left=Side(style='thin', color='000000'),
        right=Side(style='thin', color='000000'),
        top=Side(style='thin', color='000000'),
        bottom=Side(style='thin', color='000000')
    )

    # For header cells only - bottom border
    header_border = Border(
        bottom=Side(style='thin', color='000000')
    )

    # For total rows only - top border
    total_border = Border(
        top=Side(style='thin', color='000000')
    )

    # Add detailed timesheet data for each employee
    for _, emp_data in weekly_totals.iterrows():
        emp_id = emp_data['Person ID']
        emp_name = f"{emp_data['First_Name']} {emp_data['Last_Name']}"

        # Employee header
        ws_summary.cell(row=current_row, column=1).value = f"Employee: {emp_name} (ID: {emp_id})"
        ws_summary.cell(row=current_row, column=1).font = Font(bold=True)
        ws_summary.merge_cells(f'A{current_row}:E{current_row}')
        ws_summary.cell(row=current_row, column=1).fill = PatternFill(start_color="E6E6E6", fill_type="solid")
        current_row += 1

        # Hourly rate
        ws_summary.cell(row=current_row, column=1).value = f"Hourly Rate: ${emp_data['Rate']:.2f}"
        ws_summary.merge_cells(f'A{current_row}:B{current_row}')
        current_row += 1

        # Mark the start of the employee section for border
        emp_section_start = current_row

        # Add table headers for daily entries
        detailed_headers = ["Date", "Clock In", "Clock Out", "Hours", "Pay"]
        for col, header in enumerate(detailed_headers, 1):
            cell = ws_summary.cell(row=current_row, column=col)
            cell.value = header
            cell.font = Font(bold=True)
            cell.fill = PatternFill(start_color="F2F2F2", fill_type="solid")
            cell.border = header_border  # Only bottom border for headers
        current_row += 1

        # Add daily entries
        emp_df = df[df['Person ID'] == emp_id].sort_values('Date')
        for _, day in emp_df.iterrows():
            date_str = pd.to_datetime(day['Date']).strftime('%m/%d/%Y')
            ws_summary.cell(row=current_row, column=1).value = date_str
            ws_summary.cell(row=current_row, column=2).value = day['Clock In']
            ws_summary.cell(row=current_row, column=3).value = day['Clock Out']
            ws_summary.cell(row=current_row, column=4).value = day['Daily Hours']
            ws_summary.cell(row=current_row, column=5).value = day['Daily Pay']
            current_row += 1

        # Mark totals row start
        totals_row_start = current_row

        # Add totals with top border
        ws_summary.cell(row=current_row, column=3).value = "Total:"
        ws_summary.cell(row=current_row, column=3).font = Font(bold=True)
        ws_summary.cell(row=current_row, column=3).border = total_border
        ws_summary.cell(row=current_row, column=4).value = emp_data['Total_Hours']
        ws_summary.cell(row=current_row, column=4).font = Font(bold=True)
        ws_summary.cell(row=current_row, column=4).border = total_border
        ws_summary.cell(row=current_row, column=5).value = emp_data['Weekly_Total']
        ws_summary.cell(row=current_row, column=5).font = Font(bold=True)
        ws_summary.cell(row=current_row, column=5).border = total_border
        current_row += 1

        # Add rounded total
        ws_summary.cell(row=current_row, column=3).value = "Rounded Pay:"
        ws_summary.cell(row=current_row, column=3).font = Font(bold=True)
        ws_summary.cell(row=current_row, column=5).value = emp_data['Rounded_Weekly']
        ws_summary.cell(row=current_row, column=5).font = Font(bold=True)
        current_row += 1

        # Add outer borders to the entire employee section
        for row in range(emp_section_start, current_row):
            # Left border for first column
            ws_summary.cell(row=row, column=1).border = Border(
                left=Side(style='thin', color='000000')
            )
            # Right border for last column
            ws_summary.cell(row=row, column=5).border = Border(
                right=Side(style='thin', color='000000')
            )

        # Add top and bottom borders
        for col in range(1, 6):
            # Top border for first row
            border = ws_summary.cell(row=emp_section_start, column=col).border
            ws_summary.cell(row=emp_section_start, column=col).border = Border(
                left=border.left,
                right=border.right,
                top=Side(style='thin', color='000000'),
                bottom=border.bottom
            )

            # Bottom border for last row
            border = ws_summary.cell(row=current_row-1, column=col).border
            ws_summary.cell(row=current_row-1, column=col).border = Border(
                left=border.left,
                right=border.right,
                top=border.top,
                bottom=Side(style='thin', color='000000')
            )

        # Add signature line
        current_row += 2  # Add space before signature
        ws_summary.cell(row=current_row, column=1).value = "Signature: _________________________"
        ws_summary.merge_cells(f'A{current_row}:C{current_row}')
        ws_summary.cell(row=current_row, column=4).value = "Date: _____________"
        ws_summary.merge_cells(f'D{current_row}:E{current_row}')
        current_row += 2  # Add space between employees

    # Format monetary values in summary section
    for r in range(3, grand_total_row + 1):
        # Format pay columns
        ws_summary.cell(row=r, column=4).number_format = '"$"#,##0.00'
        ws_summary.cell(row=r, column=5).number_format = '"$"#,##0'

        # Format hours column
        if r > 3:  # Skip header row
            ws_summary.cell(row=r, column=3).number_format = '#,##0.00'

    # Add outer borders to the summary table
    for r in range(3, grand_total_row + 1):
        for c in range(1, 6):
            # Determine which borders to show
            left = Side(style='thin') if c == 1 else None
            right = Side(style='thin') if c == 5 else None
            top = Side(style='thin') if r == 3 else None
            bottom = Side(style='thin') if r == grand_total_row else None

            # Add any required borders
            if left or right or top or bottom:
                ws_summary.cell(row=r, column=c).border = Border(
                    left=left,
                    right=right,
                    top=top,
                    bottom=bottom
                )

    # Add horizontal borders for header row and grand total row
    for c in range(1, 6):
        # Border between header and data
        border = ws_summary.cell(row=3, column=c).border
        ws_summary.cell(row=3, column=c).border = Border(
            left=border.left,
            right=border.right,
            top=border.top,
            bottom=Side(style='thin', color='000000')
        )

        # Border above grand total
        border = ws_summary.cell(row=grand_total_row, column=c).border
        ws_summary.cell(row=grand_total_row, column=c).border = Border(
            left=border.left,
            right=border.right,
            top=Side(style='thin', color='000000'),
            bottom=border.bottom
        )

    # Set column widths
    column_widths = {'A': 15, 'B': 25, 'C': 15, 'D': 15, 'E': 15}
    for col, width in column_widths.items():
        ws_summary.column_dimensions[col].width = width

    # Save the workbook
    report_path = os.path.join(REPORT_FOLDER, filename)
    wb.save(report_path)
    return report_path

def create_consolidated_admin_report(df, filename, creator=None):
    """Create a single-sheet admin report with all employee data"""
    wb = Workbook()
    ws = wb.active
    ws.title = "Payroll Summary"

    # Disable grid lines through sheet properties to prevent Numbers from showing them
    ws.sheet_properties.showGridLines = False

    # Get week range for header
    try:
        start_date = pd.to_datetime(df['Date']).min().strftime('%Y-%m-%d')
        end_date = pd.to_datetime(df['Date']).max().strftime('%Y-%m-%d')
        date_range = f"{start_date} to {end_date}"
    except:
        date_range = "Current Period"

    # Add header
    ws['A1'] = f"Payroll Summary - {date_range}"
    ws['A1'].font = Font(bold=True, size=14)
    ws.merge_cells('A1:Z1')  # Merge across all columns used by the report
    ws['A1'].alignment = Alignment(horizontal='center')

    # Get the creator - use the provided parameter, or fall back to session username
    if not creator and 'username' in session:
        creator = session.get('username')
    elif not creator:
        creator = "Unknown"

    # Add processor information
    ws['A2'] = f"Processed by: {creator}"
    ws['A2'].font = Font(size=10, italic=True)
    ws.merge_cells('A2:Z2')
    ws['A2'].alignment = Alignment(horizontal='center')

    # Store the creator in a hidden cell for extraction later
    # This is the key cell we'll look for when displaying reports
    ws['AA1'] = creator

    # Continue with the existing function
    # Load pay rates
    pay_rates = load_pay_rates()

    # Process data
    df['Daily Hours'] = df.apply(compute_daily_hours, axis=1)
    df['Hourly Rate'] = df['Person ID'].astype(str).map(pay_rates).fillna(15.0)
    df['Daily Pay'] = (df['Daily Hours'] * df['Hourly Rate']).round(2)

    # Calculate weekly totals per employee
    weekly_totals = df.groupby('Person ID').agg(
        Total_Hours=('Daily Hours', 'sum'),
        Weekly_Total=('Daily Pay', 'sum'),
        First_Name=('First Name', 'first'),
        Last_Name=('Last Name', 'first'),
        Rate=('Hourly Rate', 'first')
    ).reset_index()

    # Apply rounding
    weekly_totals['Total_Hours'] = weekly_totals['Total_Hours'].round(2)
    weekly_totals['Weekly_Total'] = weekly_totals['Weekly_Total'].round(2)
    weekly_totals['Rounded_Weekly'] = weekly_totals['Weekly_Total'].round(0).astype(int)

    # Calculate grand totals
    grand_total_hours = weekly_totals['Total_Hours'].sum().round(2)
    grand_total_pay = weekly_totals['Weekly_Total'].sum().round(2)
    grand_total_rounded = weekly_totals['Rounded_Weekly'].sum()

    # Define minimal borders
    header_border = Border(bottom=Side(style='thin', color='000000'))
    top_border = Border(top=Side(style='hair', color='D3D3D3'))

    # Center the summary in the middle of the page
    summary_col_start = 8  # Center it better by moving to column H

    # Add column headers in row 3
    headers = ["Person ID", "Employee Name", "Total Hours", "Total Pay", "Rounded Pay"]
    for col, header in enumerate(headers):
        cell = ws.cell(row=3, column=summary_col_start + col)
        cell.value = header
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="DDDDDD", fill_type="solid")
        cell.border = header_border  # Only bottom border
        cell.alignment = Alignment(horizontal='center')

    # Add summary data rows
    for i, (_, row) in enumerate(weekly_totals.iterrows(), 4):
        ws.cell(row=i, column=summary_col_start).value = row['Person ID']
        ws.cell(row=i, column=summary_col_start+1).value = f"{row['First_Name']} {row['Last_Name']}"
        ws.cell(row=i, column=summary_col_start+2).value = round(row['Total_Hours'], 2)
        ws.cell(row=i, column=summary_col_start+3).value = round(row['Weekly_Total'], 2)
        ws.cell(row=i, column=summary_col_start+4).value = row['Rounded_Weekly']

    # Add grand total row after employee rows with a light top border
    grand_total_row = ws.max_row + 1
    for col in range(summary_col_start, summary_col_start+5):
        ws.cell(row=grand_total_row, column=col).border = top_border

    ws.cell(row=grand_total_row, column=summary_col_start).value = ""
    ws.cell(row=grand_total_row, column=summary_col_start+1).value = "GRAND TOTAL"
    ws.cell(row=grand_total_row, column=summary_col_start+1).font = Font(bold=True)
    ws.cell(row=grand_total_row, column=summary_col_start+2).value = grand_total_hours
    ws.cell(row=grand_total_row, column=summary_col_start+2).font = Font(bold=True)
    ws.cell(row=grand_total_row, column=summary_col_start+3).value = grand_total_pay
    ws.cell(row=grand_total_row, column=summary_col_start+3).font = Font(bold=True)
    ws.cell(row=grand_total_row, column=summary_col_start+4).value = grand_total_rounded
    ws.cell(row=grand_total_row, column=summary_col_start+4).font = Font(bold=True)

    # Add a header for detailed section with less spacing
    current_row = grand_total_row + 2
    ws.cell(row=current_row, column=1).value = "Detailed Breakdown by Employee"
    ws.cell(row=current_row, column=1).font = Font(bold=True, size=12)
    ws.merge_cells(f'A{current_row}:Z{current_row}')
    ws.cell(row=current_row, column=1).alignment = Alignment(horizontal='center')
    current_row += 1

    # Define the three columns for employee data
    col1_start = 1
    col2_start = 8
    col3_start = 15
    col_width = 6

    # Process employees in batches of 3 across the page
    for batch_idx in range(0, len(weekly_totals), 3):
        # Get up to 3 employees for this row
        batch = weekly_totals.iloc[batch_idx:min(batch_idx+3, len(weekly_totals))]

        # Start a new row for this batch
        row_start = current_row
        max_rows_in_batch = 0

        # Process each employee (up to 3) in this batch
        for i, (_, emp_data) in enumerate(batch.iterrows()):
            # Set column start based on position (left, middle, right)
            if i == 0:
                col_start = col1_start
            elif i == 1:
                col_start = col2_start
            else:
                col_start = col3_start

            emp_id = emp_data['Person ID']
            emp_name = f"{emp_data['First_Name']} {emp_data['Last_Name']}"
            rate = emp_data['Rate']

            # Current row for this employee section
            emp_row = row_start

            # Employee header with shaded background
            ws.cell(row=emp_row, column=col_start).value = emp_name
            ws.cell(row=emp_row, column=col_start).font = Font(bold=True)
            ws.merge_cells(f'{get_column_letter(col_start)}{emp_row}:{get_column_letter(col_start+col_width-1)}{emp_row}')
            ws.cell(row=emp_row, column=col_start).fill = PatternFill(start_color="E6E6E6", fill_type="solid")
            emp_row += 1

            # ID and rate info
            ws.cell(row=emp_row, column=col_start).value = f"ID: {emp_id} | Rate: ${rate:.2f}"
            ws.merge_cells(f'{get_column_letter(col_start)}{emp_row}:{get_column_letter(col_start+col_width-1)}{emp_row}')
            emp_row += 1

            # Add table headers
            headers = ["Date", "In", "Out", "Hours", "Pay"]
            for j, header in enumerate(headers):
                if j < col_width:  # Stay within allocated width
                    cell = ws.cell(row=emp_row, column=col_start + j)
                    cell.value = header
                    cell.font = Font(bold=True)
                    cell.border = header_border
            emp_row += 1

            # Add daily entries
            emp_df = df[df['Person ID'] == emp_id].sort_values('Date')
            for _, day in emp_df.iterrows():
                date_val = pd.to_datetime(day['Date']).strftime('%m/%d/%Y')
                ws.cell(row=emp_row, column=col_start).value = date_val
                ws.cell(row=emp_row, column=col_start+1).value = day['Clock In']
                ws.cell(row=emp_row, column=col_start+2).value = day['Clock Out']
                ws.cell(row=emp_row, column=col_start+3).value = day['Daily Hours']
                ws.cell(row=emp_row, column=col_start+4).value = day['Daily Pay']
                emp_row += 1

            # Add light top border for totals
            for j in range(col_start+3, col_start+6):
                if j < col_start+col_width:
                    ws.cell(row=emp_row, column=j).border = top_border

            # Add total hours and pay
            ws.cell(row=emp_row, column=col_start).value = "Total:"
            ws.cell(row=emp_row, column=col_start).font = Font(bold=True)
            ws.cell(row=emp_row, column=col_start+3).value = emp_data['Total_Hours']
            ws.cell(row=emp_row, column=col_start+3).font = Font(bold=True)
            ws.cell(row=emp_row, column=col_start+4).value = emp_data['Weekly_Total']
            ws.cell(row=emp_row, column=col_start+4).font = Font(bold=True)
            emp_row += 1

            # Add rounded pay
            ws.cell(row=emp_row, column=col_start).value = "Rounded Pay:"
            ws.cell(row=emp_row, column=col_start).font = Font(bold=True)
            ws.cell(row=emp_row, column=col_start+4).value = emp_data['Rounded_Weekly']
            ws.cell(row=emp_row, column=col_start+4).font = Font(bold=True)
            emp_row += 1

            # Add signature line
            ws.cell(row=emp_row, column=col_start).value = "Signature: _______________"
            ws.merge_cells(f'{get_column_letter(col_start)}{emp_row}:{get_column_letter(col_start+3)}{emp_row}')
            emp_row += 1

            # Add date line
            ws.cell(row=emp_row, column=col_start).value = "Date: _________"
            ws.merge_cells(f'{get_column_letter(col_start)}{emp_row}:{get_column_letter(col_start+3)}{emp_row}')
            emp_row += 1

            # Format monetary values
            for r in range(row_start, emp_row):
                cell = ws.cell(row=r, column=col_start+4)
                if isinstance(cell.value, (int, float)):
                    cell.number_format = '"$"#,##0.00'

            # Track max height
            rows_used = emp_row - row_start
            if rows_used > max_rows_in_batch:
                max_rows_in_batch = rows_used

        # Move to the next row after this batch, add some spacing
        current_row = row_start + max_rows_in_batch + 1

    # Format monetary values in the summary section
    for r in range(4, grand_total_row + 1):
        # Format pay columns
        ws.cell(row=r, column=summary_col_start+3).number_format = '"$"#,##0.00'
        ws.cell(row=r, column=summary_col_start+4).number_format = '"$"#,##0'
        # Format hours column
        ws.cell(row=r, column=summary_col_start+2).number_format = '#,##0.00'

    # Format grand total row
    ws.cell(row=grand_total_row, column=summary_col_start+2).number_format = '#,##0.00'
    ws.cell(row=grand_total_row, column=summary_col_start+3).number_format = '"$"#,##0.00'
    ws.cell(row=grand_total_row, column=summary_col_start+4).number_format = '"$"#,##0'

    # Set optimized column widths
    ws.column_dimensions['A'].width = 10  # First column

    # Adjust width of each section (3 sections across the page)
    for i in range(col1_start, col1_start+col_width):
        ws.column_dimensions[get_column_letter(i)].width = 10
    for i in range(col2_start, col2_start+col_width):
        ws.column_dimensions[get_column_letter(i)].width = 10
    for i in range(col3_start, col3_start+col_width):
        ws.column_dimensions[get_column_letter(i)].width = 10

    # Adjust specific columns in each section
    for col_set in [col1_start, col2_start, col3_start]:
        ws.column_dimensions[get_column_letter(col_set)].width = 10      # Date
        ws.column_dimensions[get_column_letter(col_set+1)].width = 8     # In
        ws.column_dimensions[get_column_letter(col_set+2)].width = 8     # Out
        ws.column_dimensions[get_column_letter(col_set+3)].width = 6     # Hours
        ws.column_dimensions[get_column_letter(col_set+4)].width = 9     # Pay

    # Add space between columns for visual separation
    ws.column_dimensions[get_column_letter(col1_start+col_width)].width = 2
    ws.column_dimensions[get_column_letter(col2_start+col_width)].width = 2

    # Save the workbook
    report_path = os.path.join(REPORT_FOLDER, filename)
    wb.save(report_path)
    return report_path

def create_consolidated_payslips(df, filename, creator=None):
    """Create a single sheet with all employee payslips in a horizontal side-by-side layout"""
    # Import get_column_letter here to ensure it's available
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "Payslips"

    # Get the creator (username) - use parameter or default to Unknown
    if not creator:
        creator = "Unknown"

    # Disable grid lines through sheet properties to prevent Numbers from showing them
    ws.sheet_properties.showGridLines = False

    # Get week range for header
    try:
        start_date = pd.to_datetime(df['Date']).min().strftime('%Y-%m-%d')
        end_date = pd.to_datetime(df['Date']).max().strftime('%Y-%m-%d')
        date_range = f"{start_date} to {end_date}"
    except:
        date_range = "Current Period"

    # Add title
    ws['A1'] = f"Employee Payslips - {date_range}"
    ws['A1'].font = Font(bold=True, size=14)
    ws.merge_cells('A1:Z1')
    ws['A1'].alignment = Alignment(horizontal='center')

    # Add processor information
    ws['A2'] = f"Processed by: {creator}"
    ws['A2'].font = Font(size=10, italic=True)
    ws.merge_cells('A2:Z2')

    # Store creator in hidden cell for reporting
    ws['AA1'] = creator

    # Load pay rates
    pay_rates = load_pay_rates()

    # Process data
    df['Daily Hours'] = df.apply(compute_daily_hours, axis=1)
    df['Hourly Rate'] = df['Person ID'].astype(str).map(pay_rates).fillna(15.0)
    df['Daily Pay'] = (df['Daily Hours'] * df['Hourly Rate']).round(2)

    # Calculate weekly totals per employee
    weekly_totals = df.groupby('Person ID').agg(
        Total_Hours=('Daily Hours', 'sum'),
        Weekly_Total=('Daily Pay', 'sum'),
        First_Name=('First Name', 'first'),
        Last_Name=('Last Name', 'first'),
        Rate=('Hourly Rate', 'first')
    ).reset_index()

    # Apply rounding
    weekly_totals['Total_Hours'] = weekly_totals['Total_Hours'].round(2)
    weekly_totals['Weekly_Total'] = weekly_totals['Weekly_Total'].round(2)
    weekly_totals['Rounded_Weekly'] = weekly_totals['Weekly_Total'].round(0).astype(int)

    # IMPORTANT: Filter out employees with zero hours
    weekly_totals = weekly_totals[weekly_totals['Total_Hours'] > 0]

    # If no employees have hours, return an empty report
    if len(weekly_totals) == 0:
        ws['A3'] = "No employees with hours worked in this period"
        ws['A3'].font = Font(bold=True)
        report_path = os.path.join(REPORT_FOLDER, filename)
        wb.save(report_path)
        return report_path

    # Define a minimal header border - just a bottom line
    header_border = Border(
        bottom=Side(style='thin', color='000000')
    )

    # Each payslip takes 5 columns
    payslip_width = 5

    # Add a spacer column for easier cutting
    spacer_width = 1
    total_width_per_payslip = payslip_width + spacer_width

    # Start at row 3 (after title)
    start_row = 3

    # Calculate how many employees can fit per row
    max_payslips_per_row = 3  # Maximum 3 payslips side by side (18 columns total with spacers)

    # Process employees in batches for each row
    for batch_idx in range(0, len(weekly_totals), max_payslips_per_row):
        current_row = start_row
        batch_employees = weekly_totals.iloc[batch_idx:batch_idx+max_payslips_per_row]

        # Track the maximum height of any payslip in this row
        max_height = 0

        # Process each employee in this batch (for this row)
        for i, (_, emp_data) in enumerate(batch_employees.iterrows()):
            emp_id = emp_data['Person ID']
            emp_name = f"{emp_data['First_Name']} {emp_data['Last_Name']}"

            # Calculate starting column for this payslip
            col_start = 1 + (i * total_width_per_payslip)

            # Add dotted line in spacer column for cutting guide
            if i > 0:
                # Add vertical dotted line in the spacer column
                cut_col = col_start - 1

                # Use a light gray border for the cutting guide instead of values
                side = Side(style='dashDot', color='DDDDDD')
                border = Border(right=side)

                # Apply the border to a range of cells in the spacer column
                for r in range(current_row, current_row + 30):  # Reasonable height estimate
                    # Only set the border, not the value
                    cell = ws.cell(row=r, column=cut_col)
                    cell.border = border

            # Reset row counter for this employee
            emp_row = current_row

            # Employee header
            ws.cell(row=emp_row, column=col_start).value = f"Employee: {emp_name}"
            ws.cell(row=emp_row, column=col_start).font = Font(bold=True)
            ws.merge_cells(f'{get_column_letter(col_start)}{emp_row}:{get_column_letter(col_start+payslip_width-1)}{emp_row}')
            emp_row += 1

            # Pay period and employee ID in one row
            ws.cell(row=emp_row, column=col_start).value = f"Pay Period: {date_range}"
            ws.merge_cells(f'{get_column_letter(col_start)}{emp_row}:{get_column_letter(col_start+2)}{emp_row}')
            ws.cell(row=emp_row, column=col_start+3).value = f"ID: {emp_id}"
            ws.merge_cells(f'{get_column_letter(col_start+3)}{emp_row}:{get_column_letter(col_start+payslip_width-1)}{emp_row}')
            emp_row += 1

            # Hourly rate
            ws.cell(row=emp_row, column=col_start).value = f"Hourly Rate: ${emp_data['Rate']:.2f}"
            ws.merge_cells(f'{get_column_letter(col_start)}{emp_row}:{get_column_letter(col_start+payslip_width-1)}{emp_row}')
            emp_row += 1

            # Add table headers for daily entries
            detailed_headers = ["Date", "In", "Out", "Hours", "Pay"]
            for col, header in enumerate(detailed_headers, 0):
                cell = ws.cell(row=emp_row, column=col_start + col)
                cell.value = header
                cell.font = Font(bold=True)
                cell.fill = PatternFill(start_color="F2F2F2", fill_type="solid")
                cell.border = header_border  # Only bottom border for headers
            emp_row += 1

            # Add daily entries
            emp_df = df[df['Person ID'] == emp_id].sort_values('Date')
            for _, day in emp_df.iterrows():
                date_str = pd.to_datetime(day['Date']).strftime('%m/%d/%Y')
                ws.cell(row=emp_row, column=col_start).value = date_str
                ws.cell(row=emp_row, column=col_start+1).value = day['Clock In']
                ws.cell(row=emp_row, column=col_start+2).value = day['Clock Out']
                ws.cell(row=emp_row, column=col_start+3).value = day['Daily Hours']
                ws.cell(row=emp_row, column=col_start+4).value = day['Daily Pay']
                emp_row += 1

            # Add space between days and totals
            emp_row += 1

            # Add totals with a light top border
            top_border = Border(top=Side(style='hair', color='D3D3D3'))

            # Total Hours
            ws.cell(row=emp_row, column=col_start+2).value = "Total Hours:"
            ws.cell(row=emp_row, column=col_start+2).font = Font(bold=True)
            ws.cell(row=emp_row, column=col_start+2).border = top_border
            ws.cell(row=emp_row, column=col_start+3).value = emp_data['Total_Hours']
            ws.cell(row=emp_row, column=col_start+3).font = Font(bold=True)
            ws.cell(row=emp_row, column=col_start+3).border = top_border
            emp_row += 1

            # Total Pay
            ws.cell(row=emp_row, column=col_start+2).value = "Total Pay:"
            ws.cell(row=emp_row, column=col_start+2).font = Font(bold=True)
            ws.cell(row=emp_row, column=col_start+4).value = emp_data['Weekly_Total']
            ws.cell(row=emp_row, column=col_start+4).font = Font(bold=True)
            emp_row += 1

            # Rounded Pay
            ws.cell(row=emp_row, column=col_start+2).value = "Rounded Pay:"
            ws.cell(row=emp_row, column=col_start+2).font = Font(bold=True)
            ws.cell(row=emp_row, column=col_start+4).value = emp_data['Rounded_Weekly']
            ws.cell(row=emp_row, column=col_start+4).font = Font(bold=True)
            emp_row += 1

            # Format monetary values
            for r in range(current_row, emp_row):
                cell = ws.cell(row=r, column=col_start+4)
                if isinstance(cell.value, (int, float)):
                    cell.number_format = '"$"#,##0.00'

            # Track the maximum height used by any payslip in this row
            if emp_row > current_row + max_height:
                max_height = emp_row - current_row

        # After processing all employees in this batch (row),
        # add a cut line below this row of payslips
        cut_line_row = current_row + max_height + 1

        # Prepare a cut line with scissors symbols at appropriate positions
        cut_line = ""
        for i in range(80):  # Sufficient length
            # Add scissors at approximate positions where cutting should occur
            if i > 0 and i % 25 == 0:
                cut_line += "✂️"
            else:
                cut_line += "-"

        # Add the horizontal cut line (BEFORE merging cells)
        ws.cell(row=cut_line_row, column=1).value = cut_line
        ws.cell(row=cut_line_row, column=1).font = Font(color="999999")
        ws.cell(row=cut_line_row, column=1).alignment = Alignment(horizontal='center')

        # Now merge the cells for the cut line
        ws.merge_cells(f'A{cut_line_row}:Z{cut_line_row}')

        # Set the starting row for the next batch (row) of employees
        start_row = cut_line_row + 2

    # Set column widths
    for col in range(1, 21):
        # Determine if this is a spacer column
        if (col - 1) % total_width_per_payslip == payslip_width:
            # This is a spacer column - make it narrow
            ws.column_dimensions[get_column_letter(col)].width = 2
        else:
            # Determine position within a payslip
            position = ((col - 1) % total_width_per_payslip)
            if position == 0:  # Date column
                width = 12
            elif position in [1, 2]:  # In/Out columns
                width = 8
            elif position == 3:  # Hours column
                width = 7
            else:  # Pay column
                width = 10
            ws.column_dimensions[get_column_letter(col)].width = width

    # Save the workbook
    report_path = os.path.join(REPORT_FOLDER, filename)
    wb.save(report_path)
    return report_path

def validate_timesheet(df):
    """Validate timesheet data and identify records with missing clock in/out times"""
    # Create validation columns - True means there's an issue
    df['Missing_Clock_In'] = df['Clock In'].isna() | (df['Clock In'] == '')
    df['Missing_Clock_Out'] = df['Clock Out'].isna() | (df['Clock Out'] == '')
    df['Has_Issue'] = df['Missing_Clock_In'] | df['Missing_Clock_Out']

    # Return only records with issues
    return df[df['Has_Issue']].copy()

@app.route('/validate', methods=['POST'])
def validate():
    """Validate uploaded CSV and show issues if any"""
    try:
        if 'file' not in request.files:
            return "No file part", 400

        file = request.files['file']
        if file.filename == '':
            return "No selected file", 400

        # Save uploaded file
        file_path = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(file_path)

        # Store file path in session for later processing
        session['uploaded_file'] = file_path

        # For non-CSV files, redirect to regular processing
        if not file.filename.endswith('.csv'):
            return redirect(url_for('process'))

        # Read CSV
        df = pd.read_csv(file_path)

        # Check if this looks like a timesheet
        is_timesheet = all(col in df.columns for col in
                          ['Person ID', 'First Name', 'Last Name', 'Date', 'Clock In', 'Clock Out'])

        if not is_timesheet:
            # Not a timesheet, proceed with normal processing
            return redirect(url_for('process'))

        # Validate the timesheet
        issues = validate_timesheet(df)

        # If no issues, proceed with normal processing
        if len(issues) == 0:
            return redirect(url_for('process'))

        # There are issues, show them to the user for fixing

        # Calculate suggested times based on other employees
        def get_suggested_time(target_date, time_type, current_df):
            """Get suggested time based on other employees' times for the same date"""
            same_date_entries = current_df[current_df['Date'] == target_date]

            if time_type == 'Clock In':
                valid_times = same_date_entries[same_date_entries['Clock In'].notna()]['Clock In']
            else:
                valid_times = same_date_entries[same_date_entries['Clock Out'].notna()]['Clock Out']

            if len(valid_times) > 0:
                # Convert times to datetime objects for averaging
                times_list = []
                for time_str in valid_times:
                    if time_str and str(time_str).strip():
                        try:
                            time_obj = datetime.strptime(str(time_str).strip(), '%H:%M:%S')
                            times_list.append(time_obj)
                        except:
                            pass

                if times_list:
                    # Find the most common time range (within 30 minutes)
                    from collections import Counter
                    rounded_times = []
                    for t in times_list:
                        # Round to nearest 15 minutes
                        minutes = t.minute
                        rounded_min = round(minutes / 15) * 15
                        if rounded_min == 60:
                            rounded_time = t.replace(hour=(t.hour + 1) % 24, minute=0, second=0)
                        else:
                            rounded_time = t.replace(minute=rounded_min, second=0)
                        rounded_times.append(rounded_time.strftime('%H:%M:%S'))

                    # Get most common time
                    most_common = Counter(rounded_times).most_common(1)
                    if most_common:
                        return most_common[0][0]

            # Default suggestions if no data
            return '09:00:00' if time_type == 'Clock In' else '17:00:00'

        # Generate HTML table with issues
        issue_rows = ""
        for _, row in issues.iterrows():
            person_id = row['Person ID']
            name = f"{row['First Name']} {row['Last Name']}"
            date = row['Date']
            clock_in = row['Clock In'] if not row['Missing_Clock_In'] else ''
            clock_out = row['Clock Out'] if not row['Missing_Clock_Out'] else ''

            # Determine row class based on missing data
            row_class = ""
            if row['Missing_Clock_In'] and row['Missing_Clock_Out']:
                row_class = "both-missing"
            elif row['Missing_Clock_In'] or row['Missing_Clock_Out']:
                row_class = "one-missing"

            # Get suggestions for missing times
            clock_in_suggestion = ""
            clock_out_suggestion = ""
            if row['Missing_Clock_In']:
                suggested_in = get_suggested_time(date, 'Clock In', df)
                clock_in_suggestion = f'<br><span class="suggested">Suggested: {suggested_in}</span>'
            if row['Missing_Clock_Out']:
                suggested_out = get_suggested_time(date, 'Clock Out', df)
                clock_out_suggestion = f'<br><span class="suggested">Suggested: {suggested_out}</span>'

            issue_rows += f"""
            <tr class="{row_class}">
                <td>{person_id}</td>
                <td>{name}</td>
                <td>{date}</td>
                <td><input type="text" name="clock_in_{person_id}_{date}" value="{clock_in}"
                    placeholder="HH:MM:SS">{clock_in_suggestion}</td>
                <td><input type="text" name="clock_out_{person_id}_{date}" value="{clock_out}"
                    placeholder="HH:MM:SS">{clock_out_suggestion}</td>
            </tr>
            """

        # Generate HTML for validation form
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Fix Missing Clock Times</title>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }}
                h1, h2 {{ color: #333; }}
                table {{ width: 100%; border-collapse: collapse; margin: 20px 0; }}
                th, td {{ padding: 8px; text-align: left; border: 1px solid #ddd; }}
                th {{ background-color: #f2f2f2; }}
                input[type="text"] {{ padding: 5px; width: 100px; }}
                .missing {{ background-color: #ffeeee; }}
                .both-missing {{ background-color: #ffcccc; }} /* Light red for both missing */
                .one-missing {{ background-color: #ffffcc; }} /* Light yellow for one missing */
                .suggested {{ color: #666; font-style: italic; font-size: 0.9em; }}
                .button {{
                    display: inline-block;
                    padding: 10px 15px;
                    background-color: #4CAF50;
                    color: white;
                    border: none;
                    cursor: pointer;
                    margin-right: 20px;
                    margin-bottom: 20px;
                }}
                .options {{
                    margin: 20px 0;
                    padding: 20px;
                    background-color: #f9f9f9;
                    border-radius: 5px;
                }}
                .btn-container {{
                    display: flex;
                    gap: 20px;
                    margin-top: 20px;
                }}
            </style>
        </head>
        <body>
            <h1>Fix Missing Clock Times</h1>

            <div class="options">
                <h2>The following timesheet entries have missing clock in or clock out times:</h2>
                <p>Fill in only the values you want to fix and leave the rest empty, or choose an option below.</p>
                <p><strong>Note:</strong> You can leave fields empty if you don't want to fix them - only fill in the times you need to correct.</p>
                <p><strong>Important:</strong> Both Clock In and Clock Out times are required to calculate hours. Entries with only one time will not appear in the payroll report.</p>
                <p><strong>Days Off:</strong> If an employee had the day off, leave both fields empty. They won't appear in the payroll report and won't be paid for that day.</p>

                <div style="margin: 15px 0; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
                    <strong>Color Legend:</strong>
                    <span style="display: inline-block; width: 20px; height: 15px; background-color: #ffcccc; border: 1px solid #ccc; vertical-align: middle;"></span> Both times missing
                    <span style="margin-left: 20px; display: inline-block; width: 20px; height: 15px; background-color: #ffffcc; border: 1px solid #ccc; vertical-align: middle;"></span> One time missing
                </div>

                <form action="/fix_times" method="post" id="fix-form">
                    <table>
                        <tr>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Date</th>
                            <th>Clock In</th>
                            <th>Clock Out</th>
                        </tr>
                        {issue_rows}
                    </table>

                    <div class="btn-container">
                        <button type="submit" class="button">Process with Fixed Times</button>

                        <a href="/process_ignore" class="button" style="background-color: #f44336; text-decoration: none;">
                            Ignore Issues and Process Anyway
                        </a>
                    </div>
                </form>
            </div>

            <p><a href="/" style="text-decoration:none; color:#0275d8;">← Back to Home</a></p>
        </body>
        </html>
        """

        return render_template_string(html)

    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        return f"Error validating file: {str(e)}<br><pre>{error_details}</pre>", 500

@app.route('/process_ignore')
def process_ignore():
    """Process the original file ignoring any issues"""
    try:
        # Get the file path from session
        file_path = session.get('uploaded_file')
        if not file_path:
            return "No file found in session. Please upload again.", 400

        # Read the CSV file
        df = pd.read_csv(file_path)

        # Get current username for report creation
        username = session.get('username', 'Unknown')

        # Continue with normal processing
        try:
            # Check if this looks like a timesheet
            is_timesheet = all(col in df.columns for col in
                             ['Person ID', 'First Name', 'Last Name', 'Date'])

            if is_timesheet:
                try:
                    df['Date'] = pd.to_datetime(df['Date'])
                    week_str = df['Date'].min().strftime('%Y-%m-%d')
                except:
                    week_str = datetime.now().strftime('%Y-%m-%d')
            else:
                week_str = datetime.now().strftime('%Y-%m-%d')

            # Generate reports
            reports = {}

            # Main payroll report
            summary_filename = f"payroll_summary_{week_str}.xlsx"
            summary_path = create_excel_report(df, summary_filename, username)
            reports['summary'] = summary_filename

            # Individual payslips
            if is_timesheet:
                payslips_filename = f"employee_payslips_{week_str}.xlsx"
                payslips_path = create_payslips(df, payslips_filename, username)
                reports['payslips'] = payslips_filename

                # NEW CONSOLIDATED SINGLE-SHEET REPORTS
                admin_filename = f"admin_report_{week_str}.xlsx"
                admin_path = create_consolidated_admin_report(df, admin_filename, username)
                reports['admin'] = admin_filename

                payslip_filename = f"payslips_for_cutting_{week_str}.xlsx"
                payslip_path = create_consolidated_payslips(df, payslip_filename, username)
                reports['payslips_sheet'] = payslip_filename

            # Store the reports in session
            session['reports'] = reports
            session['week'] = week_str

            return redirect(url_for('success'))

        except Exception as e:
            # If processing fails, create an error report
            import traceback
            txt_filename = "error_report.txt"
            report_path = os.path.join(REPORT_FOLDER, txt_filename)
            with open(report_path, 'w') as f:
                f.write(f"Error processing file: {str(e)}\n")
                f.write(traceback.format_exc())
            session['reports'] = {'error': txt_filename}

            return redirect(url_for('success'))

    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        return f"Error ignoring issues: {str(e)}<br><pre>{error_details}</pre>", 500

@app.route('/fix_times', methods=['POST'])
def fix_times():
    """Process the form with fixed clock times"""
    try:
        # Get file path from session - using uploaded_file instead of original_file
        file_path = session.get('uploaded_file')
        if not file_path:
            return "File not found in session. Please upload again.", 400

        # Extract the filename from the path
        filename = os.path.basename(file_path)

        # Read the CSV
        df = pd.read_csv(file_path)

        # Debug: Print all form data
        print("="*50)
        print("FIX_TIMES ROUTE CALLED")
        print(f"Form data received: {dict(request.form)}")
        print(f"CSV file path: {file_path}")
        print("="*50)


        # Extract clock time fixes from form
        updates_made = []
        for key, value in request.form.items():
            if key.startswith('clock_in_') or key.startswith('clock_out_'):
                parts = key.split('_', 2)  # split into ['clock', 'in/out', 'person_id_date']
                clock_type = parts[0].capitalize() + ' ' + parts[1].capitalize()  # 'Clock In' or 'Clock Out'
                person_id_date = parts[2]  # 'person_id_date'

                # Further split person_id_date
                id_date_parts = person_id_date.split('_', 1)
                person_id = id_date_parts[0]
                date = id_date_parts[1]

                # Only update if value is not empty
                if value and value.strip():
                    # Debug: Check actual date values in the dataframe
                    print(f"Looking for Person ID: {person_id}, Date: {date}")
                    print(f"Sample dates in df: {df['Date'].head(5).tolist()}")

                    # Try to convert date format if needed
                    # The form might send YYYY-MM-DD but CSV might have MM/DD/YYYY or other format
                    matching_rows = []
                    for idx, row in df.iterrows():
                        row_person_id = str(row['Person ID'])
                        row_date = str(row['Date'])

                        # Try to match dates in different formats
                        if row_person_id == str(person_id):
                            # Direct string match
                            if row_date == date:
                                matching_rows.append(idx)
                            else:
                                # Try parsing both dates and comparing
                                try:
                                    # Convert different date formats
                                    # Form sends: 2025-06-12
                                    # CSV has: 06/12/2025 or similar

                                    # Method 1: Try parsing with pandas
                                    row_date_parsed = pd.to_datetime(row_date).date()
                                    form_date_parsed = pd.to_datetime(date).date()

                                    if row_date_parsed == form_date_parsed:
                                        matching_rows.append(idx)
                                        print(f"Date match found: {row_date} == {date}")
                                except Exception as e:
                                    # Method 2: Manual parsing for common formats
                                    try:
                                        # Check if form date is YYYY-MM-DD
                                        if '-' in date and len(date.split('-')[0]) == 4:
                                            year, month, day = date.split('-')
                                            # Check if CSV date is MM/DD/YYYY
                                            if '/' in row_date:
                                                parts = row_date.split('/')
                                                if len(parts) == 3:
                                                    csv_month, csv_day, csv_year = parts
                                                    if (csv_year == year and
                                                        csv_month.zfill(2) == month.zfill(2) and
                                                        csv_day.zfill(2) == day.zfill(2)):
                                                        matching_rows.append(idx)
                                                        print(f"Manual date match: {row_date} == {date}")
                                    except:
                                        pass

                    if matching_rows:
                        for idx in matching_rows:
                            before_val = df.at[idx, clock_type] if pd.notna(df.at[idx, clock_type]) else 'Empty'
                            df.at[idx, clock_type] = value.strip()
                            after_val = df.at[idx, clock_type]
                            updates_made.append(f"{clock_type} for Person ID {person_id} on {date}: {before_val} -> {after_val}")
                            print(f"Updated row {idx}: {clock_type} for Person ID {person_id} on {date} from '{before_val}' to '{value.strip()}'")
                    else:
                        print(f"WARNING: No matching row found for Person ID {person_id} on {date}")

        print(f"Total updates made: {len(updates_made)}")
        for update in updates_made:
            print(f"  - {update}")

        # Save the updated CSV
        fixed_file_path = os.path.join(UPLOAD_FOLDER, f"fixed_{filename}")
        df.to_csv(fixed_file_path, index=False)

        print(f"Saved fixed file to: {fixed_file_path}")
        print(f"First few rows after fix:")
        print(df.head(20))

        # Update the session with the fixed file path
        session['uploaded_file'] = fixed_file_path

        # Redirect to process_ignore to handle the fixed file
        return redirect(url_for('process_ignore'))

    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        return f"Error fixing times: {str(e)}<br><pre>{error_details}</pre>", 500

@app.route('/process', methods=['POST'])
@login_required
def process():
    """Process the uploaded file"""
    try:
        if 'file' not in request.files:
            return "No file part", 400

        file = request.files['file']
        if file.filename == '':
            return "No selected file", 400

        # Save the file
        file_path = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(file_path)

        # Get current username for report creation
        username = session.get('username', 'Unknown')

        # For CSV files, create reports
        if file.filename.endswith('.csv'):
            try:
                # Read the CSV file
                df = pd.read_csv(file_path)

                # Check if this looks like a timesheet (has Person ID, Date, etc.)
                is_timesheet = all(col in df.columns for col in
                                  ['Person ID', 'First Name', 'Last Name', 'Date'])

                if is_timesheet:
                    # Check for missing clock in/out values
                    missing_data = False
                    missing_records = []

                    for idx, row in df.iterrows():
                        # Check for empty/null values in clock in/out
                        if pd.isna(row['Clock In']) or str(row['Clock In']).strip() == '' or \
                           pd.isna(row['Clock Out']) or str(row['Clock Out']).strip() == '':
                            missing_data = True
                            missing_records.append({
                                'index': idx,
                                'person_id': row['Person ID'],
                                'name': f"{row['First Name']} {row['Last Name']}",
                                'date': row['Date'],
                                'clock_in': '' if pd.isna(row['Clock In']) else row['Clock In'],
                                'clock_out': '' if pd.isna(row['Clock Out']) else row['Clock Out']
                            })

                    # If missing data, store in session and redirect to correction page
                    if missing_data:
                        session['file_path'] = file_path
                        session['missing_records'] = missing_records
                        return redirect(url_for('fix_missing_times'))

                    # Try to parse dates
                    try:
                        df['Date'] = pd.to_datetime(df['Date'])
                        week_str = df['Date'].min().strftime('%Y-%m-%d')
                    except:
                        week_str = datetime.now().strftime('%Y-%m-%d')
                else:
                    week_str = datetime.now().strftime('%Y-%m-%d')

                # Generate reports
                reports = {}

                # Get current username for report creation
                username = session.get('username', 'Unknown')

                # Main payroll report
                summary_filename = f"payroll_summary_{week_str}.xlsx"
                summary_path = create_excel_report(df, summary_filename, username)
                reports['summary'] = summary_filename

                # Individual payslips
                if is_timesheet:
                    payslips_filename = f"employee_payslips_{week_str}.xlsx"
                    payslips_path = create_payslips(df, payslips_filename, username)
                    reports['payslips'] = payslips_filename

                    # NEW CONSOLIDATED SINGLE-SHEET REPORTS
                    admin_filename = f"admin_report_{week_str}.xlsx"
                    admin_path = create_consolidated_admin_report(df, admin_filename, username)
                    reports['admin'] = admin_filename

                    payslip_filename = f"payslips_for_cutting_{week_str}.xlsx"
                    payslip_path = create_consolidated_payslips(df, payslip_filename, username)
                    reports['payslips_sheet'] = payslip_filename

                # Store the reports in session
                session['reports'] = reports
                session['week'] = week_str

                return redirect(url_for('success'))

            except Exception as e:
                # If processing fails, create an error report
                import traceback
                txt_filename = "error_report.txt"
                report_path = os.path.join(REPORT_FOLDER, txt_filename)
                with open(report_path, 'w') as f:
                    f.write(f"Error processing {file.filename}: {str(e)}\n")
                    f.write(traceback.format_exc())
                session['reports'] = {'error': txt_filename}

                return redirect(url_for('success'))
        else:
            # For non-CSV files, create a simple text report
            txt_filename = "file_report.txt"
            report_path = os.path.join(REPORT_FOLDER, txt_filename)
            with open(report_path, 'w') as f:
                f.write(f"Report for {file.filename}\n")
                f.write(f"File size: {os.path.getsize(file_path)} bytes\n")
            session['reports'] = {'file': txt_filename}

            return redirect(url_for('success'))

    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        return f"Error: {str(e)}<br><pre>{error_details}</pre>", 500

@app.route('/fix_missing_times', methods=['GET', 'POST'])
@login_required
def fix_missing_times():
    """Page to fix missing clock in/out times"""
    if request.method == 'POST':
        # Get the original file path
        file_path = session.get('file_path')
        if not file_path:
            return "File not found", 404

        # Load the original dataframe
        df = pd.read_csv(file_path)

        # Get all the fixes from the form
        for key, value in request.form.items():
            if key.startswith('fix_'):
                _, action, idx = key.split('_')
                idx = int(idx)

                if action == 'clockin':
                    df.at[idx, 'Clock In'] = value if value.strip() else None
                elif action == 'clockout':
                    df.at[idx, 'Clock Out'] = value if value.strip() else None
            elif key == 'action':
                action_type = value  # 'fix' or 'ignore'

        # Save the updated dataframe
        df.to_csv(file_path, index=False)

        # Get current username
        username = session.get('username', 'Unknown')

        # Process the updated file
        try:
            # Try to parse dates
            try:
                df['Date'] = pd.to_datetime(df['Date'])
                week_str = df['Date'].min().strftime('%Y-%m-%d')
            except:
                week_str = datetime.now().strftime('%Y-%m-%d')

            # Generate reports
            reports = {}

            # Main payroll report
            summary_filename = f"payroll_summary_{week_str}.xlsx"
            summary_path = create_excel_report(df, summary_filename, username)
            reports['summary'] = summary_filename

            # Individual payslips
            payslips_filename = f"employee_payslips_{week_str}.xlsx"
            payslips_path = create_payslips(df, payslips_filename, username)
            reports['payslips'] = payslips_filename

            # NEW CONSOLIDATED SINGLE-SHEET REPORTS
            admin_filename = f"admin_report_{week_str}.xlsx"
            admin_path = create_consolidated_admin_report(df, admin_filename, username)
            reports['admin'] = admin_filename

            payslip_filename = f"payslips_for_cutting_{week_str}.xlsx"
            payslip_path = create_consolidated_payslips(df, payslip_filename, username)
            reports['payslips_sheet'] = payslip_filename

            # Store the reports in session
            session['reports'] = reports
            session['week'] = week_str

            return redirect(url_for('success'))

        except Exception as e:
            # If processing fails, create an error report
            import traceback
            txt_filename = "error_report.txt"
            report_path = os.path.join(REPORT_FOLDER, txt_filename)
            with open(report_path, 'w') as f:
                f.write(f"Error processing after time corrections: {str(e)}\n")
                f.write(traceback.format_exc())
            session['reports'] = {'error': txt_filename}

            return redirect(url_for('success'))

    # GET request - show the form
    missing_records = session.get('missing_records', [])

    # Get the original dataframe to calculate suggestions
    file_path = session.get('file_path')
    df = None
    if file_path and os.path.exists(file_path):
        df = pd.read_csv(file_path)

    # Function to calculate suggested times
    def get_suggested_time(target_date, time_type, current_df):
        """Get suggested time based on other employees' times for the same date"""
        if current_df is None:
            return '09:00:00' if time_type == 'Clock In' else '17:00:00'

        same_date_entries = current_df[current_df['Date'] == target_date]

        if time_type == 'Clock In':
            valid_times = same_date_entries[same_date_entries['Clock In'].notna()]['Clock In']
        else:
            valid_times = same_date_entries[same_date_entries['Clock Out'].notna()]['Clock Out']

        if len(valid_times) > 0:
            # Convert times to datetime objects for averaging
            times_list = []
            for time_str in valid_times:
                if time_str and str(time_str).strip():
                    try:
                        time_obj = datetime.strptime(str(time_str).strip(), '%H:%M:%S')
                        times_list.append(time_obj)
                    except:
                        pass

            if times_list:
                # Find the most common time range (within 30 minutes)
                from collections import Counter
                rounded_times = []
                for t in times_list:
                    # Round to nearest 15 minutes
                    minutes = t.minute
                    rounded_min = round(minutes / 15) * 15
                    if rounded_min == 60:
                        rounded_time = t.replace(hour=(t.hour + 1) % 24, minute=0, second=0)
                    else:
                        rounded_time = t.replace(minute=rounded_min, second=0)
                    rounded_times.append(rounded_time.strftime('%H:%M:%S'))

                # Get most common time
                most_common = Counter(rounded_times).most_common(1)
                if most_common:
                    return most_common[0][0]

        # Default suggestions if no data
        return '09:00:00' if time_type == 'Clock In' else '17:00:00'

    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Fix Missing Time Entries</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
            h1, h2 { color: #333; }
            table {{
                width: 100%;
                border-collapse: collapse;
                margin: 20px 0;
            }}
            th, td {
                padding: 10px;
                border: 1px solid #ddd;
                text-align: left;
            }
            th { background-color: #f2f2f2; }
            .both-missing { background-color: #ffcccc; } /* Light red for both missing */
            .one-missing { background-color: #ffffcc; } /* Light yellow for one missing */
            .suggested { color: #666; font-style: italic; font-size: 0.9em; margin-top: 5px; display: block; }
            .button {
                display: inline-block;
                padding: 10px 15px;
                background-color: #4CAF50;
                color: white;
                text-decoration: none;
                border: none;
                cursor: pointer;
                margin-right: 10px;
            }
            .info {
                background-color: #f8f9fa;
                padding: 15px;
                border-left: 4px solid #17a2b8;
                margin-bottom: 20px;
            }
            input[type="text"] {
                width: 100%;
                padding: 8px;
                box-sizing: border-box;
            }
            .action-buttons {
                margin-top: 20px;
            }
        </style>
    </head>
    <body>
        <h1>Fix Missing Time Entries</h1>

        <div class="info">
            <p>Some entries in your timesheet have missing Clock In or Clock Out values. Fill in only the values you want to fix and leave the rest empty, or choose to ignore these entries.</p>
            <p>Time format should be <strong>HH:MM:SS</strong> (e.g., 09:00:00)</p>
            <p><strong>Note:</strong> You can leave fields empty if you don't want to fix them - only fill in the times you need to correct.</p>
            <p><strong>Important:</strong> Both Clock In and Clock Out times are required to calculate hours. Entries with only one time will not appear in the payroll report.</p>
            <p><strong>Days Off:</strong> If an employee had the day off, leave both fields empty. They won't appear in the payroll report and won't be paid for that day.</p>
        </div>

        <div style="margin: 15px 0; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
            <strong>Color Legend:</strong>
            <span style="display: inline-block; width: 20px; height: 15px; background-color: #ffcccc; border: 1px solid #ccc; vertical-align: middle;"></span> Both times missing
            <span style="margin-left: 20px; display: inline-block; width: 20px; height: 15px; background-color: #ffffcc; border: 1px solid #ccc; vertical-align: middle;"></span> One time missing
        </div>

        <form action="/fix_missing_times" method="post">
            <table>
                <tr>
                    <th>Employee</th>
                    <th>Date</th>
                    <th>Clock In</th>
                    <th>Clock Out</th>
                </tr>
    """

    for record in missing_records:
        # Determine row class based on missing data
        row_class = ""
        if not record['clock_in'] and not record['clock_out']:
            row_class = "both-missing"
        elif not record['clock_in'] or not record['clock_out']:
            row_class = "one-missing"

        # Get suggestions for missing times
        clock_in_suggestion = ""
        clock_out_suggestion = ""
        if not record['clock_in'] and df is not None:
            suggested_in = get_suggested_time(record['date'], 'Clock In', df)
            clock_in_suggestion = f'<span class="suggested">Suggested: {suggested_in}</span>'
        if not record['clock_out'] and df is not None:
            suggested_out = get_suggested_time(record['date'], 'Clock Out', df)
            clock_out_suggestion = f'<span class="suggested">Suggested: {suggested_out}</span>'

        html += f"""
                <tr class="{row_class}">
                    <td>{record['name']} (ID: {record['person_id']})</td>
                    <td>{record['date']}</td>
                    <td>
                        <input type="text" name="fix_clockin_{record['index']}" value="{record['clock_in']}"
                               placeholder="e.g., 09:00:00">
                        {clock_in_suggestion}
                    </td>
                    <td>
                        <input type="text" name="fix_clockout_{record['index']}" value="{record['clock_out']}"
                               placeholder="e.g., 17:00:00">
                        {clock_out_suggestion}
                    </td>

                </tr>
        """

    html += """
            </table>

            <div class="action-buttons">
                <button type="submit" name="action" value="fix" class="button">Fix and Continue</button>
                <button type="submit" name="action" value="ignore" class="button" style="background-color: #f44336;">Ignore Missing Values</button>
            </div>
        </form>
    </body>
    </html>
    """

    return render_template_string(html)

@app.route('/success')
@login_required
def success():
    """Success page with download links"""
    reports = session.get('reports', {})
    week = session.get('week', datetime.now().strftime('%Y-%m-%d'))
    username = session.get('username', 'Unknown')
    menu_html = get_menu_html(username)

    # Clear the report cache so the reports page will show the new reports
    clear_report_cache()

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Processing Successful</title>
        <style>
            :root{{ --bg:#f5f7fb; --card:#ffffff; --text:#2d3748; --muted:#6c757d; --primary:#4CAF50; --primary-700:#388e3c; --accent:#2196F3; --accent-700:#1976d2; --border:#e6e9f0; }}
            *{{ box-sizing:border-box; }}
            body{{ font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; margin:32px; line-height:1.6; color:var(--text); background:var(--bg); }}
            h1{{ color:var(--text); margin:8px 0 18px; font-weight:700; }}
            h2{{ color:var(--text); margin:0 0 12px; font-weight:600; }}

            .menu{{ background:var(--card); padding:14px 16px; margin-bottom:20px; border-radius:12px; border:1px solid var(--border); box-shadow:0 4px 10px rgba(17,24,39,.04); }}
            .menu a{{ margin-right:14px; text-decoration:none; color:var(--accent-700); font-weight:600; padding:6px 10px; border-radius:8px; }}
            .menu a:hover{{ background:rgba(33,150,243,.08); }}
            .user-info{{ float:right; font-size:.9em; color:var(--muted); }}

            .button,.print-button{{ display:inline-block; padding:10px 16px; color:#fff; text-decoration:none; border:none; border-radius:10px; font-weight:600; box-shadow:0 6px 14px rgba(0,0,0,.08); transition:all .15s ease; }}
            .button{{ background:linear-gradient(135deg,var(--primary) 0%,var(--primary-700) 100%); }}
            .button:hover{{ transform:translateY(-1px); box-shadow:0 10px 18px rgba(0,0,0,.12); }}
            .print-button{{ background:linear-gradient(135deg,var(--accent) 0%,var(--accent-700) 100%); }}
            .print-button:hover{{ transform:translateY(-1px); box-shadow:0 10px 18px rgba(0,0,0,.12); }}

            .download-section{{ background:var(--card); padding:22px; border-radius:14px; margin:20px 0; border:1px solid var(--border); box-shadow:0 10px 24px rgba(17,24,39,.06); }}
            .recommended{{ border-left:6px solid var(--primary); padding-left:16px; }}
            small{{ color:var(--muted); }}

            label{{ font-weight:600; margin-right:8px; color:var(--text); }}
            select, input[type="text"]{{ padding:10px 12px; border:1px solid var(--border); border-radius:10px; outline:none; background:#fff; color:var(--text); }}
            select:focus, input[type="text"]:focus{{ border-color:var(--accent-700); box-shadow:0 0 0 3px rgba(33,150,243,.15); }}
        </style>
    </head>
    <body>
        <h1>Processing Successful</h1>
        {menu_html}
        <p>Your file was successfully processed for week {week}.</p>
    """

    if 'admin' in reports and 'payslips_sheet' in reports:
        html += f"""
        <div class="download-section recommended">
            <h2>Recommended Reports (Single Sheet)</h2>

            <p><a href="/download/admin" class="button">Download Admin Report</a>
               <a href="/print/admin" target="_blank" class="print-button">Print-Friendly Admin Report</a></p>
            <p><small>This report contains all employee data in a single sheet with signature lines for your records</small></p>

            <p><a href="/download/payslips_sheet" class="button">Download Cuttable Payslips</a>
               <a href="/print/payslips" target="_blank" class="print-button">Print-Friendly Payslips</a></p>
            <p><small>This report contains all employee payslips in a single sheet with cut lines for easy distribution</small></p>

            <p>Alternative download methods:</p>
            <ul>
                <li>Admin Report: <a href="/static/reports/{reports['admin']}">/static/reports/{reports['admin']}</a></li>
                <li>Cuttable Payslips: <a href="/static/reports/{reports['payslips_sheet']}">/static/reports/{reports['payslips_sheet']}</a></li>
            </ul>

            <div style="margin-top: 14px; padding-top: 10px; border-top: 1px dashed #ccc;">
                <h3>Create Zoho Books Expense</h3>
                <p>Automatically create an expense in Zoho Books and attach the admin report as the receipt.</p>
                <form id="zoho-expense-form" action="/zoho/create_expense" method="post">
                    <label for="company">Company to post to:</label>
                    <select id="company" name="company">
                        <option value="haute">Haute Brands</option>
                        <option value="boomin">Boomin Brands</option>
                    </select>
                    <input type="hidden" name="week" value="{week}">

                    <div style="margin-top:8px;">
                        <label for="custom_desc">Notes (append to description):</label>
                        <input type="text" id="custom_desc" name="custom_desc" placeholder="Optional notes..." style="width:360px;">
                    </div>
                    <button type="submit" class="button">Push Expense to Zoho Books</button>
                </form>
                <script>
                (function(){{
                    const form = document.getElementById('zoho-expense-form');
                    if(!form) return;
                    form.addEventListener('submit', async function(ev){{
                        ev.preventDefault();
                        const data = new FormData(form);
                        data.append('ajax','1');
                        const btn = form.querySelector('button[type="submit"]');
                        if(btn){{ btn.disabled = true; btn.textContent = 'Pushing...'; }}
                        try {{
                            const res = await fetch(form.action, {{ method: 'POST', body: data, headers: {{'X-Requested-With':'XMLHttpRequest'}} }});
                            let payload = null;
                            let textBody = '';
                            try {{ payload = await res.clone().json(); }} catch(e) {{ payload = null; }}
                            try {{ textBody = await res.text(); }} catch(e) {{ textBody = ''; }}
                            if (payload && payload.status === 'ok') {{
                                const msg = payload.duplicate ? ('Expense already exists. ID: ' + payload.expense_id)
                                                              : ('Expense created successfully. ID: ' + payload.expense_id);
                                alert(msg);
                            }} else {{
                                const fallback = textBody || (payload ? JSON.stringify(payload) : (res.status + ' ' + res.statusText));
                                alert('Expense push response: ' + fallback);
                            }}
                        }} catch (err) {{
                            alert('Error creating expense: ' + err);
                        }} finally {{
                            if(btn){{ btn.disabled = false; btn.textContent = 'Push Expense to Zoho Books'; }}
                        }}
                    }});
                }})();
                </script>
                <p style="color:#6c757d; font-size: 0.9em;">Configure credentials via environment variables: ZB_HAUTE_* and ZB_BOOMIN_*.</p>
            </div>
        </div>
        """

    if 'combined' in reports and 'combined_no_sig' in reports:
        html += f"""
        <div class="download-section">
            <h2>Multi-Tab Combined Reports</h2>

            <p><a href="/download/combined" class="button">Download Combined Report (With Signatures)</a></p>
            <p><small>This report includes a summary page and individual employee sheets with signature lines</small></p>

            <p><a href="/download/combined_no_sig" class="button">Download Combined Report (Without Signatures)</a></p>
            <p><small>This report includes a summary page and individual employee sheets without signature lines, perfect for distributing</small></p>
        </div>
        """

    if 'summary' in reports:
        html += f"""
        <div class="download-section">
            <h2>Other Reports</h2>

            <p><a href="/download/summary" class="button">Download Payroll Summary</a></p>

            <p><a href="/download/payslips" class="button">Download Employee Payslips</a></p>
        </div>
        """

    if 'error' in reports:
        html += f"""
        <div class="download-section">
            <h2>Error Report</h2>
            <p>There was an error processing your file. Please check the error report for details.</p>

            <p><a href="/static/reports/{reports['error']}" class="button">View Error Report</a></p>
        </div>
        """

    html += """
        <p><a href="/" class="button">Process Another File</a></p>
    </body>
    </html>
    """

    return render_template_string(html)

@app.route('/print/<report_type>')
def print_friendly(report_type):
    """Generate a print-friendly version of a report"""
    try:
        # Import datetime at the beginning of the function
        from datetime import datetime, timedelta

        if report_type == 'admin':
            filename = session.get('reports', {}).get('admin', '')
            if not filename:
                return "No admin report found", 404

            # Get week range from session
            week = session.get('week', datetime.now().strftime('%Y-%m-%d'))

            # Get the file path to read the Excel data
            file_path = os.path.join(REPORT_FOLDER, filename)
            if not os.path.exists(file_path):
                return f"File not found: {filename}", 404

            # Extract data from Excel file
            from openpyxl import load_workbook
            wb = load_workbook(file_path)
            ws = wb.active

            # Prefer date range from the workbook header if present
            date_range_display = session.get('week', datetime.now().strftime('%Y-%m-%d'))
            try:
                header_text = str(ws['A1'].value or '')
                if ' - ' in header_text:
                    # Extract portion after the first ' - '
                    date_range_display = header_text.split(' - ', 1)[1].strip()
            except Exception:
                pass

            # Find the summary section (starting from row 3)
            summary_data = []
            summary_headers = []
            summary_start_col = None
            grand_total_row = None

            # Find where the summary table starts
            for row in range(3, 10):  # Check first few rows
                for col in range(1, 20):  # Check several columns
                    cell_value = ws.cell(row=row, column=col).value
                    if cell_value == "Person ID":
                        summary_start_col = col
                        # Extract headers
                        for h_col in range(col, col+5):
                            summary_headers.append(ws.cell(row=row, column=h_col).value)
                        break
                if summary_start_col:
                    break

            # Extract summary data - this contains all employees
            employee_data = {}  # Track all employees by ID
            if summary_start_col:
                current_row = 4
                while True:
                    cell_value = ws.cell(row=current_row, column=summary_start_col).value
                    if cell_value is None or ws.cell(row=current_row, column=summary_start_col+1).value == "GRAND TOTAL":
                        break

                    # Collect data from summary row
                    person_id = cell_value
                    name = ws.cell(row=current_row, column=summary_start_col+1).value
                    hours = ws.cell(row=current_row, column=summary_start_col+2).value
                    pay = ws.cell(row=current_row, column=summary_start_col+3).value
                    rounded_pay = ws.cell(row=current_row, column=summary_start_col+4).value

                    # Store the employee summary data for later use
                    employee_data[str(person_id)] = {
                        'id': person_id,
                        'name': name,
                        'total_hours': hours,
                        'total_pay': pay,
                        'rounded_pay': rounded_pay,
                        'info': {},
                        'days': []
                    }

                    # Add to the summary data list as well
                    row_data = []
                    for col in range(summary_start_col, summary_start_col+5):
                        row_data.append(ws.cell(row=current_row, column=col).value)

                    summary_data.append(row_data)
                    current_row += 1

                # Check for grand total row
                if ws.cell(row=current_row, column=summary_start_col+1).value == "GRAND TOTAL":
                    grand_total_row = []
                    for col in range(summary_start_col, summary_start_col+5):
                        grand_total_row.append(ws.cell(row=current_row, column=col).value)

            # Find all employee breakdown sections by looking for employee names and collecting their details
            # Look through the entire Excel file for employee details

            for row in range(1, ws.max_row):
                # Look for patterns that indicate employee data
                for col in range(1, min(ws.max_column, 20)):  # Check a reasonable number of columns
                    cell_value = ws.cell(row=row, column=col).value

                    # Look for employee ID row indicators like "ID: X | Rate: $Y.ZZ"
                    if cell_value and isinstance(cell_value, str) and "ID:" in cell_value and "Rate:" in cell_value:
                        # Extract the employee ID
                        try:
                            id_part = cell_value.split("|")[0].strip()
                            id_value = id_part.replace("ID:", "").strip()

                            # Look for the employee name in the row above
                            employee_name = ws.cell(row=row-1, column=col).value

                            # If we have this employee in our summary data, add the details
                            if id_value in employee_data:
                                employee_data[id_value]['info']['details'] = cell_value

                                # Look for the data table in the rows below
                                date_row = row + 1

                                # Check if this row contains the date header
                                if ws.cell(row=date_row, column=col).value == "Date":
                                    # Found the date header, start collecting daily entries from the next row
                                    day_row = date_row + 1

                                    # Collect employee daily records
                                    while day_row < min(day_row + 20, ws.max_row):  # Reasonable limit
                                        date_val = ws.cell(row=day_row, column=col).value

                                        # Stop if we hit an empty row or "Total:"
                                        if not date_val:
                                            break

                                        if isinstance(date_val, str) and date_val.startswith("Total:"):
                                            # Found totals row
                                            employee_data[id_value]['totals'] = {
                                                'hours': ws.cell(row=day_row, column=col+3).value,
                                                'pay': ws.cell(row=day_row, column=col+4).value
                                            }
                                            break

                                        # Add day entry
                                        try:
                                            day_data = {
                                                'date': date_val,
                                                'in': ws.cell(row=day_row, column=col+1).value,
                                                'out': ws.cell(row=day_row, column=col+2).value,
                                                'hours': ws.cell(row=day_row, column=col+3).value,
                                                'pay': ws.cell(row=day_row, column=col+4).value
                                            }
                                            employee_data[id_value]['days'].append(day_data)
                                        except Exception as e:
                                            print(f"Error processing day row: {e}")

                                        day_row += 1
                        except Exception as e:
                            print(f"Error processing employee info: {e}")

            # Generate print-friendly HTML by constructing from the collected employee_data
            html = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Admin Report - {date_range_display}</title>
                <style>
                    @page {{ size: landscape; margin: 0.5cm; }}

                    body {{ font-family: Arial, sans-serif; margin: 0; padding: 5px; font-size: 9pt; line-height: 1.1; }}
                    h1 {{ color: #333; text-align: center; margin: 5px 0; font-size: 12pt; }}
                    h2 {{ color: #333; text-align: center; margin: 5px 0; font-size: 11pt; }}
                    p {{ margin: 2px 0; }}

                    table {{ width: 100%; border-collapse: collapse; margin-bottom: 5px; }}
                    th {{ background-color: #f2f2f2; text-align: left; border-bottom: 1px solid #ddd; padding: 2px; font-size: 9pt; }}
                    td {{ padding: 1px; font-size: 8pt; }}

                    .summary-table {{ width: 100%; margin-bottom: 10px; }}
                    .summary-table th {{ background-color: #f2f2f2; }}

                    .employee-section {{ width: 32%; margin-right: 1.5%; margin-bottom: 10px; float: left; }}
                    .employee-section:nth-child(3n) {{ margin-right: 0; }}
                    .employee-header {{ font-size: 10pt; font-weight: bold; margin-bottom: 3px; }}
                    .employee-info {{ font-size: 8pt; margin-bottom: 3px; }}

                    .employee-table {{ width: 100%; }}
                    .employee-table th {{ font-size: 8pt; padding: 1px; }}
                    .employee-table td {{ font-size: 8pt; padding: 1px; }}

                    .text-right {{ text-align: right; }}
                    .total-row {{ border-top: 1px solid #ddd; font-weight: bold; }}

                    .signature-line {{ margin-top: 5px; padding: 1px 0; }}

                    .print-button {{ position: fixed; top: 10px; right: 10px; padding: 8px 15px; background-color: #2196F3;
                                   color: white; border: none; border-radius: 4px; cursor: pointer; z-index: 999; }}
                    .print-button:hover {{ background-color: #0b7dda; }}

                    .clearfix::after {{
                        content: "";
                        clear: both;
                        display: table;
                    }}

                    /* For print view */
                    @media print {{
                        .print-button {{ display: none; }}
                        .page-break {{ page-break-before: always; }}
                        body {{ zoom: 100%; }}
                    }}
                </style>
                <script>
                    function printReport() {{
                        window.print();
                    }}

                    // Auto print when the page loads
                    window.onload = function() {{
                        // Wait a moment to ensure everything has rendered
                        setTimeout(function() {{
                            window.print();
                        }}, 500);
                    }};
                </script>
            </head>
            <body>
                <button onclick="printReport()" class="print-button">Print Report</button>

                <h1>Payroll Summary - {date_range_display}</h1>

                <!-- Summary Table -->
                <table class="summary-table">
                    <tr>
            """

            # Add summary headers
            for header in summary_headers:
                html += f"<th>{header}</th>"
            html += "</tr>"

            # Add summary data rows
            for row in summary_data:
                html += "<tr>"
                for i, cell in enumerate(row):
                    # Format monetary values
                    if i >= 3 and isinstance(cell, (int, float)):
                        html += f'<td class="text-right">${cell:.2f}</td>'
                    else:
                        html += f"<td>{cell}</td>"
                html += "</tr>"

            # Add grand total row if found
            if grand_total_row:
                html += '<tr class="total-row">'
                for i, cell in enumerate(grand_total_row):
                    if i == 0:
                        html += "<td></td>"
                    elif i == 1:
                        html += f"<td><strong>{cell}</strong></td>"
                    # Format monetary values
                    elif i >= 3 and isinstance(cell, (int, float)):
                        html += f'<td class="text-right"><strong>${cell:.2f}</strong></td>'
                    else:
                        html += f"<td><strong>{cell}</strong></td>"
                html += "</tr>"

            html += """
                </table>

                <h2>Detailed Breakdown by Employee</h2>

                <div class="clearfix">
            """

            # Convert our employee data dictionary to a sorted list to display
            employee_list = list(employee_data.values())

            # Sort employees by ID
            employee_list.sort(key=lambda x: str(x['id']))

            # Check if we have any breakdown sections
            if not employee_list:
                html += "<p>No detailed breakdown data found.</p>"
            else:
                # Number of employees per page - 9 on first page (3 rows of 3), rest on second page
                employees_per_page = 9

                # Add employee sections, 3 per row
                for i, emp in enumerate(employee_list):
                    # Add page break after the first 9 employees
                    if i == employees_per_page:
                        html += '</div><div class="page-break"></div><div class="clearfix">'

                    # Add a new row every 3 employees
                    if i > 0 and i % 3 == 0:
                        html += '</div><div class="clearfix">'

                    # Format total values
                    total_hours = emp.get('total_hours', 0)
                    total_pay = emp.get('total_pay', 0)
                    rounded_pay = emp.get('rounded_pay', 0)

                    # Make sure total hours and pay are numeric
                    if not isinstance(total_hours, (int, float)):
                        try:
                            total_hours = float(total_hours)
                        except:
                            total_hours = 0

                    if not isinstance(total_pay, (int, float)):
                        try:
                            total_pay = float(total_pay)
                        except:
                            total_pay = 0

                    if not isinstance(rounded_pay, (int, float)):
                        try:
                            rounded_pay = float(rounded_pay)
                        except:
                            rounded_pay = 0

                    html += f"""
                    <div class="employee-section">
                        <div class="employee-header">{emp['name']}</div>
                        <div class="employee-info">{emp['info'].get('details', f"ID: {emp['id']}")}</div>

                        <table class="employee-table">
                            <tr>
                                <th>Date</th>
                                <th>In</th>
                                <th>Out</th>
                                <th>Hours</th>
                                <th>Pay</th>
                            </tr>
                    """

                    # Add daily entries
                    for day in emp.get('days', []):
                        date_str = day['date']
                        pay_val = day['pay']
                        pay_str = f"${pay_val:.2f}" if isinstance(pay_val, (int, float)) else pay_val

                        html += f"""
                            <tr>
                                <td>{date_str}</td>
                                <td>{day['in'] or ''}</td>
                                <td>{day['out'] or ''}</td>
                                <td>{day['hours'] or ''}</td>
                                <td class="text-right">{pay_str}</td>
                            </tr>
                        """

                    # If no days data but we have total hours/pay, show empty rows with zeros
                    if not emp.get('days') and total_hours > 0:
                        # Format for a typical work week (Mon-Fri)
                        for day_num in range(5):
                            html += f"""
                                <tr>
                                    <td>{'4/' + str(26 + day_num) + '/2025'}</td>
                                    <td>None</td>
                                    <td>None</td>
                                    <td>0</td>
                                    <td class="text-right">$0.00</td>
                                </tr>
                            """

                    # Add total row
                    html += f"""
                        <tr>
                            <td colspan="4">Total:</td>
                            <td class="text-right">${total_pay:.2f}</td>
                        </tr>
                    """

                    # Add rounded pay
                    html += f"""
                        <tr>
                            <td colspan="4">Rounded Pay:</td>
                            <td class="text-right">${rounded_pay:.2f}</td>
                        </tr>
                    </table>

                    <div class="signature-line">
                        <span>Signature:_________</span>
                        <span style="float:right">Date:_________</span>
                    </div>
                    </div>
                    """

            html += """
                </div>
            </body>
            </html>
            """

            return render_template_string(html)

        elif report_type == 'payslips':
            filename = session.get('reports', {}).get('payslips_sheet', '')
            if not filename:
                return "No payslips report found", 404

            # Get week range from session
            week = session.get('week', datetime.now().strftime('%Y-%m-%d'))

            # Get the file path to read the Excel data
            file_path = os.path.join(REPORT_FOLDER, filename)
            if not os.path.exists(file_path):
                return f"File not found: {filename}", 404

            # Extract data from Excel file
            from openpyxl import load_workbook
            wb = load_workbook(file_path)
            ws = wb.active

            # Prefer date range from the workbook header if present
            date_range_display = session.get('week', datetime.now().strftime('%Y-%m-%d'))
            try:
                header_text = str(ws['A1'].value or '')
                if ' - ' in header_text:
                    date_range_display = header_text.split(' - ', 1)[1].strip()
            except Exception:
                pass

            # Find all payslip sections - add debugging
            payslips = []
            found_rows = []

            # Add debug log to help diagnose the issue
            debug_info = f"Excel file: {file_path}, Worksheet dimensions: {ws.max_row}x{ws.max_column}\n"

            # First, scan entire sheet for "Employee:" cells to locate all employee sections
            for row in range(1, ws.max_row):
                for col in range(1, min(ws.max_column + 1, 30)):
                    cell_value = ws.cell(row=row, column=col).value
                    if isinstance(cell_value, str) and "Employee:" in cell_value:
                        found_rows.append((row, col))
                        debug_info += f"Found employee at row {row}, col {col}: {cell_value}\n"

            debug_info += f"Total employee sections found: {len(found_rows)}\n"

            # Now process each found employee section
            for row, col in found_rows:
                cell_value = ws.cell(row=row, column=col).value

                # Found a payslip
                payslip = {
                    'name': cell_value.replace("Employee:", "").strip(),
                    'info': {},
                    'days': []
                }

                # Find the employee ID
                id_found = False
                # Look for ID in the next row or nearby cells
                for r in range(row, min(row+3, ws.max_row)):
                    for c in range(max(1, col-2), min(col+6, ws.max_column + 1)):
                        cell_text = ws.cell(row=r, column=c).value
                        if cell_text and isinstance(cell_text, str) and "ID:" in cell_text:
                            payslip['info']['id'] = cell_text.replace("ID:", "").strip()
                            id_found = True
                            break
                    if id_found:
                        break

                # Find pay period
                period_found = False
                for r in range(row, min(row+3, ws.max_row)):
                    for c in range(max(1, col-2), min(col+6, ws.max_column + 1)):
                        cell_text = ws.cell(row=r, column=c).value
                        if cell_text and isinstance(cell_text, str) and "Pay Period:" in cell_text:
                            payslip['period'] = cell_text.replace("Pay Period:", "").strip()
                            period_found = True
                            break
                    if period_found:
                        break

                # Find hourly rate
                rate_found = False
                for r in range(row, min(row+3, ws.max_row)):
                    for c in range(max(1, col-2), min(col+6, ws.max_column + 1)):
                        cell_text = ws.cell(row=r, column=c).value
                        if cell_text and isinstance(cell_text, str) and "Rate:" in cell_text:
                            payslip['info']['rate'] = cell_text
                            rate_found = True
                            break
                    if rate_found:
                        break

                # Find the "Date" header to locate the timesheet area
                date_header_row = None
                date_header_col = None
                for r in range(row, min(row+5, ws.max_row)):
                    for c in range(max(1, col-2), min(col+6, ws.max_column + 1)):
                        header_val = ws.cell(row=r, column=c).value
                        if header_val == "Date":
                            date_header_row = r
                            date_header_col = c
                            break
                    if date_header_row:
                        break

                if not date_header_row:
                    debug_info += f"Could not find Date header for employee at row {row}, col {col}\n"
                    continue  # Skip if we can't find the date header

                debug_info += f"Found Date header at row {date_header_row}, col {date_header_col} for employee at row {row}\n"

                # Find the column headers to map the structure
                headers = []
                header_cols = {}

                for c in range(max(1, date_header_col-1), min(date_header_col+6, ws.max_column + 1)):
                    header_text = ws.cell(row=date_header_row, column=c).value
                    if header_text:
                        headers.append(header_text)
                        header_cols[header_text] = c
                        debug_info += f"Found header '{header_text}' at column {c}\n"

                # Get daily entries - start from the row after headers
                day_row = date_header_row + 1
                total_hours = None
                total_pay = None
                rounded_pay = None

                days_found = 0
                while day_row < min(day_row + 20, ws.max_row):  # Increased limit
                    date_val = ws.cell(row=day_row, column=date_header_col).value

                    # Exit if empty row and we've processed some data already
                    if not date_val and days_found > 0 and day_row > date_header_row + 6:
                        break

                    # Check for totals row
                    if isinstance(date_val, str) and ("Total" in date_val or date_val.strip() == "Total:"):
                        # Found hours or pay totals
                        debug_info += f"Found totals row at {day_row}: {date_val}\n"
                        if "Hours" in header_cols:
                            total_hours = ws.cell(row=day_row, column=header_cols["Hours"]).value
                        if "Pay" in header_cols:
                            total_pay = ws.cell(row=day_row, column=header_cols["Pay"]).value
                        day_row += 1
                        continue

                    # Check for Rounded Pay row
                    if isinstance(date_val, str) and "Rounded" in date_val:
                        debug_info += f"Found rounded pay at {day_row}: {date_val}\n"
                        if "Pay" in header_cols:
                            rounded_pay = ws.cell(row=day_row, column=header_cols["Pay"]).value
                        day_row += 1
                        continue

                    # Only process rows with actual dates (not empty or text)
                    if date_val and not isinstance(date_val, str):
                        try:
                            # Convert Excel serial date if needed
                            if isinstance(date_val, (int, float)):
                                # Use the already imported datetime and timedelta from function scope
                                date_val = (datetime(1899, 12, 30) + timedelta(days=date_val)).strftime('%m/%d/%Y')
                        except:
                            pass

                    try:
                        # Only add if it has a date value and hours > 0
                        hours_val = None
                        if "Hours" in header_cols:
                            hours_val = ws.cell(row=day_row, column=header_cols["Hours"]).value

                        pay_val = None
                        if "Pay" in header_cols:
                            pay_val = ws.cell(row=day_row, column=header_cols["Pay"]).value

                        # Add valid entries with dates and hours
                        if date_val and hours_val and float(hours_val) > 0:
                            in_val = None
                            out_val = None

                            if "In" in header_cols:
                                in_val = ws.cell(row=day_row, column=header_cols["In"]).value

                            if "Out" in header_cols:
                                out_val = ws.cell(row=day_row, column=header_cols["Out"]).value

                            day_data = {
                                'date': date_val,
                                'in': in_val,
                                'out': out_val,
                                'hours': hours_val,
                                'pay': pay_val
                            }
                            payslip['days'].append(day_data)
                            days_found += 1
                            debug_info += f"Added day entry at row {day_row}: date={date_val}, hours={hours_val}\n"
                    except Exception as e:
                        debug_info += f"Error processing row {day_row}: {str(e)}\n"

                    day_row += 1

                # Add totals to the payslip object
                if total_hours is not None:
                    payslip['total_hours'] = total_hours
                elif payslip['days']:
                    # Calculate from individual days if not found
                    total_hours = sum(float(day['hours']) for day in payslip['days'] if day['hours'])
                    payslip['total_hours'] = round(total_hours, 2)

                if total_pay is not None:
                    payslip['total_pay'] = total_pay
                elif payslip['days']:
                    # Calculate from individual days if not found
                    total_pay = sum(float(day['pay']) for day in payslip['days'] if day['pay'])
                    payslip['total_pay'] = round(total_pay, 2)

                if rounded_pay is not None:
                    payslip['rounded_pay'] = rounded_pay
                elif total_pay is not None:
                    # Round to nearest dollar if not found
                    payslip['rounded_pay'] = round(float(total_pay))

                # Only add payslips with actual day entries
                if len(payslip['days']) > 0:
                    payslips.append(payslip)
                    debug_info += f"Added payslip for {payslip['name']} with {len(payslip['days'])} days\n"
                else:
                    debug_info += f"Skipped payslip for {payslip['name']} because it has no days\n"

            # If no payslips found, return debug info
            if not payslips:
                return f"No payslips found in the Excel file. Debug info:<br><pre>{debug_info}</pre>", 400

            # Generate print-friendly HTML
            html = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Employee Payslips - {date_range_display}</title>
                <style>
                    @page {{ size: portrait; margin: 0.5cm; scale: 78%; }}

                    body {{ font-family: Arial, sans-serif; margin: 0; padding: 0; font-size: 8pt; line-height: 1.2; }}
                    h1 {{ color: #333; text-align: center; margin: 5px 0; font-size: 12pt; }}
                    p {{ margin: 2px 0; }}

                    table {{ width: 100%; border-collapse: collapse; margin-bottom: 5px; }}
                    th {{ background-color: #f2f2f2; text-align: left; border-bottom: 1px solid #ddd; padding: 2px; font-size: 8pt; }}
                    td {{ padding: 2px; font-size: 8pt; }}

                    .payslip {{ break-inside: avoid; page-break-inside: avoid; border: 1px solid #ddd;
                               border-radius: 3px; padding: 8px; margin-bottom: 10px; width: 100%; box-sizing: border-box; }}
                    .payslip-header {{ border-bottom: 1px solid #eee; padding-bottom: 4px; margin-bottom: 4px; }}
                    .employee-name {{ font-size: 10pt; font-weight: bold; }}
                    .employee-id {{ text-align: right; font-weight: normal; font-size: 8pt; }}

                    .info-row {{ display: flex; justify-content: space-between; margin: 2px 0; }}
                    .period {{ font-style: italic; color: #666; font-size: 7pt; }}
                    .total-row {{ border-top: 1px solid #ddd; font-weight: bold; }}
                    .text-right {{ text-align: right; }}

                    .signature-line {{ margin-top: 5px; padding: 2px 0; display: flex; justify-content: space-between; font-size: 7pt; }}

                    .print-button {{ position: fixed; top: 10px; right: 10px; padding: 8px 15px; background-color: #2196F3;
                                   color: white; border: none; border-radius: 4px; cursor: pointer; z-index: 999; }}
                    .print-button:hover {{ background-color: #0b7dda; }}

                    .debug-button {{ position: fixed; top: 10px; left: 10px; padding: 8px 15px; background-color: #FF5722;
                                   color: white; border: none; border-radius: 4px; cursor: pointer; z-index: 999; }}
                    .debug-info {{ display: none; background: #f5f5f5; border: 1px solid #ddd; padding: 15px;
                                 margin: 20px 0; font-family: monospace; font-size: 12px; white-space: pre-wrap; }}

                    .payslips-container {{ display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; }}

                    /* For print view, optimize to fit multiple per page */
                    @media print {{
                        .print-button, .debug-button, .debug-info {{ display: none; }}
                        .page-break {{ page-break-before: always; }}

                        /* Compact layout for print */
                        body {{ font-size: 7pt; line-height: 1.1; }}

                        /* Two columns of payslips */
                        .payslip {{
                            width: 48%;
                            display: inline-block;
                            vertical-align: top;
                            margin-bottom: 0.2cm;
                            padding: 0.4cm;
                            border: 1px solid #ccc;
                        }}

                        table {{ margin-bottom: 2px; }}
                        td, th {{ padding: 1px; font-size: 7pt; }}
                        .signature-line {{ margin-top: 5px; font-size: 6pt; }}
                        .employee-name {{ font-size: 9pt; }}
                    }}
                </style>
                <script>
                    function printReport() {{
                        window.print();
                    }}

                    function toggleDebug() {{
                        var debugInfo = document.getElementById('debug-info');
                        if (debugInfo.style.display === 'none' || !debugInfo.style.display) {{
                            debugInfo.style.display = 'block';
                        }} else {{
                            debugInfo.style.display = 'none';
                        }}
                    }}

                    // Set print scale to 78%
                    function setPrintScale() {{
                        // For Chrome and Safari
                        if (window.matchMedia) {{
                            const mediaQueryList = window.matchMedia('print');
                            mediaQueryList.addListener(function(mql) {{
                                if (mql.matches) {{
                                    document.body.style.zoom = "78%";
                                }}
                            }});
                        }}
                    }}

                    // Auto print when the page loads
                    window.onload = function() {{
                        // Set print scale
                        setPrintScale();

                        // Wait a moment to ensure everything has rendered
                        setTimeout(function() {{
                            window.print();
                        }}, 500);
                    }};
                </script>
            </head>
            <body>
                <button onclick="printReport()" class="print-button">Print Payslips</button>
                <button onclick="toggleDebug()" class="debug-button">Toggle Debug Info</button>

                <div id="debug-info" class="debug-info">
                    <h3>Debug Information</h3>
                    <p>Found {len(payslips)} payslips</p>
                    <pre>{debug_info}</pre>
                </div>

                <h1>Employee Payslips - {date_range_display}</h1>
                <p style="text-align: center; margin: 0 0 5px 0;">Found {len(payslips)} employee payslips</p>


                <div class="payslips-container">
            """

            # Add each payslip
            for i, payslip in enumerate(payslips):
                emp_id = payslip['info'].get('id', '')

                # Remove page breaks to fit all on one page
                # if i > 0 and i % 3 == 0:
                #     html += '<div class="page-break"></div>'

                html += f"""
                <div class="payslip">
                    <div class="payslip-header">
                        <div class="employee-name">
                            {payslip['name']}
                            <span class="employee-id">ID: {emp_id}</span>
                        </div>
                        <div class="info-row">
                            <div class="period">Pay Period: {payslip.get('period', week)}</div>
                            <div>{payslip['info'].get('rate', '')}</div>
                        </div>
                    </div>

                    <table>
                        <tr>
                            <th>Date</th>
                            <th>In</th>
                            <th>Out</th>
                            <th>Hours</th>
                            <th>Pay</th>
                        </tr>
                """

                # Add daily entries
                for day in payslip['days']:
                    date_str = day['date']
                    pay_val = day['pay']

                    # Format pay as currency
                    pay_str = ""
                    if pay_val is not None:
                        if isinstance(pay_val, (int, float)):
                            pay_str = f"${pay_val:.2f}"
                        else:
                            pay_str = str(pay_val)

                    # Format hours to show 2 decimal places
                    hours_val = day['hours']
                    hours_str = ""
                    if hours_val is not None:
                        if isinstance(hours_val, (int, float)):
                            hours_str = f"{hours_val:.2f}"
                        else:
                            hours_str = str(hours_val)

                    html += f"""
                        <tr>
                            <td>{date_str}</td>
                            <td>{day['in'] or ''}</td>
                            <td>{day['out'] or ''}</td>
                            <td>{hours_str}</td>
                            <td class="text-right">{pay_str}</td>
                        </tr>
                    """

                # Format totals with proper currency and decimals
                total_hours = payslip.get('total_hours', '')
                if isinstance(total_hours, (int, float)):
                    total_hours = f"{total_hours:.2f}"

                total_pay = payslip.get('total_pay', '')
                total_pay_str = ""
                if isinstance(total_pay, (int, float)):
                    total_pay_str = f"${total_pay:.2f}"
                else:
                    total_pay_str = f"${total_pay}" if total_pay else "$0.00"

                rounded_pay = payslip.get('rounded_pay', '')
                rounded_pay_str = ""
                if isinstance(rounded_pay, (int, float)):
                    rounded_pay_str = f"${rounded_pay:.2f}"
                else:
                    rounded_pay_str = f"${rounded_pay}" if rounded_pay else "$0.00"

                # Add totals
                html += f"""
                    <tr class="total-row">
                        <td colspan="3">Total Hours:</td>
                        <td>{total_hours}</td>
                        <td class="text-right">{total_pay_str}</td>
                    </tr>
                    <tr>
                        <td colspan="3">Rounded Pay:</td>
                        <td></td>
                        <td class="text-right">{rounded_pay_str}</td>
                    </tr>
                    </table>

                    <!-- Removed signature line -->
                </div>
                """

            html += """
            </div>
            </body>
            </html>
            """

            return render_template_string(html)
        else:
            return "Invalid report type for printing", 400
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        return f"Error generating print-friendly version: {str(e)}<br><pre>{error_details}</pre>", 500

@app.route('/download/<report_type>')
def download(report_type):
    """Download a report file"""
    try:
        if report_type == 'summary':
            filename = session.get('reports', {}).get('summary', '')
        elif report_type == 'payslips':
            filename = session.get('reports', {}).get('payslips', '')
        elif report_type == 'combined':
            filename = session.get('reports', {}).get('combined', '')
        elif report_type == 'combined_no_sig':
            filename = session.get('reports', {}).get('combined_no_sig', '')
        elif report_type == 'admin':
            filename = session.get('reports', {}).get('admin', '')
        elif report_type == 'payslips_sheet':
            filename = session.get('reports', {}).get('payslips_sheet', '')
        else:
            return "Invalid report type", 400

        if not filename:
            return "No report found", 404

        file_path = os.path.join(REPORT_FOLDER, filename)
        if not os.path.exists(file_path):
            return f"File not found: {filename}", 404

        return send_file(file_path, as_attachment=True)
    except Exception as e:
        return f"Error downloading file: {str(e)}", 500

# Add a new route to display reports
@app.route('/reports')
@login_required
def reports():
    """Display all generated reports grouped by week"""
    # Get username for menu display
    username = session.get('username', 'Unknown')
    menu_html = get_menu_html(username)

    # Check if we have cached report data that's still valid (less than 5 minutes old)
    current_time = datetime.now()
    cache_key = 'all_reports'
    if cache_key in report_cache and report_cache_expiry.get(cache_key, datetime.min) > current_time:
        # Use cached data
        sorted_weeks = report_cache[cache_key]['sorted_weeks']
        reports_by_week = report_cache[cache_key]['reports_by_week']
    else:
        # Existing code for reports preparation - but optimized
        report_files = []

        # Files to exclude from reports display
        excluded_files = [
            'error_report.txt',
            'pandas_report.csv',
            'file_report.txt'  # Also exclude this system file
        ]

        # Get all files in the reports directory - newest first and limited
        try:
            entries = []
            for f in os.listdir(REPORT_FOLDER):
                if not (f.startswith('admin_report_') and f.endswith('.xlsx')):
                    continue
                fp = os.path.join(REPORT_FOLDER, f)
                if not os.path.isfile(fp) or f in excluded_files:
                    continue
                entries.append((f, os.path.getmtime(fp)))
            entries.sort(key=lambda x: x[1], reverse=True)
            all_files = [f for f, _ in entries[:REPORTS_LIST_LIMIT]]
        except Exception:
            all_files = []

        for filename in all_files:
            # Extract week from filename
            week_match = re.search(r'_(\d{4}-\d{2}-\d{2})\.', filename)
            week = week_match.group(1) if week_match else "Unknown"

            # Get file path
            file_path = os.path.join(REPORT_FOLDER, filename)

            # Determine report type and extract title from file if possible (use metadata cache for heavy fields)
            report_type = "Admin Report"
            report_title = None
            total_amount = None
            creator = None

            # Try to extract title and total amount from Excel files - now cached
            if filename.endswith('.xlsx'):
                try:
                    meta = _load_reports_metadata()
                    rec = _ensure_report_metadata(file_path, filename, meta)
                    _save_reports_metadata(meta)
                    creator = rec.get('creator') or 'Unknown'
                    total_amount = rec.get('total_amount')

                    # Title is cheap to read, so we still grab A1
                    from openpyxl import load_workbook
                    wb = load_workbook(file_path, read_only=True, data_only=True)
                    ws = wb.active
                    if 'A1' in ws and ws['A1'].value:
                        report_title = ws['A1'].value
                except Exception as e:
                    # If we can't read the Excel file, just continue without detailed info
                    pass

            # Get file creation time
            creation_time = datetime.fromtimestamp(os.path.getctime(file_path))

            report_files.append({
                'filename': filename,
                'week': week,
                'type': report_type,
                'title': report_title,
                'total_amount': total_amount,
                'creator': creator,
                'created': creation_time,
                'size': os.path.getsize(file_path)
            })

        # Sort by creation time (newest first)
        report_files.sort(key=lambda x: x['created'], reverse=True)

        # Group by week
        reports_by_week = {}
        for report in report_files:
            if report['week'] not in reports_by_week:
                reports_by_week[report['week']] = []
            reports_by_week[report['week']].append(report)

        # Sort weeks chronologically (newest first)
        sorted_weeks = sorted(reports_by_week.keys(), reverse=True)

        # Cache the results for 5 minutes
        report_cache[cache_key] = {
            'sorted_weeks': sorted_weeks,
            'reports_by_week': reports_by_week
        }
        report_cache_expiry[cache_key] = current_time + timedelta(minutes=5)

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Reports</title>
        <style>
            :root{{ --bg:#f5f7fb; --card:#ffffff; --text:#2d3748; --muted:#6c757d; --primary:#4CAF50; --accent:#2196F3; --border:#e6e9f0; }}
            body{{ font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; margin:32px; line-height:1.6; background:var(--bg); color:var(--text); }}
            h1, h2, h3{{ color:var(--text); }}
            table {{
                width: 100%;
                border-collapse: collapse;
                margin: 20px 0;
            }}
            th, td{{ padding:10px; border:1px solid var(--border); text-align:left; }}
            th{{ background-color:#f2f6ff; }}
            tr:nth-child(even){{ background-color:#fafbff; }}
            .menu{{ background:var(--card); padding:14px 16px; margin-bottom:20px; border-radius:12px; border:1px solid var(--border); box-shadow:0 4px 10px rgba(17,24,39,.04); }}
            .menu a{{ margin-right:14px; text-decoration:none; color:#1976d2; font-weight:600; padding:6px 10px; border-radius:8px; }}
            .menu a:hover{{ background:rgba(33,150,243,.08); }}
            .week-section {{ margin-bottom:28px; background:var(--card); border:1px solid var(--border); border-radius:14px; box-shadow:0 8px 18px rgba(17,24,39,.05); padding:12px 14px; }}
            .download-link {{ color:#1976d2; text-decoration:none; }}
            .download-link:hover {{
                text-decoration: underline;
            }}
            .file-size {{ color: var(--muted); font-size: .9em; }}
            .timestamp {{ color: var(--muted); font-size: .9em; }}
            .report-title {{ font-weight:600; }}
            .report-type {{ color: var(--muted); font-size: .9em; }}
            .amount {{
                font-weight: bold;
                color: #28a745;
            }}
            .user-info {{ float:right; font-size:.9em; color: var(--muted); }}
            .creator {{ color: var(--muted); font-style: italic; font-size: .9em; }}
            .flash-container {{
                margin: 10px 0 20px 0;
            }}
            .flash {{
                padding: 10px 12px;
                border-radius: 4px;
                margin-bottom: 8px;
                border: 1px solid #ccc;
                background: #f8f9fa;
            }}
            .flash.success {{
                border-color: #c3e6cb;
                background: #d4edda;
                color: #155724;
            }}
            .flash.warning {{
                border-color: #ffeeba;
                background: #fff3cd;
                color: #856404;
            }}
            .flash.error {{
                border-color: #f5c6cb;
                background: #f8d7da;
                color: #721c24;
            }}
        </style>
    </head>
    <body>
        <h1>Reports <span style="font-size:.6em; color:#6c757d; font-weight:600;">v{APP_VERSION}</span></h1>
        {menu_html}
        {{ flash_block|safe }}
    """

    if not reports_by_week:
        html += """
        <div class="week-section">
            <h2>No reports found</h2>
            <p>No payroll reports have been generated yet. Process a timesheet to create reports.</p>
        </div>
        """
    else:
        # Render a single compact table for all weeks
        html += """
        <table class=\"compact\">
            <tr>
                <th>Week</th>
                <th>Amount</th>
                <th>Created By</th>
                <th>Posting Date</th>
                <th>Actions</th>
            </tr>
        """
        for week in sorted_weeks:
            # Format the week date for display as a range and compute posting date (end-of-week + 1)
            try:
                week_date = datetime.strptime(week, "%Y-%m-%d")
                week_end = week_date + timedelta(days=6)
                week_display = f"{week_date.strftime('%b %d')} – {week_end.strftime('%b %d, %Y')}"
                posting_date_display = (week_end + timedelta(days=1)).strftime('%b %d, %Y')
            except:
                week_display = week
                posting_date_display = ''

            # Pick one entry per week (prefer Admin Report) for concise display
            entries = reports_by_week.get(week, [])
            admin_entry = None
            for e in entries:
                if (e.get('type') or '').lower().startswith('admin'):
                    admin_entry = e
                    break
            if not admin_entry and entries:
                admin_entry = entries[0]

            amount_str = 'N/A'
            creator_str = 'Unknown'
            download_filename = ''
            if admin_entry:
                if admin_entry.get('total_amount') is not None:
                    amount_str = f"${admin_entry['total_amount']:.2f}"
                creator_str = admin_entry.get('creator') or 'Unknown'
                download_filename = admin_entry.get('filename') or ''

            html += f"""
            <tr>
                <td>{week_display}</td>
                <td><span class=\"amount\">{amount_str}</span></td>
                <td><span class=\"creator\">{creator_str}</span></td>
                <td><span class=\"timestamp\">{posting_date_display}</span></td>
                <td>{('<a href="/static/reports/' + download_filename + '" class="download-link" download>Download</a>') if download_filename else ''}</td>
            </tr>
            """

        html += """
        </table>
        """

    html += """
    </body>
    </html>
    """

    # Prepare flash messages block separately to avoid Jinja parsing errors in f-strings
    flashes = get_flashed_messages(with_categories=True)
    if flashes:
        block = '<div class="flash-container">' + ''.join(
            [f'<div class="flash {c}">{m}</div>' for c, m in flashes]
        ) + '</div>'
    else:
        block = ''

    return render_template_string(html, flash_block=block)

# Add a cache clearing function for when new reports are generated
def clear_report_cache():
    """Clear the report cache to ensure fresh data is shown after new reports are created"""
    global report_cache, report_cache_expiry
    report_cache = {}
    report_cache_expiry = {}

# ========== ZOHO BOOKS EXPENSE ACTION ==========
def _auto_push_expense_if_configured(week):
    """Optionally auto-create expense in Zoho Books if env is configured."""
    try:
        auto_flag = os.getenv('ZB_AUTO_PUSH_EXPENSE', 'false').lower() in ('1', 'true', 'yes')
        default_company = os.getenv('ZB_DEFAULT_COMPANY', '').strip()
        if not (auto_flag and default_company):
            return
        reports = session.get('reports', {})
        if 'admin' not in reports:
            return
        admin_file = os.path.join(REPORT_FOLDER, reports['admin'])
        # Determine amount from CSV
        uploaded_file = session.get('uploaded_file')
        amount = None
        try:
            from openpyxl import load_workbook
            if os.path.exists(admin_file):
                wb = load_workbook(admin_file, data_only=True, read_only=True)
                ws = wb.active
                max_rows = min(ws.max_row, 40)
                for r in range(3, max_rows + 1):
                    row_text = ''.join([str(ws.cell(row=r, column=c).value or '') for c in range(1, min(ws.max_column, 20))])
                    if 'GRAND TOTAL' in row_text.upper():
                        for c in range(min(ws.max_column, 20), 1, -1):
                            cell_val = ws.cell(row=r, column=c).value
                            if isinstance(cell_val, (int, float)) and cell_val > 0:
                                amount = float(cell_val)
                                break
                        if amount is not None:
                            break
        except Exception:
            amount = None
        if amount is None and uploaded_file and os.path.exists(uploaded_file):
            df = pd.read_csv(uploaded_file)
            if all(col in df.columns for col in ['Person ID', 'First Name', 'Last Name', 'Date']):
                _, total_pay, _ = compute_grand_totals_for_expense(df)
                amount = round(total_pay, 2)
        if amount is None:
            return
        # Prevent duplicate creation for the same company+week
        existing = _get_existing_expense(default_company, week)
        if existing:
            # If previously stored, ensure it still exists; if not, allow recreation
            if zoho_get_expense(default_company, existing):
                return
            _clear_existing_expense(default_company, week)
        start_str, end_str = compute_week_range_strings(week)
        reference_number = f"PAYROLL-{start_str}_to_{end_str}"
        post_date = compute_expense_date_from_data(week)
        # Auto-notes from summary
        csv_path = session.get('uploaded_file')
        auto_notes = build_admin_summary_text_from_csv(csv_path, start_str, end_str)
        base_desc = f"Weekly payroll expense for {start_str} to {end_str} created by {session.get('username', 'Unknown')}"
        description = _compose_zoho_description(base_desc, auto_notes, '')
        expense_id = zoho_create_expense(
            default_company,
            date_str=post_date,
            amount=amount,
            description=description,
            reference_number=reference_number
        )
        _set_existing_expense(default_company, week, expense_id)
        if os.path.exists(admin_file):
            try:
                zoho_attach_receipt(default_company, expense_id, admin_file)
            except Exception:
                pass
    except Exception:
        # Silent fail; visible UX still shows downloads
        pass
@app.route('/zoho/create_expense', methods=['POST'])
@login_required
def zoho_create_expense_route():
    """Create a Zoho Books expense for the last run and attach the Admin report."""
    try:
        company = request.form.get('company', 'haute')
        week = request.form.get('week', datetime.now().strftime('%Y-%m-%d'))

        # Ensure reports exist in session
        reports = session.get('reports', {})
        if 'admin' not in reports:
            return "Admin report not found in session. Please process payroll first.", 400

        # Prevent duplicate creation for same company+week
        existing = _get_existing_expense(company, week)
        if existing:
            # Validate that the expense still exists in Zoho; if deleted, clear cache and proceed
            exists_remote = zoho_get_expense(company, existing)
            if not exists_remote:
                _clear_existing_expense(company, week)
            else:
                if request.headers.get('X-Requested-With') == 'XMLHttpRequest' or request.form.get('ajax') == '1':
                    return jsonify({'status': 'ok', 'expense_id': existing, 'duplicate': True})
                return f"<script>alert('Expense already exists. ID: {existing}'); history.back();</script>", 200

        # Compute total amount from dataframe stored during processing is not persisted.
        # Re-open the admin report to extract the grand total if possible; otherwise recompute from uploaded CSV.
        amount = None
        try:
            from openpyxl import load_workbook
            admin_path = os.path.join(REPORT_FOLDER, reports['admin'])
            if os.path.exists(admin_path):
                wb = load_workbook(admin_path, data_only=True, read_only=True)
                ws = wb.active
                # Try to locate "GRAND TOTAL" row
                found_amount = None
                max_rows = min(ws.max_row, 40)
                for r in range(3, max_rows + 1):
                    val = ws.cell(row=r, column=9).value  # Column I often has labels in our layout, but we search broadly below
                    # Instead of relying on fixed col, scan row text
                    row_text = ''.join([str(ws.cell(row=r, column=c).value or '') for c in range(1, min(ws.max_column, 20))])
                    if 'GRAND TOTAL' in row_text.upper():
                        # Find rightmost numeric on this row
                        for c in range(min(ws.max_column, 20), 1, -1):
                            cell_val = ws.cell(row=r, column=c).value
                            if isinstance(cell_val, (int, float)) and cell_val > 0:
                                found_amount = float(cell_val)
                                break
                        if found_amount is not None:
                            break
                if found_amount is not None:
                    amount = round(found_amount, 2)
        except Exception:
            amount = None

        # If we couldn't extract, derive from the CSV used
        if amount is None:
            uploaded_file = session.get('uploaded_file')
            if not uploaded_file or not os.path.exists(uploaded_file):
                return "Could not determine amount; CSV missing. Re-run processing.", 400
            df = pd.read_csv(uploaded_file)
            # If not a timesheet, abort
            if not all(col in df.columns for col in ['Person ID', 'First Name', 'Last Name', 'Date']):
                return "Uploaded file is not a timesheet. Cannot compute payroll total.", 400
            _, total_pay, _ = compute_grand_totals_for_expense(df)
            amount = round(total_pay, 2)

        # Create expense with posting date = end-of-week + 1
        start_str, end_str = compute_week_range_strings(week)
        post_date = compute_expense_date_from_data(week)
        # Compose description with automated admin summary + optional notes
        base_desc = f"Weekly payroll expense for {start_str} to {end_str} created by {session.get('username', 'Unknown')}"
        extra_desc = request.form.get('custom_desc', '').strip()
        csv_path = session.get('uploaded_file')
        auto_notes = build_admin_summary_text_from_csv(csv_path, start_str, end_str)
        # Build within Zoho's 500-char limit
        final_desc = _compose_zoho_description(base_desc, auto_notes, extra_desc)

        expense_id = zoho_create_expense(
            company,
            date_str=post_date,
            amount=amount,
            description=final_desc,
            reference_number=f"PAYROLL-{start_str}_to_{end_str}",
            paid_through_account_name=None
        )
        _set_existing_expense(company, week, expense_id)

        # Attach admin report as receipt
        admin_file = os.path.join(REPORT_FOLDER, reports['admin'])
        if os.path.exists(admin_file):
            try:
                zoho_attach_receipt(company, expense_id, admin_file)
            except Exception as e:
                # Don't fail entire request if attachment fails; report message instead
                flash(f"Expense created but failed to attach report: {str(e)}", 'warning')

        # Return a small HTML/JS snippet that shows a confirmation dialog and closes the tab/window
        # If request is AJAX, return JSON so the page stays; otherwise show a minimal page with JS alert
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest' or request.form.get('ajax') == '1':
            return jsonify({'status': 'ok', 'expense_id': expense_id})
        return f"<script>alert('Expense created successfully. ID: {expense_id}'); history.back();</script>", 200
    except Exception as e:
        import traceback
        return f"Error creating Zoho expense: {str(e)}<br><pre>{traceback.format_exc()}</pre>", 500

# Add user management feature
@app.route('/manage_users')
@login_required
def manage_users():
    """Manage system users"""
    # Only admin can manage users
    username = session.get('username', 'Unknown')
    if username != 'admin':
        return redirect(url_for('index'))

    users = load_users()

    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Manage Users</title>
        <style>
            :root{ --bg:#f5f7fb; --card:#ffffff; --text:#2d3748; --muted:#6c757d; --primary:#4CAF50; --danger:#dc3545; --accent:#2196F3; --border:#e6e9f0; }
            body{ font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; margin:32px; line-height:1.6; background:var(--bg); color:var(--text); }
            h1,h2{ color:var(--text); }
            form{ margin:20px 0; }
            .button{ display:inline-block; padding:10px 15px; background:linear-gradient(135deg,var(--primary) 0%, #388e3c 100%); color:#fff; border:none; cursor:pointer; margin-top:10px; border-radius:10px; font-weight:600; box-shadow:0 6px 14px rgba(0,0,0,.08); }
            .delete-button{ display:inline-block; padding:6px 10px; background-color: var(--danger); color:#fff; border:none; cursor:pointer; font-size:.8em; margin-left:10px; border-radius:8px; }
            table{ width:100%; border-collapse:collapse; margin:20px 0; }
            th,td{ padding:10px; border:1px solid var(--border); text-align:left; }
            th{ background:#f2f6ff; }
            tr:nth-child(even){ background:#fafbff; }
            .menu{ background:var(--card); padding:14px 16px; margin-bottom:20px; border-radius:12px; border:1px solid var(--border); box-shadow:0 4px 10px rgba(17,24,39,.04); }
            .menu a{ margin-right:14px; text-decoration:none; color:#1976d2; font-weight:600; padding:6px 10px; border-radius:8px; }
            .menu a:hover{ background:rgba(33,150,243,.08); }
            .user-info{ float:right; font-size:.9em; color:var(--muted); }
            .admin-badge{ display:inline-block; padding:2px 8px; background-color:#007bff; color:#fff; border-radius:10px; font-size:.8em; margin-left:10px; }
        </style>
    </head>
    <body>
        <h1>Manage Users <span style="font-size:.6em; color:#6c757d; font-weight:600;">v{APP_VERSION}</span></h1>

    """ + get_menu_html(username) + """

        <h2>Current Users</h2>
    """

    if users:
        html += """
        <table>
            <tr>
                <th>Username</th>
                <th>Actions</th>
            </tr>
        """

        for username in users:
            is_admin = username == 'admin'
            html += f"""
            <tr>
                <td>{username} {' <span class="admin-badge">Admin</span>' if is_admin else ''}</td>
                <td>
                    {'<em>Cannot delete admin</em>' if is_admin else f'''
                    <form action="/delete_user" method="post" style="margin:0;display:inline;">
                        <input type="hidden" name="username" value="{username}">
                        <button type="submit" class="delete-button" onclick="return confirm('Are you sure you want to delete this user?');">Delete</button>
                    </form>
                    '''}
                </td>
            </tr>
            """

        html += "</table>"
    else:
        html += "<p>No users configured yet.</p>"

    html += """
        <h2>Add New User</h2>
        <form action="/add_user" method="post">
            <div>
                <label for="username">Username:</label>
                <input type="text" id="username" name="username" required>
            </div>
            <div style="margin-top: 10px;">
                <label for="password">Password:</label>
                <input type="password" id="password" name="password" required>
            </div>
            <button type="submit" class="button">Add User</button>
        </form>
    </body>
    </html>
    """

    return render_template_string(html)

@app.route('/add_user', methods=['POST'])
@login_required
def add_user():
    """Add a new user"""
    if session.get('username') != 'admin':
        return "Only admin can add users", 403

    username = request.form.get('username')
    password = request.form.get('password')

    if not username or not password:
        return "Username and password are required", 400

    if len(password) < 4:
        return "Password must be at least 4 characters", 400

    users = load_users()

    if username in users:
        return "Username already exists", 400

    users[username] = password
    save_users(users)

    return redirect(url_for('manage_users'))

@app.route('/delete_user', methods=['POST'])
@login_required
def delete_user():
    """Delete a user"""
    if session.get('username') != 'admin':
        return "Only admin can delete users", 403

    username = request.form.get('username')

    if not username:
        return "Username is required", 400

    # Can't delete admin
    if username == 'admin':
        return "Cannot delete admin user", 403

    users = load_users()

    if username not in users:
        return "User not found", 404

    del users[username]
    save_users(users)

    return redirect(url_for('manage_users'))


@app.route('/fetch_timecard', methods=['GET', 'POST'])
@login_required
def fetch_timecard():
    """Fetch timecard data from the NGTeco system"""
    if request.method == 'GET':
        # Show form to enter credentials and date range
        html = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Fetch Timecard Data</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
                h1 { color: #333; }
                .form-group { margin-bottom: 15px; }
                label { display: inline-block; width: 150px; font-weight: bold; }
                input[type="text"], input[type="password"], input[type="date"] {
                    width: 250px; padding: 8px; border: 1px solid #ddd; border-radius: 4px;
                }
                button {
                    background-color: #4CAF50; color: white; padding: 10px 20px;
                    border: none; border-radius: 4px; cursor: pointer; font-size: 16px;
                }
                button:hover { background-color: #45a049; }
                .info {
                    background-color: #f8f9fa; padding: 15px; border-left: 4px solid #17a2b8;
                    margin-bottom: 20px;
                }
                .warning {
                    background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107;
                    margin-bottom: 20px;
                }
            </style>
        </head>
        <body>
            <h1>Fetch Timecard Data from NGTeco</h1>

            <div class="info">
                <p>This will automatically log into the NGTeco timecard system and download the timecard data for the specified date range.</p>
                <p>The data will be converted to CSV format and processed automatically.</p>
            </div>

                         <div class="info" style="background-color: #e8f5e9; border-left-color: #4CAF50;">
                <p><strong>Choose your method:</strong></p>
            </div>

            <form method="post">
                <div class="form-group">
                    <label for="method">Method:</label>
                    <select id="method" name="method" onchange="toggleMethod()" style="padding: 8px; width: 300px;">
                        <option value="auto">Direct Login (Recommended)</option>
                        <option value="paste">Copy & Paste Table</option>
                    </select>
                </div>

                <div id="auto-section">
                    <div class="info">
                        <p>This will log into NGTeco directly and fetch your timecard data automatically!</p>
                        <p style="color: #f57c00;"><strong>Note:</strong> For PythonAnywhere free accounts, you may need to request whitelisting for office.ngteco.com</p>
                    </div>

                    <div class="form-group">
                        <label for="username">NGTeco Username:</label>
                        <input type="text" id="username" name="username" required>
                    </div>

                    <div class="form-group">
                        <label for="password">NGTeco Password:</label>
                        <input type="password" id="password" name="password" required>
                    </div>

                    <div class="form-group">
                        <label for="start_date">Start Date:</label>
                        <input type="date" id="start_date" name="start_date" required>
                    </div>

                    <div class="form-group">
                        <label for="end_date">End Date:</label>
                        <input type="date" id="end_date" name="end_date" required>
                    </div>
                </div>

                <div id="paste-section" style="display: none;">
                    <div class="info">
                        <ol>
                            <li>Go to your NGTeco timecard page</li>
                            <li>Select your date range</li>
                            <li>Select the entire table</li>
                            <li>Copy (Ctrl+C) and paste below</li>
                        </ol>
                    </div>

                    <div class="form-group">
                        <label for="table_data">Paste Table Data:</label>
                        <textarea id="table_data" name="table_data" rows="20" cols="80"
                                  placeholder="Copy the table from NGTeco and paste it here..."></textarea>
                    </div>
                </div>

                <button type="submit">Process Timecard Data</button>
            </form>

            <script>
                function toggleMethod() {
                    var method = document.getElementById('method').value;
                    var autoSection = document.getElementById('auto-section');
                    var pasteSection = document.getElementById('paste-section');

                    if (method === 'auto') {
                        autoSection.style.display = 'block';
                        pasteSection.style.display = 'none';
                        // Update required attributes
                        document.getElementById('username').required = true;
                        document.getElementById('password').required = true;
                        document.getElementById('start_date').required = true;
                        document.getElementById('end_date').required = true;
                        document.getElementById('table_data').required = false;
                    } else {
                        autoSection.style.display = 'none';
                        pasteSection.style.display = 'block';
                        // Update required attributes
                        document.getElementById('username').required = false;
                        document.getElementById('password').required = false;
                        document.getElementById('start_date').required = false;
                        document.getElementById('end_date').required = false;
                        document.getElementById('table_data').required = true;
                    }
                }
            </script>
        </body>
        </html>
        """
        return render_template_string(html)

    # POST - Process the request
    method = request.form.get('method', 'paste')

    try:
        if method == 'paste':
            # Parse pasted table data
            table_data = request.form.get('table_data', '')
            csv_data = parse_ngteco_table(table_data)
        else:
            # Automated fetch (requires Selenium)
            username = request.form.get('username')
            password = request.form.get('password')
            start_date = request.form.get('start_date')
            end_date = request.form.get('end_date')
            csv_data = fetch_ngteco_automated(username, password, start_date, end_date)

        # Save to a temporary file
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'timecard_auto_{timestamp}.csv'
        file_path = os.path.join(UPLOAD_FOLDER, filename)

        # Write CSV data
        with open(file_path, 'w', newline='', encoding='utf-8') as f:
            f.write(csv_data)

        # Store file path in session
        session['uploaded_file'] = file_path

        # Redirect to validation
        return redirect(url_for('validate'))

    except Exception as e:
        return f"Error processing timecard data: {str(e)}<br>Please check the format and try again.", 500


def parse_ngteco_table(table_data):
    """
    Parse copy-pasted table data from NGTeco into CSV format
    Expected columns: Person Name, Person ID, Date, Timesheet, Clock In, Clock Out, Clock Time(h), etc.
    """
    lines = table_data.strip().split('\n')
    csv_lines = []
    csv_lines.append('Person ID,First Name,Last Name,Date,Timesheet,Clock In,Clock Out,Clock Time(h),Total Break Time(h),Total Work Time(h)')

    for line in lines:
        # Skip empty lines or headers
        if not line.strip() or 'Person Name' in line or 'Clock In' in line:
            continue

        # Split by tabs or multiple spaces
        parts = re.split(r'\t+|\s{2,}', line.strip())

        if len(parts) >= 7:
            try:
                # Extract fields based on your screenshot
                person_name = parts[0]
                person_id = parts[1]
                date = parts[2]
                timesheet = parts[3] if len(parts) > 3 else 'Production TimeSheet'
                clock_in = parts[4] if len(parts) > 4 else ''
                clock_out = parts[5] if len(parts) > 5 else ''
                clock_time = parts[6] if len(parts) > 6 else ''
                break_time = parts[7] if len(parts) > 7 else ''
                work_time = parts[8] if len(parts) > 8 else clock_time

                # Split name into first and last
                name_parts = person_name.split(' ', 1)
                first_name = name_parts[0]
                last_name = name_parts[1] if len(name_parts) > 1 else ''

                                 # Convert date format to YYYY-MM-DD
                try:
                    # Handle DD-MM-YYYY format (common in NGTeco)
                    if '-' in date and len(date.split('-')[0]) == 2:
                        date_obj = datetime.strptime(date, '%d-%m-%Y')
                        date = date_obj.strftime('%Y-%m-%d')
                    # Handle YYYY-MM-DD format (already correct)
                    elif '-' in date and len(date.split('-')[0]) == 4:
                        pass  # Already in correct format
                    # Handle MM/DD/YYYY format
                    elif '/' in date:
                        date_obj = datetime.strptime(date, '%m/%d/%Y')
                        date = date_obj.strftime('%Y-%m-%d')
                except:
                    pass  # Keep original date format if parsing fails

                # Format the CSV line
                csv_line = f'{person_id},{first_name},{last_name},{date},{timesheet},{clock_in},{clock_out},{clock_time},{break_time},{work_time}'
                csv_lines.append(csv_line)

            except Exception as e:
                print(f"Error parsing line: {line} - {str(e)}")
                continue

    return '\n'.join(csv_lines)


def fetch_ngteco_automated(username, password, start_date, end_date):
    """
    Direct fetch using requests library - works on PythonAnywhere!
    """
    import requests
    from bs4 import BeautifulSoup

    # Create a session to maintain cookies
    session = requests.Session()

    # Headers to appear like a real browser
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    }
    session.headers.update(headers)

    try:
        # Step 1: Get login page to obtain any CSRF tokens
        login_url = 'https://office.ngteco.com/login'
        login_page = session.get(login_url)
        soup = BeautifulSoup(login_page.text, 'html.parser')

        # Look for CSRF token (adjust based on actual form)
        csrf_token = None
        csrf_input = soup.find('input', {'name': '_token'}) or soup.find('input', {'name': 'csrf_token'})
        if csrf_input:
            csrf_token = csrf_input.get('value')

        # Step 2: Login
        login_data = {
            'username': username,
            'password': password,
        }
        if csrf_token:
            login_data['_token'] = csrf_token

        # Post login
        login_response = session.post(login_url, data=login_data, allow_redirects=True)

        # Check if login was successful
        if 'dashboard' not in login_response.url and 'timecard' not in login_response.text:
            raise Exception("Login failed. Please check credentials.")

        # Step 3: Navigate to timecard page with date parameters
        timecard_url = f'https://office.ngteco.com/att/timecard/timecard?start_date={start_date}&end_date={end_date}'
        timecard_response = session.get(timecard_url)

        # Step 4: Parse the timecard data
        soup = BeautifulSoup(timecard_response.text, 'html.parser')

        # Try to find the table (adjust selectors based on actual HTML)
        table = soup.find('table', {'class': 'timecard-table'}) or \
                soup.find('table', {'id': 'timecard-table'}) or \
                soup.find('table')

        if not table:
            # If no table found, try to extract data from JSON or other format
            # Check if data is in a script tag
            scripts = soup.find_all('script')
            for script in scripts:
                if 'timecardData' in str(script) or 'tableData' in str(script):
                    # Extract JSON data if present
                    import json
                    import re
                    match = re.search(r'var\s+(?:timecardData|tableData)\s*=\s*(\[.*?\]);', str(script), re.DOTALL)
                    if match:
                        data = json.loads(match.group(1))
                        return convert_json_to_csv(data)

            raise Exception("Could not find timecard table in the response")

        # Parse HTML table
        csv_lines = ['Person ID,First Name,Last Name,Date,Timesheet,Clock In,Clock Out,Clock Time(h),Total Break Time(h),Total Work Time(h)']

        rows = table.find_all('tr')
        for row in rows[1:]:  # Skip header
            cells = row.find_all(['td', 'th'])
            if len(cells) >= 7:
                # Extract text from each cell
                person_name = cells[0].get_text(strip=True)
                person_id = cells[1].get_text(strip=True)
                date = cells[2].get_text(strip=True)
                timesheet = cells[3].get_text(strip=True) if len(cells) > 3 else 'Production TimeSheet'
                clock_in = cells[4].get_text(strip=True) if len(cells) > 4 else ''
                clock_out = cells[5].get_text(strip=True) if len(cells) > 5 else ''
                clock_time = cells[6].get_text(strip=True) if len(cells) > 6 else ''
                break_time = cells[7].get_text(strip=True) if len(cells) > 7 else ''
                work_time = cells[8].get_text(strip=True) if len(cells) > 8 else clock_time

                # Split name
                name_parts = person_name.split(' ', 1)
                first_name = name_parts[0]
                last_name = name_parts[1] if len(name_parts) > 1 else ''

                # Convert date format
                try:
                    if '-' in date and len(date.split('-')[0]) == 2:
                        date_obj = datetime.strptime(date, '%d-%m-%Y')
                        date = date_obj.strftime('%Y-%m-%d')
                except:
                    pass

                csv_lines.append(f'{person_id},{first_name},{last_name},{date},{timesheet},{clock_in},{clock_out},{clock_time},{break_time},{work_time}')

        return '\n'.join(csv_lines)

    except requests.exceptions.RequestException as e:
        raise Exception(f"Network error: {str(e)}")
    except Exception as e:
        raise Exception(f"Error fetching data: {str(e)}")


def convert_json_to_csv(data):
    """Convert JSON data to CSV format"""
    csv_lines = ['Person ID,First Name,Last Name,Date,Timesheet,Clock In,Clock Out,Clock Time(h),Total Break Time(h),Total Work Time(h)']

    for record in data:
        # Adjust field names based on actual JSON structure
        person_name = record.get('employee_name', '')
        person_id = record.get('employee_id', '')
        date = record.get('date', '')
        clock_in = record.get('clock_in', '')
        clock_out = record.get('clock_out', '')
        work_time = record.get('work_hours', '')

        name_parts = person_name.split(' ', 1)
        first_name = name_parts[0]
        last_name = name_parts[1] if len(name_parts) > 1 else ''

        csv_lines.append(f'{person_id},{first_name},{last_name},{date},Production TimeSheet,{clock_in},{clock_out},,{work_time}')

    return '\n'.join(csv_lines)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
