#!/usr/bin/env python3
"""Exporta o canvas HS Consórcios (arquivos .dc.html) para um site estático: um index.html autossuficiente.

uso: python3 build.py <pasta project/> <pasta assets/> <runtime.js> <saida/>
"""
import base64, html, json, os, re, sys

PROJ, ASSETS, RUNTIME, OUT = sys.argv[1:5]
VOID = {'img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'area', 'col', 'embed', 'wbr'}
TAG = re.compile(r'<!--.*?-->|<(/?)([A-Za-z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|\'[^\']*\'))?)*)\s*(/?)>', re.S)
ATTR = re.compile(r'([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|\'([^\']*)\'))?')

BLOBS = {
    '/_blob/7bf45817e73082851c45af345a6d285f': ('logo_red_two.png', 'image/png'),
    '/_blob/20f3e71fa499e2c71d573bc3e9895b66': ('logo_pix.png', 'image/png'),
    '/_blob/4fc858ff064d53d25e30f9ab85f97b8a': ('inter-latin-wght-normal.woff2', 'font/woff2'),
}
def data_uri(fn, mime):
    with open(os.path.join(ASSETS, fn), 'rb') as f:
        return 'data:%s;base64,%s' % (mime, base64.b64encode(f.read()).decode())
URIS = {k: data_uri(*v) for k, v in BLOBS.items()}
def inline_blobs(s):
    for k, v in URIS.items():
        s = s.replace(k, v)
    return s

def parse(markup):
    root = {'t': '#root', 'a': [], 'c': []}
    stack = [root]
    pos = 0
    def text(t):
        if t:
            stack[-1]['c'].append(html.unescape(t))
    for m in TAG.finditer(markup):
        text(markup[pos:m.start()])
        pos = m.end()
        if m.group(0).startswith('<!--'):
            continue
        close, name, attrs, selfclose = m.group(1), m.group(2), m.group(3), m.group(4)
        if close:
            while len(stack) > 1:
                node = stack.pop()
                if node['t'] == name:
                    break
            continue
        a = []
        for am in ATTR.finditer(attrs or ''):
            val = am.group(2) if am.group(2) is not None else (am.group(3) if am.group(3) is not None else '')
            a.append([am.group(1), html.unescape(val)])
        node = {'t': name, 'a': a, 'c': []}
        stack[-1]['c'].append(node)
        if name.lower() in VOID or selfclose:
            continue
        if name in ('style', 'script'):  # conteúdo bruto
            end = markup.find('</%s>' % name, pos)
            node['c'].append(markup[pos:end])
            pos = end + len('</%s>' % name)
            continue
        stack.append(node)
    text(markup[pos:])
    return root['c']

def strip_ws(nodes):
    out = []
    for n in nodes:
        if isinstance(n, str):
            if n.strip() == '':
                n = ' '
            out.append(n)
        else:
            if n['t'] not in ('style', 'script'):
                n['c'] = strip_ws(n['c'])
            out.append(n)
    return out

screens = {}
for fn in sorted(os.listdir(PROJ)):
    if not fn.endswith('.dc.html'):
        continue
    name = fn[:-len('.dc.html')]
    src = inline_blobs(open(os.path.join(PROJ, fn), encoding='utf-8').read())
    title = html.unescape(re.search(r'<title>(.*?)</title>', src, re.S).group(1).strip())
    body = re.search(r'<x-dc>(.*)</x-dc>', src, re.S).group(1)
    body = re.sub(r'<helmet>.*?</helmet>', '', body, flags=re.S)
    sm = re.search(r"<script type=\"text/x-dc\" data-dc-script data-props='([^']*)'>(.*?)</script>", src, re.S)
    props = json.loads(html.unescape(sm.group(1)))
    defaults = {k: v['default'] for k, v in props.items() if not k.startswith('$') and isinstance(v, dict) and 'default' in v}
    screens[name] = {'title': title, 'ast': strip_ws(parse(body)), 'src': sm.group(2), 'defaults': defaults}

css_files = ['ds/hervalhubdesignsystem-324f1f/tokens/colors.css', 'ds/hervalhubdesignsystem-324f1f/tokens/typography.css',
             'ds/hervalhubdesignsystem-324f1f/tokens/spacing.css', 'ds/hervalhubdesignsystem-324f1f/base.css',
             'ds/hervalhubdesignsystem-324f1f/components/components.css', 'hs-theme.css']
css = '\n'.join(open(os.path.join(PROJ, f), encoding='utf-8').read() for f in css_files)
css = ('@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url(%s) format("woff2")}\n'
       'body{margin:0}\n' % URIS['/_blob/4fc858ff064d53d25e30f9ab85f97b8a']) + css

data = json.dumps(screens, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
runtime = open(RUNTIME, encoding='utf-8').read()
page = '''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HS Consórcios · Portal web</title>
<link rel="icon" href="%s">
<style>
%s
</style>
</head>
<body>
<div id="app"></div>
<noscript>Este protótipo precisa de JavaScript.</noscript>
<script>window.__HS_START = "Main"; window.__HS_SCREENS = %s;</script>
<script>
%s
</script>
</body>
</html>
''' % (URIS['/_blob/7bf45817e73082851c45af345a6d285f'], css, data, runtime)
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8') as f:
    f.write(page)
print('screens:', ', '.join(screens), '| bytes:', len(page.encode()))
