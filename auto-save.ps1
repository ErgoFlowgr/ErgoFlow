Write-Host "Auto-save started. Press Ctrl+C to stop." -ForegroundColor Green
while ($true) {
    Set-Location "D:\Claude\crm-app"
    git add -A
    $changes = git diff --cached --name-only
    if ($changes) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
        git commit -m "auto-save $timestamp"
        Write-Host "[$timestamp] Saved: $($changes -join ', ')" -ForegroundColor Cyan
    }
    Start-Sleep -Seconds 300
}
