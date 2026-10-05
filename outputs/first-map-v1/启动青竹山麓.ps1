$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    $gameNode = $nodeCommand.Source
} else {
    $gameNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if (-not (Test-Path -LiteralPath $gameNode)) {
        throw '请先安装 Node.js，再运行本脚本。'
    }
}
Write-Host '我的修仙日记 · 青竹山麓'
Write-Host '启动后打开 http://127.0.0.1:4177/first-map-v1/index.html'
Write-Host '按 Ctrl+C 停止本地服务。'
& $gameNode (Join-Path $PSScriptRoot 'server.mjs')
