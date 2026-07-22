from __future__ import annotations
from typing import TYPE_CHECKING
import importlib

if TYPE_CHECKING:
    from pkg import models


def load():
    return importlib.import_module("pkg.plugins")
