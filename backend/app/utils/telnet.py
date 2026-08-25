"""Minimal asyncio Telnet client with IAC negotiation handling.

Kept dependency-free on purpose: telnetlib is removed in Python 3.13 and
third-party telnetlib3 adds heavyweight deps. This client handles the common
case of talking to a network device CLI (BDCOM OLT, etc.).
"""
from __future__ import annotations

import asyncio

IAC = b"\xff"
DONT = b"\xfe"
DO = b"\xfd"
WONT = b"\xfc"
WILL = b"\xfb"
SE = b"\xf0"
SB = b"\xfa"

REPLY_TO = {WILL: DONT, DO: WONT}


class TelnetError(Exception):
    pass


class TelnetClient:
    def __init__(self, host: str, port: int = 23, timeout: float = 15.0):
        self.host = host
        self.port = port
        self.timeout = timeout
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None

    async def connect(self) -> None:
        try:
            self._reader, self._writer = await asyncio.open_connection(
                self.host, self.port
            )
        except OSError as exc:
            raise TelnetError(f"Telnet connection to {self.host}:{self.port} failed: {exc}") from exc

    def close(self) -> None:
        if self._writer:
            try:
                self._writer.close()
            except Exception:
                pass
            self._writer = None

    async def _read_raw(self, n: int = 1) -> bytes:
        data = await asyncio.wait_for(self._reader.read(n), self.timeout)
        if not data:
            raise TelnetError("Telnet connection closed by remote host")
        return data

    async def read_byte(self) -> bytes:
        """Read a single data byte, transparently handling telnet negotiation."""
        while True:
            b = await self._read_raw(1)
            if b == IAC:
                cmd = await self._read_raw(1)
                if cmd in (WILL, DO, WONT, DONT):
                    option = await self._read_raw(1)
                    reply = REPLY_TO.get(cmd)
                    if reply is not None:
                        self._writer.write(IAC + reply + option)
                        await self._writer.drain()
                elif cmd == SB:
                    while True:
                        b2 = await self._read_raw(1)
                        if b2 == IAC:
                            b3 = await self._read_raw(1)
                            if b3 == SE:
                                break
                # IAC NOP (241), GA (249), etc. are simply skipped
                continue
            return b

    async def read_until(self, patterns: list[str], timeout: float | None = None, strip: bool = True) -> str:
        """Read until any of the given string patterns appears.

        Returns all data received up to and including the matched pattern.
        """
        if timeout is None:
            timeout = self.timeout
        buf = ""
        try:
            while timeout > 0:
                start = asyncio.get_event_loop().time()
                b = await self.read_byte()
                buf += b.decode("utf-8", errors="replace")
                for pat in patterns:
                    if pat in buf:
                        return buf if not strip else buf
                timeout -= asyncio.get_event_loop().time() - start
        except asyncio.TimeoutError:
            pass
        raise TelnetError(f"Timed out waiting for {patterns!r}; received: {buf[-200:]!r}")

    async def expect(self, patterns: list[str], timeout: float | None = None) -> str:
        """Read until a pattern appears; returns only the data *before* the match."""
        raw = await self.read_until(patterns, timeout, strip=False)
        for pat in patterns:
            idx = raw.find(pat)
            if idx != -1:
                return raw[:idx]
        return raw

    def write(self, data: str) -> None:
        self._writer.write(data.encode("utf-8"))

    async def sendline(self, data: str) -> None:
        self.write(data + "\r")
        await self._writer.drain()