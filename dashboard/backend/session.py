"""Window control for the kiosk display.

A web page cannot minimise or close the window it is running in -- `window.close()`
is refused for anything the script did not open itself, which is exactly the kiosk
case. So the page asks the local server, and the server talks to the window
manager on its behalf.

On Windows this is done with plain ctypes against user32: find the top-level
window whose title matches the dashboard, then either minimise it or post
WM_CLOSE. Posting WM_CLOSE lets the browser shut down cleanly -- no killed
process, no "restore pages?" bar on the next launch.

Everywhere else these are honest no-ops that report themselves as unsupported,
so the buttons can be hidden rather than failing silently.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import threading
from dataclasses import dataclass

log = logging.getLogger(__name__)

WINDOW_TITLE_HINT = "Engineering Team Dashboard"

_SW_MINIMIZE = 6
_WM_CLOSE = 0x0010


@dataclass(frozen=True)
class ActionResult:
    ok: bool
    detail: str


def is_supported() -> bool:
    """True when this platform can actually drive the display window."""
    return sys.platform == "win32"


def platform_name() -> str:
    return sys.platform


# --------------------------------------------------------------------------- #
# Windows window handling
# --------------------------------------------------------------------------- #
def _find_windows() -> list[int]:
    """Every visible top-level window whose title mentions the dashboard."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    matches: list[int] = []

    enum_proc = ctypes.WINFUNCTYPE(
        wintypes.BOOL, wintypes.HWND, wintypes.LPARAM
    )

    def callback(hwnd: int, _param: int) -> bool:
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        if WINDOW_TITLE_HINT.lower() in buffer.value.lower():
            matches.append(hwnd)
        return True

    user32.EnumWindows(enum_proc(callback), 0)
    return matches


def minimize_display() -> ActionResult:
    if not is_supported():
        return ActionResult(False, f"not supported on {platform_name()}")
    try:
        import ctypes

        user32 = ctypes.WinDLL("user32", use_last_error=True)
        windows = _find_windows()
        if not windows:
            return ActionResult(False, "display window not found")
        for hwnd in windows:
            user32.ShowWindow(hwnd, _SW_MINIMIZE)
        return ActionResult(True, f"minimised {len(windows)} window(s)")
    except Exception as exc:
        log.exception("minimise failed")
        return ActionResult(False, exc.__class__.__name__)


def close_display() -> ActionResult:
    """Ask the kiosk window to close itself. The server keeps running."""
    if not is_supported():
        return ActionResult(False, f"not supported on {platform_name()}")
    try:
        import ctypes

        user32 = ctypes.WinDLL("user32", use_last_error=True)
        windows = _find_windows()
        if not windows:
            return ActionResult(False, "display window not found")
        for hwnd in windows:
            # PostMessage, not TerminateProcess: the browser exits cleanly and
            # does not offer to restore the session next time.
            user32.PostMessageW(hwnd, _WM_CLOSE, 0, 0)
        return ActionResult(True, f"closed {len(windows)} window(s)")
    except Exception as exc:
        log.exception("close failed")
        return ActionResult(False, exc.__class__.__name__)


def stop_server(delay: float = 0.6) -> ActionResult:
    """Stop this process shortly, leaving time for the HTTP reply to be sent."""

    def shutdown() -> None:
        log.info("shutdown requested from the display")
        os.kill(os.getpid(), signal.SIGTERM)

    timer = threading.Timer(delay, shutdown)
    timer.daemon = True
    timer.start()
    return ActionResult(True, "server stopping")
