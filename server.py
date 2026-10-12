from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import webbrowser
import zipfile
import xml.etree.ElementTree as ET
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from musicxml_to_midi import convert


APP_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = APP_DIR / "conversions"
OUTPUT_DIR.mkdir(exist_ok=True)
JOBS_DIR = APP_DIR / "travail-temporaire"
JOBS_DIR.mkdir(exist_ok=True)
MAX_UPLOAD = 50 * 1024 * 1024
ALLOWED = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}
HOST, PORT = "127.0.0.1", 8766


def find_audiveris() -> Path:
    roots = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Audiveris",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Audiveris",
    ]
    for root in roots:
        executable = root / "Audiveris.exe"
        if executable.is_file():
            return executable
    raise RuntimeError("Audiveris n'est pas installé dans Program Files.")


def safe_stem(filename: str) -> str:
    stem = Path(filename).stem
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", stem).strip("-")
    return stem[:70] or "partition"


def parse_upload(headers, body: bytes) -> tuple[str, bytes]:
    content_type = headers.get("Content-Type", "")
    envelope = BytesParser(policy=default).parsebytes(
        b"Content-Type: " + content_type.encode("ascii", "ignore") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
    )
    if not envelope.is_multipart():
        raise ValueError("Formulaire d'envoi invalide.")
    for part in envelope.iter_parts():
        if part.get_param("name", header="content-disposition") == "partition":
            filename = part.get_filename() or "partition.pdf"
            return filename, part.get_payload(decode=True) or b""
    raise ValueError("Aucun fichier reçu.")


def score_stats(mxl: Path) -> dict[str, int]:
    with zipfile.ZipFile(mxl) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith(".xml") and not n.startswith("META-INF/")]
        root = ET.fromstring(archive.read(names[0]))
    return {
        "measures": len(root.findall("./part/measure")),
        "recognized_notes": len(root.findall(".//note[pitch]")),
    }


def extract_musicxml(mxl: Path, destination: Path):
    with zipfile.ZipFile(mxl) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith(".xml") and not n.startswith("META-INF/")]
        destination.write_bytes(archive.read(names[0]))


