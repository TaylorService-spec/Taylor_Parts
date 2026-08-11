[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Z][A-Z0-9_]{2,79}$')]
  [string]$Name
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
if (-not $IsWindows -and $env:OS -ne 'Windows_NT') {
  throw 'UNSUPPORTED_PLATFORM: Windows DPAPI CurrentUser is required.'
}

$secretRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'EOS\secrets'
$secretPath = Join-Path $secretRoot "$Name.dpapi"
$secure = Read-Host "Enter $Name (input is hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$plainBytes = $null
$protectedBytes = $null
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Secret must not be empty.' }
  $plainBytes = [Text.Encoding]::UTF8.GetBytes($plain)
  $entropy = [Text.Encoding]::UTF8.GetBytes("EOS:secret:$Name:v1")
  $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
    $plainBytes,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [IO.Directory]::CreateDirectory($secretRoot) | Out-Null
  [IO.File]::WriteAllBytes($secretPath, $protectedBytes)
  Write-Output "Stored encrypted $Name for the current Windows user at $secretPath"
}
finally {
  if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  if ($protectedBytes) { [Array]::Clear($protectedBytes, 0, $protectedBytes.Length) }
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Variable plain -ErrorAction SilentlyContinue
}
