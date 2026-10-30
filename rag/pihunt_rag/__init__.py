"""pihunt_rag package init.

sys.path hardening (do this before anything heavy is imported)
--------------------------------------------------------------
Both entrypoints run this package as ``python -m pihunt_rag.cli`` (the CLI
wrapper on PATH and the Node MCP server's spawnSync). CPython, when invoked
with ``-m``, prepends the *launch directory* to ``sys.path[0]``. The package
is resolved from ``PYTHONPATH`` (the repo's ``rag/`` dir), so that implicit
cwd entry is never needed here — but it is actively dangerous: any stray
module sitting in the launch cwd shadows the stdlib / a dependency.

Concretely, a leftover ``inspect.py`` in the cwd gets imported instead of the
stdlib ``inspect`` deep inside ``model2vec``'s import chain
(model2vec -> joblib -> cloudpickle -> dataclasses -> inspect). The stray
module raises at import time, the embedder's broad ``except`` swallows it, and
query embeddings silently fall back to hashed-ngram — a *different vector
space* than the model2vec index on disk, so semantic search returns garbage.

Stripping the implicit cwd entries from ``sys.path`` as the very first thing
this package does (equivalent to Python's own ``-P`` / ``PYTHONSAFEPATH``)
makes the RAG immune to whatever directory it happens to be launched from.
PYTHONPATH and site-packages are absolute paths and are preserved.
"""
from __future__ import annotations

import os as _os
import sys as _sys

_cwd = _os.getcwd()
_sys.path[:] = [p for p in _sys.path if p not in ("", ".", _cwd)]

del _os, _sys, _cwd
