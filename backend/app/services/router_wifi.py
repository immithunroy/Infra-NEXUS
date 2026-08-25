"""Direct router WiFi read via vendor web-admin protocols.

Supported protocols (reverse-engineered and verified against deployed routers):

* Cudy (OpenWrt-style LuCI): HTTPS login via /cgi-bin/luci with RSA + AES
  encrypted payloads; WiFi config read from admin/wireless?form=...
* TP-Link (Archer C24): HTTP SPA on :8080 with the `?code=N&asyn=..&id=..`
  GDPR scheme; WiFi config read via code=2 (HTTP_READ) AES/RSA encrypted.
* Mercury classic (MW305R/MW325R/MW330HP): same HTTP SPA but plaintext block
  exchange; block 33 holds the main WiFi (35 the guest) on MW305R/MW330HP, the
  reverse on MW325R.
* Tenda: GoAhead web server on :8080, base64(utf8(password)) login to
  /login/Auth then JSON from /goform/getWifi.

All return a normalized structure compatible with AcsWifiStatusOut so the UI
can render router-reported WiFi regardless of TR-069 support.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import random
import socket
import time
import urllib.parse
import urllib3

import requests
from Crypto.Cipher import AES, PKCS1_v1_5
from Crypto.PublicKey import RSA
from Crypto.Util.Padding import pad, unpad

# (scheme, port) used to detect which protocol to try, in order.
TP_LINK_PORT = 8080
CUDY_PORTS = [(443, "https"), (80, "http")]

TP_LINK_KEY = "RDpbLfCPsJZ7fiv"
TP_LINK_DICT = "yLwVl0zKqws7LgKPRQ84Mdt708T1qQ3Ha7xv3H7NyU84p21BriUWBU43odz3iP4rBL3cD02KZciXTysVXiV8ngg6vL48rPJyAUw0HurW20xqxv9aYb4M9wK1Ae0wlro510qXeU07kV57fQMc8L6aLgMLwygtc0F10a0Dg70TOoouyFhdysuRMO51yY5ZlOZZLEal1h0t9YQW0Ko7oBwmCAHoic4HYbUyVeU3sfQ1xtXcPcf1aT303wAQhv66qzW"

# Preferred admin credential set for managed routers. Routers that do not use
# the standard credential cannot be read; this is a best-effort fallback.
ROUTER_USERNAME = "admin"
ROUTER_PASSWORD = "admin123"

# Block/data ids for TP-Link wireless (from tpEncrypt / MERProxy).
MBSSID_MAIN_DATA_ID = 33
WLAN_BASIC_DATA_ID = 32

PROBE_TIMEOUT = 1.5
CACHE_TTL_SECONDS = 120.0

_cache: dict[str, tuple[float, dict]] = {}

urllib3.disable_warnings()


def _tp_encrypt(t: str, r: str = TP_LINK_KEY, e: str = TP_LINK_DICT) -> str:
    n, i, s = len(t), len(r), len(e)
    o = i if i > n else n
    a = []
    for y in range(o):
        p = c = 0xBB
        if y >= n:
            c = ord(r[y])
        elif y >= i:
            p = ord(t[y])
        else:
            p = ord(t[y])
            c = ord(r[y])
        a.append(e[(p ^ c) % s])
    return "".join(a)


def _raw_request(host: str, port: int, data: bytes, timeout: float = 8.0) -> bytes:
    s = socket.create_connection((host, port), timeout)
    s.settimeout(timeout)
    s.sendall(data)
    chunks = []
    try:
        while True:
            c = s.recv(65536)
            if not c:
                break
            chunks.append(c)
    except socket.timeout:
        pass
    s.close()
    return b"".join(chunks)


def _http_post(host: str, port: int, path: str, body: bytes = b"", timeout: float = 8.0):
    referer = f"http://{host}:{port}/"
    req = (
        f"POST {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
        f"Content-Type: text/plain;charset=UTF-8\r\nContent-Length: {len(body)}\r\n"
        f"Connection: close\r\nReferer: {referer}\r\n"
        f"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0\r\n\r\n"
    ).encode() + body
    r = _raw_request(host, port, req, timeout)
    head, _, resp = r.partition(b"\r\n\r\n")
    status = head.split(b"\r\n")[0].decode("utf8", "replace")
    return status, resp


async def _tcp_open(ip: str, port: int) -> bool:
    try:
        await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=PROBE_TIMEOUT)
        return True
    except (OSError, asyncio.TimeoutError):
        return False


def _normalized(supported: bool, bands: list[dict], summary: str = "") -> dict:
    return {"supported": supported, "bands": bands, "summary": summary}


def _empty(summary: str = "") -> dict:
    return _normalized(False, [], summary)


# --------------------------------------------------------------------------
# Cudy
# --------------------------------------------------------------------------

def _cudy_aes_encrypt(key: str, iv: str, plaintext: str) -> str:
    c = AES.new(key.encode(), AES.MODE_CBC, iv.encode())
    return base64.b64encode(c.encrypt(pad(plaintext.encode(), 16))).decode()


def _cudy_aes_decrypt(key: str, iv: str, b64: str) -> str:
    c = AES.new(key.encode(), AES.MODE_CBC, iv.encode())
    return unpad(c.decrypt(base64.b64decode(b64)), 16).decode()


def _cudy_rsa_sign(sign_str: str, pubkey) -> str:
    enc = PKCS1_v1_5.new(pubkey)
    out = b""
    for i in range(0, len(sign_str), 53):
        out += enc.encrypt(sign_str[i:i + 53].encode())
    return out.hex()


def _cudy_pubkey(hex_n: str, hex_e: str):
    return RSA.construct((int.from_bytes(bytes.fromhex(hex_n), "big"), int.from_bytes(bytes.fromhex(hex_e), "big")))


def _cudy_read(ip: str, port: int, scheme: str) -> dict:
    base = f"{scheme}://{ip}" + (f":{port}" if port else "")
    s = requests.Session()
    s.verify = False
    hdrs = {
        "Referer": f"{base}/webpages/login.html",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
    }
    try:
        r = s.post(
            f"{base}/cgi-bin/luci/;stok=/login",
            params={"form": "keys"},
            data={"operation": "read"},
            headers=hdrs,
            timeout=8,
        )
        keys = r.json().get("data", {}).get("password") or r.json().get("result", {}).get("password")
        pw_pub = _cudy_pubkey(keys[0], keys[1])

        r = s.post(
            f"{base}/cgi-bin/luci/;stok=/login",
            params={"form": "auth"},
            data={"operation": "read"},
            headers=hdrs,
            timeout=8,
        )
        auth = r.json().get("data", {}) or r.json().get("result", {})
        sig_pub = _cudy_pubkey(auth["key"][0], auth["key"][1])
        seq = str(auth["seq"])

        aes_key = "".join(str(random.randint(0, 9)) for _ in range(16))
        aes_iv = "".join(str(random.randint(0, 9)) for _ in range(16))
        pw_hash = hashlib.md5((ROUTER_USERNAME + ROUTER_PASSWORD).encode()).hexdigest()
        enc_pw = PKCS1_v1_5.new(pw_pub).encrypt(ROUTER_PASSWORD.encode())
        data_b64 = _cudy_aes_encrypt(aes_key, aes_iv, f"password={enc_pw.hex()}&operation=login")
        sign_str = f"k={aes_key}&i={aes_iv}&h={pw_hash}&s={int(seq) + len(data_b64)}"
        signature = _cudy_rsa_sign(sign_str, sig_pub)
        r = s.post(
            f"{base}/cgi-bin/luci/;stok=/login",
            params={"form": "login"},
            data={"sign": signature, "data": data_b64},
            headers={**hdrs, "Content-Type": "application/x-www-form-urlencoded"},
            timeout=8,
        )
        plain = _cudy_aes_decrypt(aes_key, aes_iv, r.json().get("data"))
        result = json.loads(plain)
        stok = (result.get("result") or result.get("data") or {}).get("stok")
        if not stok:
            return _empty("Cudy login failed")
    except Exception as e:
        return _empty(f"Cudy error: {e}")

    def api(path: str, plain: str) -> dict | None:
        try:
            data_b64 = _cudy_aes_encrypt(aes_key, aes_iv, plain)
            sign_str = f"h={pw_hash}&s={int(seq) + len(data_b64)}"
            signature = _cudy_rsa_sign(sign_str, sig_pub)
            url = f"{base}/cgi-bin/luci/;stok={stok}/{path}"
            r = s.post(
                url,
                data={"sign": signature, "data": data_b64},
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-Requested-With": "XMLHttpRequest",
                    "User-Agent": "Mozilla/5.0 Chrome/120.0",
                    "Referer": base + "/webpages/index.html",
                },
                timeout=10,
            )
            resp = r.json()
            ed = resp.get("data")
            if ed and isinstance(ed, str):
                return json.loads(_cudy_aes_decrypt(aes_key, aes_iv, ed))
            return None
        except Exception:
            return None

    try:
        data = api("admin/wireless?form=wireless_2g&form=wireless_5g&form=wireless_5g_2", "operation=read")
        if not data:
            return _empty("Cudy wireless read failed")
    except Exception as e:
        return _empty(f"Cudy wireless error: {e}")

    bands = []
    for prefix, band, instance in [
        ("wireless_2g", "2.4g", 1),
        ("wireless_5g", "5g", 2),
        ("wireless_5g_2", "5g2", 3),
    ]:
        ssid = data.get(f"{prefix}_ssid", "")
        psk = data.get(f"{prefix}_psk_key", "")
        encryption = data.get(f"{prefix}_encryption", "")
        enabled = data.get(f"{prefix}_enable") in ("on", "1", "true")
        channel = data.get(f"{prefix}_current_channel", "")
        hwmode = data.get(f"{prefix}_hwmode", "")
        security = "WPA2-PSK" if encryption == "psk" else (encryption.upper() if encryption else "")
        bands.append(
            {
                "instance": instance,
                "band": band,
                "ssid": ssid,
                "passphrase": psk,
                "enable": enabled,
                "channel": channel,
                "standard": hwmode,
                "security_mode": security,
            }
        )
    return _normalized(True, bands)


# --------------------------------------------------------------------------
# TP-Link / Mercury
# --------------------------------------------------------------------------

def _tpl_parse_blocks(dec: str) -> dict[str, str]:
    """Parse a TP-Link block-text response into a flat field map."""
    fields: dict[str, str] = {}
    for line in dec.split("\r\n"):
        line = line.rstrip("\n").strip()
        if not line or line.startswith("00000") or line.startswith("id "):
            continue
        parts = line.split(" ")
        if len(parts) >= 3 and parts[1].isdigit():
            fields[parts[0]] = " ".join(parts[2:])
        elif len(parts) >= 2:
            fields[parts[0]] = " ".join(parts[1:])
    return fields


def _tpl_band_from_fields(fields: dict[str, str], default_band: str) -> dict:
    ssid = urllib.parse.unquote(fields.get("cSsid", ""))
    psk = fields.get("cPskSecret", "")
    enabled = fields.get("bEnable") == "1"
    auth = int(fields.get("uAuthType", "0") or 0)
    security = {
        0: "Open",
        1: "WEP",
        2: "WPA-PSK",
        3: "WPA2/WPA-PSK",
    }.get(auth, "Unknown")
    instance = 1 if default_band == "2.4g" else 2
    return {
        "instance": instance,
        "band": default_band,
        "ssid": ssid,
        "passphrase": psk,
        "enable": enabled,
        "channel": "",
        "standard": "",
        "security_mode": security,
    }


def _tpl_http_get(ip: str, port: int, path: str) -> tuple[str, bytes]:
    req = (
        f"GET {path} HTTP/1.1\r\nHost: {ip}:{port}\r\n"
        f"Connection: close\r\nReferer: http://{ip}:{port}/\r\n"
        f"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0\r\n\r\n"
    ).encode()
    r = _raw_request(ip, port, req)
    head, _, resp = r.partition(b"\r\n\r\n")
    return head.split(b"\r\n")[0].decode("utf8", "replace"), resp


def _tpl_read(ip: str, port: int) -> dict:
    try:
        status, body = _http_post(ip, port, "/?code=7&asyn=1")
        if b" 401 " not in status.encode():
            return _empty(f"TP-Link challenge failed: {status}")
        lines = body.decode("utf8", "replace").split("\r\n")
        if len(lines) < 5:
            return _empty("TP-Link challenge malformed")
        challenge, srv_dict = lines[3], lines[4]
    except Exception as e:
        return _empty(f"TP-Link challenge error: {e}")

    # Detect the scheme: read device.json. Modern GDPR firmware serves it and
    # exchanges AES/RSA-encrypted blocks; classic firmware (Mercury MW305R/MW325R,
    # Mercusys, older TP-Link) omits it (404) or reports gdprSupport:false and
    # exchanges plaintext block text.
    gdpr = True
    try:
        status, d = _tpl_http_get(ip, port, "/config/device.json?t=0")
        if b" 404 " in status.encode() or b'"gdprSupport":false' in d or b'"gdprSupport": false' in d:
            gdpr = False
    except Exception:
        gdpr = False

    try:
        o1 = _tp_encrypt(ROUTER_PASSWORD)
        o2 = _tp_encrypt(challenge, o1, srv_dict)
        # JS uses encodeURIComponent semantics (safe chars !'()*-._~); quote's
        # default also escapes some of those, which breaks the router's session id.
        id_param = urllib.parse.quote(o2, safe="!'()*-._~")
        status, body = _http_post(ip, port, "/?code=7&asyn=0&id=" + id_param)
        if b" 200 " not in status.encode():
            return _empty(f"TP-Link login failed: {status}")

        def read_blocks(blocks: str) -> str | None:
            if gdpr:
                status, body = _http_post(ip, port, "/?code=16&asyn=0", b"get")
                p = body.decode("utf8", "replace").split("\r\n")
                if len(p) < 4:
                    return None
                ee, nn, seq = p[1], p[2], p[3]
                rsa_key = RSA.construct((int(nn, 16), int(ee, 16)))
                rsa_cipher = PKCS1_v1_5.new(rsa_key)
                aes_key = "".join(str(random.randint(0, 9)) for _ in range(16))
                aes_iv = "".join(str(random.randint(0, 9)) for _ in range(16))
                aes_key_string = f"k={aes_key}&i={aes_iv}"

                def aes_encrypt(plaintext: str) -> str:
                    c = AES.new(aes_key.encode(), AES.MODE_CBC, aes_iv.encode())
                    return base64.b64encode(c.encrypt(pad(plaintext.encode(), 16))).decode()

                def aes_decrypt(b64: str) -> str:
                    c = AES.new(aes_key.encode(), AES.MODE_CBC, aes_iv.encode())
                    return unpad(c.decrypt(base64.b64decode(b64)), 16).decode()

                def rsa_encrypt_chunks(s: str) -> str:
                    out = b""
                    for i in range(0, len(s), 53):
                        out += rsa_cipher.encrypt(s[i:i + 53].encode())
                    return out.hex()

                def sign(data_b64: str) -> str:
                    return rsa_encrypt_chunks(f"{aes_key_string}&s={int(seq) + len(data_b64)}")

                rsa_enc_aes = rsa_cipher.encrypt(aes_key_string.encode()).hex()
                status, body = _http_post(ip, port, "/?code=16&asyn=0&id=" + id_param, ("set " + rsa_enc_aes).encode())
                if b" 200 " not in status.encode():
                    return None
                data_b64 = aes_encrypt(blocks)
                body_req = ("sign=" + sign(data_b64) + "\r\ndata=" + data_b64).encode()
                status, resp = _http_post(ip, port, "/?code=2&asyn=1&id=" + id_param, body_req)
                if b" 200 " not in status.encode():
                    return None
                return aes_decrypt(resp.decode("utf8", "replace"))
            else:
                status, resp = _http_post(ip, port, "/?code=2&asyn=1&id=" + id_param, blocks.encode())
                if b" 200 " not in status.encode():
                    return None
                return resp.decode("utf8", "replace")

        bands = []
        # Block 33 is the WiFi main block on most firmware, but the Mercury
        # MW325R generation keeps it in block 35 (33 is the WDS block there).
        # Try 33 first; fall back to 35 when it has no WiFi fields.
        for band, inst in [("2.4g", 1), ("5g", 2)]:
            fields = None
            for bid in (33, 35):
                dec = read_blocks(f"{bid}|{inst},1,0#32|{inst},0,0")
                if not dec:
                    continue
                candidate = _tpl_parse_blocks(dec)
                if candidate.get("cSsid") is not None:
                    fields = candidate
                    break
            if not fields:
                continue
            bands.append(_tpl_band_from_fields(fields, band))
        if not bands:
            return _empty("TP-Link WiFi read returned no bands")
        # Single-band units echo the same block for both instances; drop the
        # duplicate instead of reporting a phantom second band.
        if len(bands) == 2 and bands[0].get("ssid") == bands[1].get("ssid") and bands[0].get("passphrase") == bands[1].get("passphrase"):
            bands = bands[:1]
        return _normalized(True, bands)
    except Exception as e:
        return _empty(f"TP-Link error: {e}")


# --------------------------------------------------------------------------
# Tenda
# --------------------------------------------------------------------------

TENDA_SECURITY = {
    "none": "Open",
    "open": "Open",
    "wep": "WEP",
    "wpa": "WPA-PSK",
    "wpa-psk": "WPA-PSK",
    "wpa2": "WPA2-PSK",
    "wpa2-psk": "WPA2-PSK",
    "wpa&wpa2": "WPA2/WPA-PSK",
    "wpa2&wpa": "WPA2/WPA-PSK",
    "wpapsk": "WPA-PSK",
    "wpa2psk": "WPA2-PSK",
    "wpa2/wpa": "WPA2/WPA-PSK",
    "wpa/wpa2": "WPA2/WPA-PSK",
}


def _tenda_request(ip: str, port: int, method: str, path: str, body: bytes = b"",
                   ctype: str = "application/x-www-form-urlencoded", cookies: bytes = b"",
                   timeout: float = 8.0) -> tuple[bytes, bytes]:
    hh = (
        f"Host: {ip}:{port}\r\nConnection: close\r\n"
        f"Content-Type: {ctype}\r\nContent-Length: {len(body)}\r\n"
        f"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0\r\n"
    )
    if cookies:
        hh += f"Cookie: {cookies.decode('utf8', 'replace')}\r\n"
    r = _raw_request(ip, port, f"{method} {path} HTTP/1.1\r\n{hh}\r\n".encode() + body, timeout)
    # GoAhead sometimes terminates headers with bare \n\n instead of \r\n\r\n;
    # split on whichever separator appears first.
    head, _, resp = r.partition(b"\r\n\r\n")
    if not resp and b"\n\n" in r:
        head, _, resp = r.partition(b"\n\n")
    return head, resp


def _tenda_read(ip: str, port: int) -> dict:
    try:
        # Password is base64(utf8(password)) (see Encode in common.js).
        pw_b64 = base64.b64encode(ROUTER_PASSWORD.encode("utf-8")).decode()
        body = f"password={urllib.parse.quote(pw_b64)}".encode()
        head, resp = _tenda_request(ip, port, "POST", "/login/Auth", body)
        cookie = b""
        for h in head.split(b"\r\n"):
            if h.lower().startswith(b"set-cookie"):
                cookie = h.split(b":", 1)[1].strip().split(b";", 1)[0]
                break
        if not cookie:
            return _empty("Tenda login failed")

        path = "/goform/getWifi?modules=wifiEn,wifiBasicCfg,wifiAdvCfg,wifiWPS"
        head, resp = _tenda_request(ip, port, "GET", path, cookies=cookie)
        if b" 200 " not in head.split(b"\r\n")[0]:
            return _empty("Tenda getWifi failed")
        j = json.loads(resp.decode("utf8", "replace"))
        base = j.get("wifiBasicCfg", {}) or {}
        en = (j.get("wifiEn", {}) or {}).get("wifiEn") == "true"
        ssid = base.get("wifiSSID", "")
        pwd = base.get("wifiPwd", "")
        mode = (base.get("wifiSecurityMode") or "").lower()
        security = TENDA_SECURITY.get(mode, base.get("wifiSecurityMode") or "Unknown")
        if not ssid:
            return _empty("Tenda WiFi read returned no SSID")
        bands = [{
            "instance": 1,
            "band": "2.4g",
            "ssid": ssid,
            "passphrase": pwd,
            "enable": en,
            "channel": "",
            "standard": "",
            "security_mode": security,
        }]
        # Log out to release the session slot (router allows ~4 concurrent).
        try:
            _tenda_request(ip, port, "POST", "/goform/loginOut", b"action=loginout", cookies=cookie)
        except Exception:
            pass
        return _normalized(True, bands)
    except Exception as e:
        return _empty(f"Tenda error: {e}")


# --------------------------------------------------------------------------
# Netis / Netcore
# --------------------------------------------------------------------------

# Netis sec_mode -> security label (from logic.js).
NETIS_SECURITY = {
    "0": "Open",
    "1": "WEP",
    "2": "WPA-PSK",
    "3": "WPA2-PSK",
    "4": "WPA2/WPA-PSK",
}


def _netis_request(ip: str, port: int, method: str, path: str, body: bytes = b"",
                   ctype: str = "application/x-www-form-urlencoded",
                   cookies: bytes = b"", timeout: float = 8.0) -> tuple[bytes, bytes]:
    hh = (
        f"Host: {ip}:{port}\r\nConnection: close\r\n"
        f"Content-Type: {ctype}\r\nContent-Length: {len(body)}\r\n"
        f"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0\r\n"
        f"Accept-Encoding: gzip\r\n"
    )
    if cookies:
        hh += f"Cookie: {cookies.decode('utf8', 'replace')}\r\n"
    r = _raw_request(ip, port, f"{method} {path} HTTP/1.1\r\n{hh}\r\n".encode() + body, timeout)
    head, _, resp = r.partition(b"\r\n\r\n")
    if resp[:2] == b"\x1f\x8b":
        import gzip as _gzip
        try:
            resp = _gzip.decompress(resp)
        except Exception:
            pass
    return head, resp


def _netis_spa_read(ip: str, port: int) -> dict:
    """Netis/Netcore SPA firmware: full config is served by /cgi-bin-igd/
    netcore_get.cgi without authentication."""
    try:
        head, resp = _netis_request(ip, port, "POST", "/cgi-bin-igd/netcore_get.cgi", b"noneed=noneed")
        if b" 200 " not in head.split(b"\r\n")[0] or not resp:
            return _empty("Netis SPA get failed")
        t = resp.decode("utf8", "replace")
        import re as _re
        fields = dict(_re.findall(r"[\"']([A-Za-z0-9_]+)[\"']\s*:\s*[\"']([^\"']*)[\"']", t))
        ssid = fields.get("ssid", "")
        pwd = fields.get("key_wpa", "")
        if not ssid:
            return _empty("Netis SPA returned no SSID")
        sec = NETIS_SECURITY.get(fields.get("sec_mode", ""), "Unknown")
        enabled = fields.get("wl_enable") == "1"
        bands = [{
            "instance": 1,
            "band": "2.4g",
            "ssid": ssid,
            "passphrase": pwd,
            "enable": enabled,
            "channel": fields.get("real_channel", ""),
            "standard": "",
            "security_mode": sec,
        }]
        # 5G module present on dual-band units.
        ssid5 = fields.get("ssid5g", "")
        if ssid5:
            bands.append({
                "instance": 2,
                "band": "5g",
                "ssid": ssid5,
                "passphrase": fields.get("key_wpa5g", ""),
                "enable": fields.get("wl_enable5g") == "1",
                "channel": fields.get("real_channel5g", ""),
                "standard": "",
                "security_mode": NETIS_SECURITY.get(fields.get("sec_mode5g", ""), "Unknown"),
            })
        return _normalized(True, bands)
    except Exception as e:
        return _empty(f"Netis error: {e}")


# --------------------------------------------------------------------------
# D-Link
# --------------------------------------------------------------------------

def _dlink_request(ip: str, port: int, method: str, path: str, body: bytes = b"",
                   ctype: str = "application/x-www-form-urlencoded", cookies: bytes = b"",
                   referer: str | None = None, timeout: float = 8.0) -> tuple[bytes, bytes]:
    hh = (
        f"Host: {ip}:{port}\r\nConnection: close\r\n"
        f"Content-Type: {ctype}\r\nContent-Length: {len(body)}\r\n"
        f"User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0\r\n"
    )
    if cookies:
        hh += f"Cookie: {cookies.decode('utf8', 'replace')}\r\n"
    if referer:
        hh += f"Referer: {referer}\r\n"
    r = _raw_request(ip, port, f"{method} {path} HTTP/1.1\r\n{hh}\r\n".encode() + body, timeout)
    head, _, resp = r.partition(b"\r\n\r\n")
    return head, resp

def _dlink_read(ip: str, port: int) -> dict:
    """D-Link classic (Virtual Web 0.9 on :8080). Login posts hex_md5(password)
    to login.cgi; the resulting SessionID cookie is used for subsequent reads."""
    try:
        pw = hashlib.md5(ROUTER_PASSWORD.encode()).hexdigest()
        body = (
            f"submit.htm?login.htm=0&username={urllib.parse.quote(ROUTER_USERNAME)}&password={pw}"
        ).encode()
        head, resp = _dlink_request(ip, port, "POST", "/login.cgi", body, referer=f"http://{ip}:{port}/login.htm")
        if b"Username or password error" in resp:
            return _empty("D-Link login failed")
        cookie = b""
        for h in head.split(b"\r\n"):
            if h.lower().startswith(b"set-cookie"):
                cookie = h.split(b":", 1)[1].strip().split(b";", 1)[0]
                break
        if not cookie:
            return _empty("D-Link login failed")
        # Try the classic D-Link status XML/config endpoints. Firmware varies;
        # most expose WiFi SSID/key via GetStatus or the config export.
        tried = []
        for path in ("/status.htm", "/index.htm", "/GetStatus", "/config.bin", "/main.htm"):
            h, r = _dlink_request(ip, port, "GET", path, cookies=cookie)
            tried.append((path, h.split(b"\r\n")[0].decode(), len(r)))
        # Fall back to a config export read if available.
        h, r = _dlink_request(ip, port, "POST", "/config.bin", b"submit-url=%2Fconfig.bin&backup=1", cookies=cookie)
        tried.append(("/config.bin", h.split(b"\r\n")[0].decode(), len(r)))
        # Parse SSID/PSK from any text we collected.
        import re as _re
        t = r.decode("utf8", "replace")
        ssid = psk = ""
        m = _re.search(r"[Ss][Ss][Ii][Dd].{0,20}?[\"':=]\s*([^\s\"'<>]+)", t)
        if m:
            ssid = m.group(1)
        m = _re.search(r"(?:wpa|pass|key|psk)[A-Za-z0-9_]*\s*[\"':=]\s*([^\s\"'<>]+)", t)
        if m:
            psk = m.group(1)
        if ssid:
            return _normalized(True, [{
                "instance": 1,
                "band": "2.4g",
                "ssid": ssid,
                "passphrase": psk,
                "enable": True,
                "channel": "",
                "standard": "",
                "security_mode": "WPA2/WPA-PSK",
            }])
        return _empty(f"D-Link read: no SSID found ({'; '.join(f'{p}:{s}' for p, s, _ in tried)})")
    except Exception as e:
        return _empty(f"D-Link error: {e}")


# --------------------------------------------------------------------------
# Asus (ASUSWRT)
# --------------------------------------------------------------------------

def _asus_read(ip: str, port: int) -> dict:
    """ASUSWRT on :8080. Login posts base64('user:pass') in login_authorization
    to login.cgi; on success the page includes asus_token. WiFi config is read
    from appGet.cgi/update.cgi with the token."""
    try:
        auth = base64.b64encode(f"{ROUTER_USERNAME}:{ROUTER_PASSWORD}".encode()).decode()
        body = (
            f"group_id=&action_mode=&action_script=&action_wait=5&current_page=Main_Login.asp"
            f"&next_page=Main_Login.asp&login_authorization={auth}"
            f"&login_username={ROUTER_USERNAME}&login_passwd={ROUTER_PASSWORD}"
        ).encode()
        head, resp = _dlink_request(ip, port, "POST", "/login.cgi", body,
                                    referer=f"http://{ip}:{port}/Main_Login.asp")
        import re as _re
        m = _re.search(rb"asus_token\s*=\s*'([^']+)'", resp)
        if not m:
            return _empty("Asus login failed")
        token = m.group(1).decode()
        # Read wireless via the JSON config endpoint (ASUSWRT default).
        try:
            h, r = _dlink_request(
                ip, port, "GET",
                f"/appGet.cgi?hook=nvram_get:wl0_ssid,wl0_wpa_psk,wl0_auth_mode_x,wl1_ssid,wl1_wpa_psk,wl1_auth_mode_x&t={token}",
                cookies=b"",
            )
            t = r.decode("utf8", "replace")
            if "wl0_ssid" in t:
                bands = []
                for prefix, band, inst in (("wl0", "2.4g", 1), ("wl1", "5g", 2)):
                    ssid = _re.search(prefix + r'_ssid\s*=\s*"([^"]*)"', t)
                    psk = _re.search(prefix + r'_wpa_psk\s*=\s*"([^"]*)"', t)
                    authm = _re.search(prefix + r'_auth_mode_x\s*=\s*"([^"]*)"', t)
                    if ssid and ssid.group(1):
                        bands.append({
                            "instance": inst,
                            "band": band,
                            "ssid": ssid.group(1),
                            "passphrase": psk.group(1) if psk else "",
                            "enable": True,
                            "channel": "",
                            "standard": "",
                            "security_mode": "WPA2-PSK" if authm and authm.group(1) in ("psk2", "psk2psk") else (authm.group(1) if authm else ""),
                        })
                if bands:
                    return _normalized(True, bands)
            return _empty("Asus wireless read returned no SSID")
        except Exception as e:
            return _empty(f"Asus wireless error: {e}")
    except Exception as e:
        return _empty(f"Asus error: {e}")


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------

async def read_wifi(ip: str, force: bool = False) -> dict:
    """Read WiFi config from a router by IP. Tries TP-Link, Tenda then Cudy.

    The protocol is chosen by which management port is open (TP-Link/Tenda SPA
    on :8080, Cudy LuCI on :443/:80). Results are cached briefly.
    """
    ip = (ip or "").strip()
    if not ip:
        return _empty("No router IP available")

    now = time.time()
    if not force and ip in _cache and now - _cache[ip][0] < CACHE_TTL_SECONDS:
        return _cache[ip][1]

    ports = [(TP_LINK_PORT, "tpl")] + [(p, (p, s)) for p, s in CUDY_PORTS]
    open_flags = await asyncio.gather(*(_tcp_open(ip, p) for p, _ in ports))
    candidates = [tag for (p, tag), flag in zip(ports, open_flags) if flag]

    result = _empty("No management port open")
    for tag in candidates:
        if tag == "tpl":
            result = await asyncio.to_thread(_tpl_read, ip, TP_LINK_PORT)
            if not result["supported"]:
                # Same port serves Tenda's GoAhead web UI and Netis/Netcore
                # SPA; fall through until one matches.
                result = await asyncio.to_thread(_tenda_read, ip, TP_LINK_PORT)
            if not result["supported"]:
                result = await asyncio.to_thread(_netis_spa_read, ip, TP_LINK_PORT)
            if not result["supported"]:
                result = await asyncio.to_thread(_asus_read, ip, TP_LINK_PORT)
            if not result["supported"]:
                result = await asyncio.to_thread(_dlink_read, ip, TP_LINK_PORT)
        elif tag in CUDY_PORTS:
            port, scheme = tag
            result = await asyncio.to_thread(_cudy_read, ip, port, scheme)
        if result["supported"]:
            break

    _cache[ip] = (time.time(), result)
    return result

