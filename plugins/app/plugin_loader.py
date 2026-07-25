import importlib
import inspect
import pkgutil
from typing import List

from . import plugins as plugins_pkg
from .plugin_base import Plugin


def _discover_plugin_classes() -> dict:
    classes = {}
    for _, module_name, _ in pkgutil.iter_modules(plugins_pkg.__path__):
        module = importlib.import_module(f"{plugins_pkg.__name__}.{module_name}")
        for _, obj in inspect.getmembers(module, inspect.isclass):
            if issubclass(obj, Plugin) and obj is not Plugin:
                classes[obj.name] = obj
    return classes


_PLUGIN_CLASSES = _discover_plugin_classes()


def build_plugins(configs: List[dict]) -> List[Plugin]:
    """Turns a session's plugin configs (as fetched from the web app --
    [{key, enabled, settings}, ...]) into instantiated, enabled Plugin
    objects, sorted by priority (ascending, so lower runs first).
    """
    instances = []
    for entry in configs:
        if not entry.get("enabled"):
            continue
        cls = _PLUGIN_CLASSES.get(entry.get("key"))
        if not cls:
            continue
        instances.append(cls(entry.get("settings") or {}))

    instances.sort(key=lambda p: p.priority)
    return instances
