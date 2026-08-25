import re
with open('/opt/olt-commander/backend/app/services/acs.py', 'r') as f:
    content = f.read()

# Fix 1: Expand _MONITOR_PARAMS to include WiFi and more traffic parameters
old_monitor = """# Broad set of parameter names polled on GetRPC so most routers reply with at
# least a subset (vendors use different prefixes for CPU/mem/traffic).
_MONITOR_PARAMS = [
    "InternetGatewayDevice.DeviceInfo.CPUUsage",
    "InternetGatewayDevice.DeviceInfo.X_TP-LINK_CPUUsage",
    "InternetGatewayDevice.DeviceInfo.X_ASB_COM_CPUUsage",
    "InternetGatewayDevice.DeviceInfo.MemoryStatus.Total",
    "InternetGatewayDevice.DeviceInfo.MemoryStatus.Used",
    "InternetGatewayDevice.DeviceInfo.X_TP-LINK_MemUsage",
    "InternetGatewayDevice.DeviceInfo.X_ASB_COM_MemTotal",
    "InternetGatewayDevice.DeviceInfo.X_ASB_COM_MemUsed",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_BROADCOM_COM_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_BROADCOM_COM_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_TP-LINK_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_TP-LINK_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_ASB_COM_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_ASB_COM_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_BROADCOM_COM_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_BROADCOM_COM_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_TP-LINK_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_TP-LINK_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.MACAddress",
]"""

new_monitor = """# Broad set of parameter names polled on GetRPC so most routers reply with at
# least a subset (vendors use different prefixes for CPU/mem/traffic).
_MONITOR_PARAMS = [
    # CPU
    "InternetGatewayDevice.DeviceInfo.CPUUsage",
    "InternetGatewayDevice.DeviceInfo.X_TP-LINK_CPUUsage",
    "InternetGatewayDevice.DeviceInfo.X_ASB_COM_CPUUsage",
    # Memory
    "InternetGatewayDevice.DeviceInfo.MemoryStatus.Total",
    "InternetGatewayDevice.DeviceInfo.MemoryStatus.Used",
    "InternetGatewayDevice.DeviceInfo.X_TP-LINK_MemUsage",
    "InternetGatewayDevice.DeviceInfo.X_ASB_COM_MemTotal",
    "InternetGatewayDevice.DeviceInfo.X_ASB_COM_MemUsed",
    # WAN Traffic - IP Connection
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_BROADCOM_COM_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_BROADCOM_COM_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_TP-LINK_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_TP-LINK_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_ASB_COM_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_ASB_COM_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress",
    # WAN Traffic - PPP Connection
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_BROADCOM_COM_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_BROADCOM_COM_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_TP-LINK_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_TP-LINK_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.MACAddress",
    # WiFi parameters
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.Passphrase",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Channel",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Standard",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BasicEncryptionModes",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BeaconType",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.OperatingStandard",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Enable",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.Passphrase",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Channel",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Standard",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.BasicEncryptionModes",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.BeaconType",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.OperatingStandard",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.Enable",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.SSID",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.PreSharedKey.1.Passphrase",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.Channel",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.Standard",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.BasicEncryptionModes",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.BeaconType",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.OperatingStandard",
    # WiFi Radio stats (vendor specific)
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_BROADCOM_COM_TotalBytesReceived",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_BROADCOM_COM_TotalBytesSent",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_TP-LINK_TotalBytesReceived",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_TP-LINK_TotalBytesSent",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.X_BROADCOM_COM_TotalBytesReceived",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.X_BROADCOM_COM_TotalBytesSent",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.X_TP-LINK_TotalBytesReceived",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.X_TP-LINK_TotalBytesSent",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.X_BROADCOM_COM_TotalBytesReceived",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.X_BROADCOM_COM_TotalBytesSent",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.X_TP-LINK_TotalBytesReceived",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.X_TP-LINK_TotalBytesSent",
    # Device Summary
    "InternetGatewayDevice.DeviceSummary",
]"""

if old_monitor in content:
    content = content.replace(old_monitor, new_monitor)
    print("Fixed _MONITOR_PARAMS")
else:
    print("Old _MONITOR_PARAMS not found")
    idx = content.find("_MONITOR_PARAMS = [")
    if idx >= 0:
        print(content[idx:idx+500])
    else:
        print("Could not find _MONITOR_PARAMS")

with open('/opt/olt-commander/backend/app/services/acs.py', 'w') as f:
    f.write(content)