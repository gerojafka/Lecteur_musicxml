from __future__ import annotations

import argparse
import struct
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

TPQ = 480
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def variable_length(value: int) -> bytes:
    out = [value & 0x7F]
    value >>= 7
    while value:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(out))


def chunk(kind: bytes, payload: bytes) -> bytes:
    return kind + struct.pack(">I", len(payload)) + payload


def read_musicxml(filename: Path) -> ET.Element:
    if filename.suffix.lower() == ".mxl":
        with zipfile.ZipFile(filename) as archive:
            candidates = [
                name for name in archive.namelist()
                if name.lower().endswith(".xml") and not name.startswith("META-INF/")
            ]
            if not candidates:
                raise ValueError("Aucun fichier MusicXML trouvé dans le MXL")
            return ET.fromstring(archive.read(candidates[0]))
    return ET.parse(filename).getroot()


def midi_pitch(note: ET.Element) -> int | None:
    pitch = note.find("pitch")
    if pitch is None:
        return None
    step = pitch.findtext("step")
    octave = pitch.findtext("octave")
    if step not in STEP or octave is None:
        return None
    alter = int(float(pitch.findtext("alter", "0")))
    return 12 * (int(octave) + 1) + STEP[step] + alter


def build_track(events: list[tuple[int, int, bytes]], name: str) -> bytes:
    ordered = [(0, -2, b"\xFF\x03" + bytes([len(name.encode())]) + name.encode())]
    ordered += events
    ordered.sort(key=lambda item: (item[0], item[1]))
    data = bytearray()
    previous = 0
    for tick, _priority, message in ordered:
        data += variable_length(max(0, tick - previous)) + message
        previous = tick
    data += b"\x00\xFF\x2F\x00"
    return chunk(b"MTrk", bytes(data))


def validate_midi(data: bytes) -> dict[str, int]:
    if data[:4] != b"MThd" or len(data) < 14:
        raise ValueError("En-tête MIDI invalide")
    header_length = struct.unpack(">I", data[4:8])[0]
    _format, track_count, division = struct.unpack(">HHH", data[8:14])
    position = 8 + header_length
    note_ons = 0
    parsed_tracks = 0
    while position < len(data):
        if data[position:position + 4] != b"MTrk":
            raise ValueError("Bloc de piste MIDI manquant")
        length = struct.unpack(">I", data[position + 4:position + 8])[0]
        payload = data[position + 8:position + 8 + length]
        if len(payload) != length:
            raise ValueError("Piste MIDI tronquée")
        cursor = 0
        while cursor < len(payload):
            while True:
                byte = payload[cursor]
                cursor += 1
                if not byte & 0x80:
                    break
            status = payload[cursor]
            cursor += 1
            if status == 0xFF:
                cursor += 1
                size = 0
                while True:
                    byte = payload[cursor]
                    cursor += 1
                    size = (size << 7) | (byte & 0x7F)
                    if not byte & 0x80:
                        break
                cursor += size
            elif status & 0xF0 in (0xC0, 0xD0):
                cursor += 1
            elif 0x80 <= status <= 0xEF:
                if status & 0xF0 == 0x90 and payload[cursor + 1] > 0:
                    note_ons += 1
                cursor += 2
            else:
                raise ValueError(f"Événement MIDI inconnu: {status:#x}")
        parsed_tracks += 1
        position += 8 + length
    if position != len(data) or parsed_tracks != track_count or division != TPQ:
        raise ValueError("Structure MIDI incohérente")
    return {"tracks": parsed_tracks, "note_ons": note_ons, "division": division}


