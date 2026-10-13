"""Prints the API's OpenAPI schema as JSON; the web client generates its types from it.

Usage: .venv/bin/python scripts/openapi.py > openapi.json
"""

import json
import os
import sys

# Settings require a secret key, though building the schema signs nothing.
os.environ.setdefault("THULE_SECRET_KEY", "openapi-schema-only")

from app.main import create_app  # noqa: E402

json.dump(create_app().openapi(), sys.stdout, indent=2, ensure_ascii=False)
sys.stdout.write("\n")
