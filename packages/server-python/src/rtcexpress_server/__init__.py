"""RTCExpress server SDK: create short-lived user tokens on your backend."""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Literal, Optional

__all__ = ["DEFAULT_SERVER_URL", "RTCExpressError", "RTCExpressServer", "RoomRole", "TokenResponse"]
__version__ = "0.1.0"

DEFAULT_SERVER_URL = "https://api.devsquarelabs.com"

RoomRole = Literal["host", "publisher", "subscriber", "audience"]


@dataclass(frozen=True)
class TokenResponse:
    token: str
    expires_in: int
    """Seconds until the token expires."""


class RTCExpressError(Exception):
    """Raised when a token request fails.

    ``status`` is the HTTP status from the API, or 0 when no response arrived.
    """

    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


class RTCExpressServer:
    """Client for the RTCExpress token API.

    Keep the App Secret on your server. Never send it to a browser or mobile app.
    """

    def __init__(
        self,
        app_id: str,
        app_secret: str,
        server_url: str = DEFAULT_SERVER_URL,
        timeout: float = 10.0,
    ) -> None:
        if not app_id:
            raise ValueError("app_id is required")
        if not app_secret:
            raise ValueError("app_secret is required")
        self._app_id = app_id
        self._app_secret = app_secret
        self._server_url = server_url.rstrip("/")
        self._timeout = timeout

    def create_token(
        self,
        user_id: str,
        room_id: Optional[str] = None,
        role: Optional[RoomRole] = None,
    ) -> TokenResponse:
        """Request a short-lived user token to pass to a client SDK's init()."""
        if not user_id:
            raise ValueError("user_id is required")

        payload = {"appId": self._app_id, "appSecret": self._app_secret, "userId": user_id}
        if room_id is not None:
            payload["roomId"] = room_id
        if role is not None:
            payload["role"] = role

        request = urllib.request.Request(
            f"{self._server_url}/v1/token",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": f"rtcexpress-server-python/{__version__}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                status = response.status
                body = _parse_json(response.read())
        except urllib.error.HTTPError as err:
            body = _parse_json(err.read())
            message = body.get("error") or f"RTCExpress returned HTTP {err.code}"
            raise RTCExpressError(message, err.code) from None
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as err:
            reason = getattr(err, "reason", err)
            raise RTCExpressError(f"Could not reach RTCExpress: {reason}", 0) from None

        token = body.get("token")
        expires_in = body.get("expiresIn")
        if not isinstance(token, str) or not isinstance(expires_in, int):
            raise RTCExpressError("Unexpected response from RTCExpress", status)
        return TokenResponse(token=token, expires_in=expires_in)


def _parse_json(raw: bytes) -> dict:
    try:
        data = json.loads(raw.decode("utf-8") or "{}")
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}
