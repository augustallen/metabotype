"""Command line entry point. The game itself never needs network access."""
import argparse
import json
import os
import sqlite3
import sys

from . import __version__
from .content import Content
from .storage import Storage


def main(argv=None):
    parser = argparse.ArgumentParser(description="Metabotype: small molecules, steady fingers.")
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--data-dir", help="Directory for local history")
    parser.add_argument("--no-color", action="store_true", help="Use a monochrome terminal interface")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("validate-content", help="Check the bundled offline curriculum")
    export = sub.add_parser("export", help="Export history to two CSV files")
    export.add_argument("directory", help="Destination directory (existing files are never replaced)")
    sub.add_parser("stats", help="Print typing summary as JSON")
    args = parser.parse_args(argv)
    store = None
    try:
        content = Content()
        if args.command == "validate-content":
            print(f"Content valid: {len(content.topics)} topics, {len(content.passages)} passages, {len(content.questions)} questions.")
            print("Structural validation passed. Scientific correctness and difficulty also need human review.")
            return 0
        if args.command is None and (not sys.stdin.isatty() or not sys.stdout.isatty() or os.environ.get("TERM", "dumb") == "dumb"):
            print("Run Metabotype in an interactive terminal (80 x 24 or larger). Try --help for offline commands.", file=sys.stderr)
            return 2
        store = Storage(args.data_dir)
        if args.command == "export":
            for path in store.export(args.directory):
                print(path)
        elif args.command == "stats":
            print(json.dumps(store.summary(), indent=2))
        else:
            import curses
            from .ui.app import run
            try:
                # Bracketed paste is a terminal capability, not a speed heuristic.
                sys.stdout.write("\x1b[?2004h")
                sys.stdout.flush()
                curses.wrapper(run, content, store, args.no_color or "NO_COLOR" in os.environ)
            except curses.error as exc:
                print(f"Terminal initialization failed: {exc}", file=sys.stderr)
                return 2
            finally:
                sys.stdout.write("\x1b[?2004l")
                sys.stdout.flush()
        return 0
    except KeyboardInterrupt:
        return 130
    except (OSError, RuntimeError, ValueError, sqlite3.Error) as exc:
        print(f"Metabotype: {exc}", file=sys.stderr)
        return 1
    finally:
        if store:
            store.close()
