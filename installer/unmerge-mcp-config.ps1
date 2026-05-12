# Idempotently REMOVE the mcp-midi-tools entry from Claude Desktop's
# claude_desktop_config.json files. Called from the Inno Setup uninstaller.
#
# Walks the same candidate locations as merge-mcp-config.ps1. If a config
# file exists, removes our entry from mcpServers but leaves any other
# user-configured MCP servers intact.
#
# Exit codes:
#   0  = ran (regardless of whether anything was removed)
#   2  = unexpected error

$ErrorActionPreference = 'Stop'

$candidates = @(
    (Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'),
    (Join-Path $env:LOCALAPPDATA 'Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json')
)

foreach ($configPath in $candidates) {
    if (-not (Test-Path $configPath)) {
        continue
    }

    try {
        $raw = Get-Content -Path $configPath -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) {
            continue
        }
        $config = $raw | ConvertFrom-Json
    } catch {
        Write-Warning "Could not parse $configPath; leaving it untouched."
        continue
    }

    if (-not ($config.PSObject.Properties.Name -contains 'mcpServers') -or $null -eq $config.mcpServers) {
        continue
    }

    if ($config.mcpServers.PSObject.Properties.Name -notcontains 'mcp-midi-tools') {
        continue
    }

    $config.mcpServers.PSObject.Properties.Remove('mcp-midi-tools')

    $json = $config | ConvertTo-Json -Depth 32
    [System.IO.File]::WriteAllText($configPath, $json, [System.Text.UTF8Encoding]::new($false))

    Write-Host "Removed mcp-midi-tools entry from $configPath"
}

exit 0