def render_pdf_pages(pdf: Path, base: str) -> list[Path]:
    """Crée des aperçus PNG fiables pour le lecteur, une fois par partition."""
    existing = sorted(OUTPUT_DIR.glob(f"{base}-page-*.png"), key=lambda path: path.name)
    if existing:
        return existing
    renderer = shutil.which("pdftoppm")
    if not renderer:
        bundled = Path(sys.executable).resolve().parents[1] / "native" / "poppler" / "Library" / "bin" / "pdftoppm.exe"
        if bundled.is_file():
            renderer = str(bundled)
    if not renderer:
        return []
    prefix = OUTPUT_DIR / f"{base}-page"
    try:
        subprocess.run(
            [renderer, "-png", "-r", "150", str(pdf), str(prefix)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            timeout=90,
            check=True,
        )
    except (subprocess.SubprocessError, OSError):
        return []
    return sorted(OUTPUT_DIR.glob(f"{base}-page-*.png"), key=lambda path: int(re.search(r"-(\d+)\.png$", path.name).group(1)))


def session_record(base: str) -> dict | None:
    midi = OUTPUT_DIR / f"{base}.mid"
    score = OUTPUT_DIR / f"{base}.musicxml"
    pdf = OUTPUT_DIR / f"{base}.pdf"
    if not (midi.is_file() and score.is_file() and pdf.is_file()):
        return None
    pages = render_pdf_pages(pdf, base)
    return {
        "id": base,
        "name": base.rsplit("-", 2)[0].replace("-", " ").title(),
        "midi_url": "/download?file=" + urllib.parse.quote(midi.name),
        "xml_url": "/download?file=" + urllib.parse.quote(score.name),
        "pdf_url": "/download?file=" + urllib.parse.quote(pdf.name),
        "page_urls": ["/download?file=" + urllib.parse.quote(page.name) for page in pages],
    }


def library_records() -> list[dict]:
    records = []
    for midi in sorted(OUTPUT_DIR.glob("*.mid"), key=lambda p: p.stat().st_mtime, reverse=True):
        record = session_record(midi.stem)
        if record:
            records.append(record)
    return records


def run_conversion(filename: str, payload: bytes) -> dict:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED:
        raise ValueError("Format non pris en charge. Utilisez PDF, PNG, JPG ou TIFF.")
    if not payload:
        raise ValueError("Le fichier est vide.")
    if len(payload) > MAX_UPLOAD:
        raise ValueError("Le fichier dépasse 50 Mo.")

    audiveris = find_audiveris()
    stem = safe_stem(filename)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    with tempfile.TemporaryDirectory(prefix="partition-midi-", dir=JOBS_DIR) as temp_name:
        temp = Path(temp_name)
        source = temp / f"{stem}{suffix}"
        omr_output = temp / "omr"
        omr_output.mkdir()
        java_temp = temp / "java-tmp"
        java_temp.mkdir()
        source.write_bytes(payload)
        command = [
            str(audiveris), "-batch", "-transcribe", "-export",
            "-output", str(omr_output), "--", str(source),
        ]
        environment = os.environ.copy()
        previous_java_options = environment.get("JAVA_TOOL_OPTIONS", "").strip()
        java_option = f"-Djava.io.tmpdir={java_temp}"
        environment["JAVA_TOOL_OPTIONS"] = f"{previous_java_options} {java_option}".strip()
        try:
            subprocess.run(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                env=environment,
                timeout=300,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Audiveris a dépassé la durée maximale de 5 minutes.") from exc

        # Audiveris peut encore finaliser l'export juste après son retour.
        # On attend le fichier avant que TemporaryDirectory ne soit nettoyé.
        deadline = time.monotonic() + 15
        mxl_files: list[Path] = []
        while time.monotonic() < deadline:
            mxl_files = [path for path in omr_output.rglob("*.mxl") if path.stat().st_size > 100]
            if mxl_files:
                time.sleep(0.8)
                break
            time.sleep(0.4)
        if not mxl_files:
            logs = sorted(omr_output.rglob("*.log"), key=lambda p: p.stat().st_mtime)
            detail = logs[-1].read_text(encoding="utf-8", errors="replace")[-1800:] if logs else "Échec de la reconnaissance."
            if "AccessDeniedException" in detail or "BasicClassifier" in detail:
                raise RuntimeError(
                    "Audiveris n'a pas pu écrire ses fichiers temporaires Java. "
                    "Fermez Audiveris, puis relancez la conversion. Si l'erreur persiste, "
                    "réinstallez une version Audiveris stable (5.10.2 ou 5.8.1)."
                )
            raise RuntimeError(detail)
        source_mxl = mxl_files[0]
        midi_name = f"{stem}-{stamp}.mid"
        mxl_name = f"{stem}-{stamp}.mxl"
        pdf_name = f"{stem}-{stamp}.pdf"
        xml_name = f"{stem}-{stamp}.musicxml"
        midi_path = OUTPUT_DIR / midi_name
        mxl_path = OUTPUT_DIR / mxl_name
        pdf_path = OUTPUT_DIR / pdf_name
        xml_path = OUTPUT_DIR / xml_name
        stats = convert(source_mxl, midi_path)
        shutil.copy2(source_mxl, mxl_path)
        if suffix == ".pdf":
            shutil.copy2(source, pdf_path)
            render_pdf_pages(pdf_path, Path(midi_name).stem)
        extract_musicxml(source_mxl, xml_path)
        stats.update(score_stats(source_mxl))
        session = session_record(Path(midi_name).stem) if suffix == ".pdf" else None
        return {
            **stats,
            "midi_name": midi_name,
            "mxl_name": mxl_name,
            "xml_name": xml_name,
            "midi_url": "/download?file=" + urllib.parse.quote(midi_name),
            "mxl_url": "/download?file=" + urllib.parse.quote(mxl_name),
            "xml_url": "/download?file=" + urllib.parse.quote(xml_name),
            "session": session,
        }


class Handler(BaseHTTPRequestHandler):
    server_version = "PartitionMIDI/1.0"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def send_json(self, status: int, value: dict):
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/":
            data = (APP_DIR / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == "/health":
            try:
                find_audiveris()
                self.send_json(200, {"ok": True, "audiveris": True})
            except Exception as exc:
                self.send_json(503, {"ok": False, "error": str(exc)})
            return
        if parsed.path == "/api/library":
            self.send_json(200, {"ok": True, "sessions": library_records()})
            return
        if parsed.path.startswith("/assets/"):
            filename = Path(parsed.path).name
            target = APP_DIR / "assets" / filename
            if not target.is_file():
                self.send_error(404)
                return
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == "/download":
            filename = Path(urllib.parse.parse_qs(parsed.query).get("file", [""])[0]).name
            target = OUTPUT_DIR / filename
            if not filename or not target.is_file():
                self.send_error(404)
                return
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(filename)[0] or "application/octet-stream")
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_error(404)

    def do_POST(self):
        if self.path != "/convert":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_UPLOAD + 1024 * 1024:
                raise ValueError("Taille de fichier invalide.")
            filename, payload = parse_upload(self.headers, self.rfile.read(length))
            result = run_conversion(filename, payload)
            self.send_json(200, {"ok": True, **result})
        except subprocess.TimeoutExpired:
            self.send_json(504, {"ok": False, "error": "La reconnaissance a dépassé 5 minutes."})
        except Exception as exc:
            self.send_json(400, {"ok": False, "error": str(exc)})


def main():
    find_audiveris()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}"
    print(f"Partition vers MIDI est disponible sur {url}")
    print("Fermez cette fenêtre pour arrêter l'application.")
    if os.environ.get("PARTITION_MIDI_NO_BROWSER") != "1":
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
