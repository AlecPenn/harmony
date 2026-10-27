# HARMONY Wi-Fi watchdog scan (Windows PowerShell 5.1). A fixed, read-only script: it takes no input except the
# -Sweep switch, changes nothing, and prints one JSON object. It lists the devices this PC can see on its home network
# (the ARP neighbour table for the interface with the default route), the router, the Wi-Fi network name, and, for
# each device, the name it answers to on the network (reverse DNS / NetBIOS), if any.
#   -Sweep  first pings every address on the local /24 (or smaller) network once, briefly, so quiet devices show up.
param([switch]$Sweep)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  $route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric, ifMetric | Select-Object -First 1
  if (-not $route) { '{"ok":false,"reason":"no network"}'; exit 0 }
  $if = $route.ifIndex; $gateway = $route.NextHop
  $addr = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $if | Where-Object { $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1
  $alias = $null; try { $alias = (Get-NetAdapter -InterfaceIndex $if -IncludeHidden -ErrorAction Stop).InterfaceAlias } catch {}
  $ssid = $null
  try {
    $wlan = netsh wlan show interfaces 2>$null
    foreach ($line in $wlan) { if ($line -match '^\s*SSID\s*:\s*(.+)$') { $ssid = $Matches[1].Trim(); break } }
  } catch {}
  if ($Sweep -and $addr -and $addr.PrefixLength -ge 24 -and $addr.PrefixLength -le 30) {
    $ip = [System.Net.IPAddress]::Parse($addr.IPAddress).GetAddressBytes()
    $hosts = [Math]::Pow(2, 32 - $addr.PrefixLength) - 2
    # Plain 64-bit arithmetic (PowerShell's comma binds tighter than -band, so no operator tricks here).
    $size = [int64][Math]::Pow(2, 32 - $addr.PrefixLength)
    $base = [int64]$ip[0] * 16777216 + [int64]$ip[1] * 65536 + [int64]$ip[2] * 256 + [int64]$ip[3]
    $net = $base - ($base % $size)
    $tasks = @()
    for ($i = 1; $i -le $hosts; $i++) {
      $n = $net + $i
      $octets = [byte[]]@(([Math]::Floor($n / 16777216) % 256), ([Math]::Floor($n / 65536) % 256), ([Math]::Floor($n / 256) % 256), ($n % 256))
      $target = [System.Net.IPAddress]::new($octets)
      $tasks += (New-Object System.Net.NetworkInformation.Ping).SendPingAsync($target, 400)
    }
    try { [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]$tasks, 4000) | Out-Null } catch {}
  }
  $seen = Get-NetNeighbor -AddressFamily IPv4 -InterfaceIndex $if |
    Where-Object { $_.State -in 'Reachable', 'Stale', 'Delay', 'Probe', 'Permanent' -and $_.LinkLayerAddress -and $_.LinkLayerAddress -ne '00-00-00-00-00-00' -and $_.LinkLayerAddress -ne 'FF-FF-FF-FF-FF-FF' }
  $lookups = @{}
  foreach ($d in $seen) { try { $lookups[$d.IPAddress] = [System.Net.Dns]::GetHostEntryAsync($d.IPAddress) } catch {} }
  if ($lookups.Count) { try { [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($lookups.Values), 2500) | Out-Null } catch {} }
  $devices = foreach ($d in $seen) {
    $name = $null; $t = $lookups[$d.IPAddress]
    if ($t -and $t.Status -eq 'RanToCompletion' -and $t.Result.HostName -and $t.Result.HostName -ne $d.IPAddress) { $name = $t.Result.HostName }
    [ordered]@{ ip = $d.IPAddress; mac = $d.LinkLayerAddress; state = [string]$d.State; name = $name }
  }
  $gatewayMac = ($seen | Where-Object { $_.IPAddress -eq $gateway } | Select-Object -First 1).LinkLayerAddress
  [ordered]@{ ok = $true; ssid = $ssid; adapter = $alias; me = $addr.IPAddress; prefix = $addr.PrefixLength; gateway = $gateway; gatewayMac = $gatewayMac; devices = @($devices) } | ConvertTo-Json -Compress -Depth 4
} catch {
  # Which step failed and why (no addresses), so a failed scan can be fixed.
  $where = if ($_.InvocationInfo) { $_.InvocationInfo.ScriptLineNumber } else { 0 }
  [ordered]@{ ok = $false; reason = 'scan failed'; line = $where; detail = ([string]$_.Exception.Message).Substring(0, [Math]::Min(300, ([string]$_.Exception.Message).Length)) } | ConvertTo-Json -Compress
}
