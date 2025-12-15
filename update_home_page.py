#!/usr/bin/env python3
"""
Update home page in simple_app.py with enterprise Tailwind CSS design
"""

# Read the HTML template
with open('home_page_enterprise.html', 'r') as f:
    html_content = f.read()

# First, escape all curly braces for f-string (double them)
html_escaped = ""
i = 0
while i < len(html_content):
    char = html_content[i]
    if char == '{':
        html_escaped += '{{'
    elif char == '}':
        html_escaped += '}}'
    else:
        html_escaped += char
    i += 1

# Now replace the placeholders that should be Python variables (un-escape them)
# These are the only dynamic parts we need

# 1. Username
html_escaped = html_escaped.replace('{{username}}', '{username}')

# 2. Version
html_escaped = html_escaped.replace('v{{get_version()}}', 'v{get_version()}')

# 3. Admin menu - this is complex, so let's define it separately
admin_menu_html = """{'<a href="/manage_users" class="flex items-center space-x-3 px-3 py-2.5 text-sm font-medium rounded-lg text-secondary hover:bg-gray-100 hover:text-textDark transition-colors"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg><span>Manage Users</span></a>' if is_admin else ''}"""

html_escaped = html_escaped.replace('{{admin_menu}}', admin_menu_html)

# Read simple_app.py
with open('simple_app.py', 'r') as f:
    app_content = f.read()

# Find the index() function and replace its HTML
# Start: line with "html = f\"\"\""
# End: line with "return render_template_string(html)"

start_marker = '    html = f"""'
end_marker = '    """\n    return render_template_string(html)'

start_pos = app_content.find(start_marker, app_content.find('@app.route(\'/\')\n@login_required\ndef index():'))
if start_pos == -1:
    print("ERROR: Could not find start marker")
    exit(1)

# Find the corresponding end (the """ before return statement for index function)
# Look for the next @app.route which will be /manage_rates
next_route_pos = app_content.find('@app.route(\'/manage_rates\')', start_pos)
end_pos = app_content.rfind('return render_template_string(html)', start_pos, next_route_pos)

if end_pos == -1:
    print("ERROR: Could not find end marker")
    exit(1)

# Find the """ before the return statement
end_pos = app_content.rfind('"""', start_pos, end_pos)

if end_pos == -1:
    print("ERROR: Could not find closing triple quotes")
    exit(1)

# Construct new content
new_app_content = (
    app_content[:start_pos] +
    f'    html = f"""\n{html_escaped}\n    """\n    return render_template_string(html)\n\n' +
    app_content[next_route_pos:]
)

# Write back
with open('simple_app.py', 'w') as f:
    f.write(new_app_content)

print("✅ Successfully updated home page with enterprise UI")
print("✅ All curly braces escaped for f-string compatibility")
print("✅ Dynamic variables: {username}, {get_version()}, admin menu")




