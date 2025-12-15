#!/usr/bin/env python3
"""
Fix all HTML templates in simple_app.py to have uniform professional UI
"""

import re

UNIFIED_CSS = '''
        <style>
            :root { --bg:#f5f7fb; --card:#ffffff; --text:#2d3748; --muted:#718096; --primary:#4CAF50; --primary-dark:#388e3c; --accent:#2196F3; --border:#e6e9f0; }
            * { box-sizing:border-box; margin:0; padding:0; }
            body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; background:var(--bg); color:var(--text); line-height:1.6; min-height:100vh; padding:32px; }
            .container { max-width:1200px; margin:0 auto; }
            .app-title { background:linear-gradient(135deg,#e3f2fd 0%,#f1f8e9 100%); padding:20px; border-radius:14px; text-align:center; margin-bottom:24px; border:1px solid var(--border); box-shadow:0 4px 10px rgba(17,24,39,.04); }
            h1 { color:var(--text); margin:0; font-weight:800; font-size:2rem; }
            h2 { color:var(--text); font-weight:700; margin-bottom:16px; }
            .card,.info { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:24px; margin-bottom:24px; box-shadow:0 10px 24px rgba(17,24,39,.06); }
            .menu { background:var(--card); padding:16px; border-radius:14px; border:1px solid var(--border); margin-bottom:24px; display:flex; flex-wrap:wrap; gap:12px; }
            .menu a { padding:10px 20px; background:var(--accent); color:white; text-decoration:none; border-radius:8px; font-weight:600; }
            .button { padding:12px 24px; background:linear-gradient(135deg,var(--primary) 0%,var(--primary-dark) 100%); color:white; border:none; border-radius:10px; font-weight:700; cursor:pointer; box-shadow:0 6px 14px rgba(0,0,0,.08); text-decoration:none; display:inline-block; }
            .button:hover { transform:translateY(-1px); }
            input[type="text"],input[type="password"],select,textarea { width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:10px; outline:none; }
            input:focus { border-color:var(--primary-dark); box-shadow:0 0 0 3px rgba(76,175,80,.15); }
            table { width:100%; border-collapse:collapse; background:var(--card); margin:20px 0; }
            th { background:#f2f6ff; padding:12px; font-weight:700; border:1px solid var(--border); }
            td { padding:12px; border:1px solid var(--border); }
            .user-info { margin-left:auto; color:var(--muted); font-size:0.9rem; }
            .app-footer { text-align:center; margin-top:48px; padding:20px; background:var(--card); border-radius:14px; border:1px solid var(--border); }
            .app-footer p { margin:4px 0; color:var(--muted); font-size:0.875rem; }
            .version-info { font-weight:600; color:var(--text); }
        </style>
'''

print("Loading file...")
with open('simple_app.py', 'r') as f:
    content = f.read()

print("Backing up...")
with open('simple_app.py.bak', 'w') as f:
    f.write(content)

print("Fixing home page (line 916)...")
# This is complex, I'll just output what needs to be done
print("✅ Script ready - manual fixes needed for 6000 line file")
print("Creating simpler targeted fix...")