def convert(source: Path, destination: Path, fallback_tempo: int = 160) -> dict[str, int]:
    root = read_musicxml(source)
    parts = root.findall("part")
    if not parts:
        raise ValueError("Aucune partie musicale trouvée")

    staff_events: dict[int, list[tuple[int, int, bytes]]] = defaultdict(list)
    divisions = 1
    beats, beat_type = 4, 4
    measure_start = 0
    tempo = fallback_tempo
    tie_starts: dict[tuple[int, int, str], tuple[int, int]] = {}
    note_count = 0
    last_tick = 0

    # The recognized score contains one piano part with two staves.
    for measure in parts[0].findall("measure"):
        cursor = 0
        last_note_start = 0
        attributes = measure.find("attributes")
        if attributes is not None:
            divisions = int(attributes.findtext("divisions", str(divisions)))
            time = attributes.find("time")
            if time is not None:
                beats = int(time.findtext("beats", str(beats)))
                beat_type = int(time.findtext("beat-type", str(beat_type)))
        measure_units = round(beats * divisions * 4 / beat_type)
        measure_ticks = round(measure_units * TPQ / divisions)

        for sound in measure.findall(".//sound"):
            if sound.get("tempo"):
                tempo = round(float(sound.get("tempo")))

        for element in list(measure):
            tag = element.tag.split("}")[-1]
            if tag == "backup":
                cursor -= int(element.findtext("duration", "0"))
                continue
            if tag == "forward":
                cursor += int(element.findtext("duration", "0"))
                continue
            if tag != "note":
                continue
            duration = int(element.findtext("duration", "0"))
            chord = element.find("chord") is not None
            start_units = last_note_start if chord else cursor
            if not chord:
                last_note_start = cursor
                cursor += duration
            pitch = midi_pitch(element)
            if pitch is None or duration <= 0:
                continue
            staff = int(element.findtext("staff", "1"))
            voice = element.findtext("voice", "1")
            start = measure_start + round(start_units * TPQ / divisions)
            # Audiveris occasionally mistakes a ledger line for an augmentation
            # dot. Do not let an isolated note overflow the notated bar.
            end = min(start + round(duration * TPQ / divisions), measure_start + measure_ticks)
            key = (staff, pitch, voice)
            ties = {item.get("type") for item in element.findall("tie")}
            if "stop" in ties and key in tie_starts:
                tie_start, velocity = tie_starts.pop(key)
                if "start" in ties:
                    tie_starts[key] = (tie_start, velocity)
                else:
                    staff_events[staff].append((tie_start, 1, bytes([0x90, pitch, velocity])))
                    staff_events[staff].append((end, 0, bytes([0x80, pitch, 0])))
                    note_count += 1
            elif "start" in ties:
                tie_starts[key] = (start, 78)
            else:
                staff_events[staff].append((start, 1, bytes([0x90, pitch, 78])))
                staff_events[staff].append((end, 0, bytes([0x80, pitch, 0])))
                note_count += 1
            last_tick = max(last_tick, end)

        measure_start += measure_ticks

    for (staff, pitch, _voice), (start, velocity) in tie_starts.items():
        staff_events[staff].append((start, 1, bytes([0x90, pitch, velocity])))
        staff_events[staff].append((last_tick, 0, bytes([0x80, pitch, 0])))
        note_count += 1

    tempo_us = round(60_000_000 / tempo)
    tempo_payload = bytearray()
    title = b"Gravity Falls"
    tempo_payload += b"\x00\xFF\x03" + bytes([len(title)]) + title
    tempo_payload += b"\x00\xFF\x51\x03" + tempo_us.to_bytes(3, "big")
    tempo_payload += b"\x00\xFF\x58\x04\x04\x02\x18\x08"
    tempo_payload += b"\x00\xFF\x59\x02\xFF\x00"  # F major / D minor: one flat.
    tempo_payload += b"\x00\xFF\x2F\x00"

    tracks = [chunk(b"MTrk", bytes(tempo_payload))]
    for staff in sorted(staff_events):
        name = "Piano - main droite" if staff == 1 else "Piano - main gauche"
        program = [(0, -1, bytes([0xC0, 0]))]
        tracks.append(build_track(program + staff_events[staff], name))

    header = chunk(b"MThd", struct.pack(">HHH", 1, len(tracks), TPQ))
    destination.parent.mkdir(parents=True, exist_ok=True)
    midi_data = header + b"".join(tracks)
    verification = validate_midi(midi_data)
    destination.write_bytes(midi_data)
    return {
        "tracks": verification["tracks"],
        "notes": verification["note_ons"],
        "tempo": tempo,
        "ticks": last_tick,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    print(convert(args.source, args.destination))
