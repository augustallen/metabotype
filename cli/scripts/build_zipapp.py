"""Build a portable standard-library-only executable, including the curriculum."""
from pathlib import Path
import shutil
import tempfile
import zipapp

root = Path(__file__).resolve().parents[1]
destination = root / "dist/metabotype.pyz"
destination.parent.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as staging:
    stage = Path(staging)
    shutil.copytree(root / "src/metabotype", stage / "metabotype", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    shutil.copy2(root / "LICENSE", stage / "LICENSE")
    (stage / "__main__.py").write_text("from metabotype.cli import main\nraise SystemExit(main())\n")
    zipapp.create_archive(stage, destination, interpreter="/usr/bin/env python3", compressed=True)
print(destination)
