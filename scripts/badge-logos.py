#!/usr/bin/env python3
# Rebuilds the badges whose simple-icons slug no longer exists, using inline SVG logos.
import base64, re, sys

# Shields ignores logoColor for custom logos, so each glyph carries its own section colour.
LANG, DATA, TOOL = "#FAA968", "#8CBFB8", "#A7C9C6"

def svg(body, fill):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="{fill}">{body}</svg>'

# Four-pane Windows mark.
WINDOWS = '<path d="M2 3.9 10.6 2.7v8.7H2zM11.9 2.5 22 1.1v10.3H11.9zM2 12.6h8.6v8.7L2 20.1zM11.9 12.6H22v10.3l-10.1-1.4z"/>'

# LinkedIn "in".
LINKEDIN = ('<path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM2.4 9.5h5.2V22H2.4z"/>'
            '<path d="M9.5 9.5h5v1.7c.7-1.2 2.2-2.1 4.2-2.1 3.2 0 4.8 2 4.8 5.7V22h-5.2v-6.3c0-1.6-.6-2.7-2-2.7-1.1 0-1.8.7-2.1 1.5-.1.3-.1.7-.1 1.1V22H9.5z"/>')

# Letter C plus a hash, standing in for the C# wordmark.
CSHARP = ('<path d="M9.7 5.6c-3.1 0-5.6 2.9-5.6 6.4s2.5 6.4 5.6 6.4c2 0 3.7-1.2 4.7-3l-2.3-1.4c-.5 1-1.4 1.7-2.4 1.7-1.7 0-3.1-1.6-3.1-3.7s1.4-3.7 3.1-3.7c1 0 1.9.7 2.4 1.7l2.3-1.4c-1-1.8-2.7-3-4.7-3z"/>'
          '<path d="M17.3 8.4h1.5l-.4 2.2h1.9v1.5h-2.2l-.3 1.9h2v1.5h-2.3l-.4 2.2h-1.5l.4-2.2h-1.6l-.4 2.2h-1.5l.4-2.2h-1.3v-1.5h1.6l.3-1.9h-1.5v-1.5h1.8l.4-2.2h1.5l-.4 2.2h1.6zm-1.7 3.7-.3 1.9h1.6l.3-1.9z"/>')

# Generic database cylinder for SQL Server.
SQLSERVER = ('<ellipse cx="12" cy="5.4" rx="8" ry="3.1"/>'
             '<path d="M4 8.6c0 1.7 3.6 3.1 8 3.1s8-1.4 8-3.1v3.4c0 1.7-3.6 3.1-8 3.1s-8-1.4-8-3.1z"/>'
             '<path d="M4 15c0 1.7 3.6 3.1 8 3.1s8-1.4 8-3.1v3.5c0 1.7-3.6 3.1-8 3.1s-8-1.4-8-3.1z"/>')

# VS Code fold mark.
VSCODE = '<path d="M19.4 1.7 12 8.5 7.3 4.9 5 6.1l4.4 5.9L5 17.9l2.3 1.2L12 15.5l7.4 6.8L22 21V3z"/>'

# Visual Studio infinity mark. A second fold shape here would mirror the VS Code glyph and read as
# the same product, so use the ribbon instead.
VSTUDIO = ('<path d="M6.6 7.6c-2.6 0-4.8 2-4.8 4.4s2.2 4.4 4.8 4.4c1.7 0 3-.9 4-2l1.4-1.6 1.4 1.6c1.1 1.1 2.3 2 4 2 '
           '2.6 0 4.8-2 4.8-4.4s-2.2-4.4-4.8-4.4c-1.7 0-3 .9-4 2L12 11.2l-1.4-1.6c-1.1-1.1-2.3-2-4-2zm0 2.6c.9 0 '
           '1.6.5 2.4 1.3l.5.5-.5.5c-.8.8-1.5 1.3-2.4 1.3-1.2 0-2.2-.8-2.2-1.8s1-1.8 2.2-1.8zm10.8 0c1.2 0 2.2.8 '
           '2.2 1.8s-1 1.8-2.2 1.8c-.9 0-1.6-.5-2.4-1.3l-.5-.5.5-.5c.8-.8 1.5-1.3 2.4-1.3z"/>')

LOGOS = {
    "C%23": (CSHARP, LANG),
    "LinkedIn": (LINKEDIN, LANG),
    "SQL_Server": (SQLSERVER, DATA),
    "Windows": (WINDOWS, TOOL),
    "Visual_Studio": (VSTUDIO, TOOL),
    "VS_Code": (VSCODE, TOOL),
}

def data_uri(body, fill):
    b64 = base64.b64encode(svg(body, fill).encode()).decode()
    # "+" would decode as a space inside a query string.
    return "data:image/svg+xml;base64," + b64.replace("+", "%2B")

path = sys.argv[1]
s = open(path, encoding="utf-8").read()
changed = []
for label, (body, fill) in LOGOS.items():
    # Replace only the logo parameter of that specific badge, leaving colours and links intact.
    pat = re.compile(r"(img\.shields\.io/badge/" + re.escape(label) + r"-[^)\"]*?)logo=[^&)\"]+")
    s, n = pat.subn(lambda m: m.group(1) + "logo=" + data_uri(body, fill), s)
    if n:
        changed.append(f"{label} x{n}")
open(path, "w", encoding="utf-8").write(s)
print("rewrote:", ", ".join(changed))
