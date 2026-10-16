#!/usr/bin/env python3
"""DUSKHOLD preview server: the repo as a static site, never cached.

`python3 -m http.server` sends Last-Modified and no Cache-Control, so a
browser may keep serving an old module from its heuristic cache after the
code changed (playtest 2026-10-17: "tidak ada perubahan" — the build on the
screen was not the build in the branch). This server sends
`Cache-Control: no-store` on every response, and `Clear-Site-Data: "cache"`
on every page load, which also drops what an older server left in the
browser's HTTP cache. Saves (localStorage) are not touched: only "cache".

Usage: python3 tools/devserver.py [port] [bind]   (default 8000 0.0.0.0)
"""
import http.server
import os
import socketserver
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.json': 'application/json',
        '.webmanifest': 'application/manifest+json',
        '.glb': 'model/gltf-binary',
        '.gltf': 'model/gltf+json',
        '.bin': 'application/octet-stream',
        '.wasm': 'application/wasm',
        '.woff2': 'font/woff2',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        path = self.path.split('?', 1)[0]
        if path.endswith('/') or path.endswith('.html'):
            self.send_header('Clear-Site-Data', '"cache"')
        super().end_headers()

    def log_message(self, fmt, *args):  # quiet: one line per error only
        if len(args) > 1 and str(args[1]).startswith(('4', '5')):
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    bind = sys.argv[2] if len(sys.argv) > 2 else '0.0.0.0'
    with Server((bind, port), NoStoreHandler) as httpd:
        print(f'DUSKHOLD preview on http://{bind}:{port}/ (no-store)', flush=True)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
