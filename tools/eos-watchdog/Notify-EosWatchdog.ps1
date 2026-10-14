[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AlertPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $AlertPath)) {
    throw "Watchdog alert not found: $AlertPath"
}

$alert = Get-Content -LiteralPath $AlertPath -Raw | ConvertFrom-Json
$title = ([string]$alert.title -replace '[\r\n]+', ' ').Trim()
$message = ([string]$alert.message -replace '[\r\n]+', ' ').Trim()
$body = "EOS watchdog: $($alert.status) - $title"
if (-not [string]::IsNullOrWhiteSpace($message)) {
    $body += "`n$message"
}
if (-not [string]::IsNullOrWhiteSpace([string]$alert.reference)) {
    $body += "`n$($alert.reference)"
}

try {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

    $escapedTitle = [System.Security.SecurityElement]::Escape("EOS watchdog: $($alert.status)")
    $escapedBody = [System.Security.SecurityElement]::Escape($body)
    $toastXml = [Windows.Data.Xml.Dom.XmlDocument]::new()
    $toastXml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$escapedTitle</text><text>$escapedBody</text></binding></visual></toast>")
    $toast = [Windows.UI.Notifications.ToastNotification]::new($toastXml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Taylor Parts EOS Watchdog').Show($toast)
}
catch {
    Write-Warning "Windows toast notification failed. Alert remains at $AlertPath. $($_.Exception.Message)"
}
