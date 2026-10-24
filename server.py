"""Optional local static preview. GitHub Pages needs no Python server."""
import functools
import os
from pathlib import Path
import socket
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.musicxml': 'application/xml'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

class Server(ThreadingHTTPServer):
    allow_reuse_address = False
    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

if __name__ == '__main__':
    for port in range(8776, 8796):
        try:
            server = Server(('127.0.0.1', port), functools.partial(Handler, directory=str(ROOT)))
            break
        except OSError:
            continue
    else:
        raise SystemExit('Aucun port local disponible entre 8776 et 8795.')
    url=f'http://127.0.0.1:{port}/'
    print(f'Lecteur MusicXML v28 : {url}', flush=True)
    print('Fermez cette fenetre pour arreter le lecteur local.', flush=True)
    if os.environ.get('PARTITION_MIDI_NO_BROWSER') != '1':
        threading.Timer(.5, lambda: webbrowser.open(url)).start()
    server.serve_forever()
