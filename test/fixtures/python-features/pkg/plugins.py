import importlib


def dynamic(name):
    return importlib.import_module(name)
