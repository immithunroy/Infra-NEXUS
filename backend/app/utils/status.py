"""Combined ONU status derivation.

The stored Onu.state is the raw register state (active/inactive/offline/
unknown). For display we combine it with the PPPoE binding and the OLT
dereg-reason into a single human status used across every list:
pppoe | up | power_off | wire_down | inactive | offline | unknown.
"""


def display_status(state: str, bound: bool, down_reason: str) -> str:
    state = (state or "unknown").lower()
    reason = (down_reason or "").lower()
    if state == "active":
        return "pppoe" if bound else "up"
    if state in ("inactive", "offline", "unknown"):
        if reason == "power-off":
            return "power_off"
        if reason == "wire-down":
            return "wire_down"
    return state