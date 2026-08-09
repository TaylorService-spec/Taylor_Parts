$log = "$PSScriptRoot\netwatch-standalone.csv"
if (-not (Test-Path $log)) { "ts,gw_ms,wan1_ms,wan2_ms,dns,tcp_conns" | Out-File $log -Encoding utf8 }
function P($t,$w){ $r = ping -n 1 -w $w $t 2>$null | Select-String -Pattern 'time[<=](\d+)ms'
  if($r){ $r.Matches[0].Groups[1].Value } else { 'FAIL' } }
$end = (Get-Date).AddHours(12)
while ((Get-Date) -lt $end) {
  $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  $gw = P '192.168.0.1' 1000; $w1 = P '1.1.1.1' 1500; $w2 = P '8.8.8.8' 1500
  $o = nslookup -timeout=2 github.com 1.1.1.1 2>&1 | Out-String
  $dns = if ($o -match 'timed out|can''t find|No response|Server failed') { 'FAIL' }
         elseif ($o -match 'Name:' -and $o -match 'Address') { 'ok' } else { 'FAIL' }
  $c = (Get-NetTCPConnection -State Established -EA SilentlyContinue).Count
  "$ts,$gw,$w1,$w2,$dns,$c" | Add-Content $log
  Start-Sleep -Seconds 5
}
