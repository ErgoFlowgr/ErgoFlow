while ($true) {
    Set-Location "D:\Projects\ErgoFlow\Claude\crm-app"
    git add -A
    $changes = git diff --cached --name-only
    if ($changes) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
        git commit -m "auto-save $timestamp"
    }
    Start-Sleep -Seconds 300
}
