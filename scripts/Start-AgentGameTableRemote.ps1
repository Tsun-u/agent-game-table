<#
.SYNOPSIS
    安全啟動本機 Agent Game Table Remote MCP Docker Compose 服務。

.DESCRIPTION
    驗證 Remote 設定、朋友專用 Bearer keys 與 Docker daemon，然後啟動單一 Agent Game Table 容器。
    容器只綁定 127.0.0.1，供既有 Cloudflare Tunnel 轉送；加密牌桌保存在 Docker volume。

.PARAMETER EnvironmentFile
    相對於 repo 根目錄或絕對路徑的 dotenv 設定檔。

.PARAMETER ComposeFile
    相對於 repo 根目錄或絕對路徑的 Compose 檔案。

.PARAMETER NoBuild
    不重新建置 image，直接使用目前的 agent-game-table-remote:local。

.EXAMPLE
    .\scripts\Start-AgentGameTableRemote.ps1

.EXAMPLE
    .\scripts\Start-AgentGameTableRemote.ps1 -NoBuild -WhatIf
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter()]
    [string]$EnvironmentFile = ".env.remote",

    [Parameter()]
    [string]$ComposeFile = "compose.remote.yml",

    [Parameter()]
    [switch]$NoBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-RepoPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$RepoRoot
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path -Path $RepoRoot -ChildPath $Path))
}

function Get-DotEnvValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $pattern = "^\s*" + [regex]::Escape($Name) + "\s*=\s*(.*)\s*$"
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match $pattern) {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

function Invoke-Docker {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker $($Arguments -join ' ') 執行失敗。"
    }
}

try {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath ".."))
    $environmentPath = Resolve-RepoPath -Path $EnvironmentFile -RepoRoot $repoRoot
    $composePath = Resolve-RepoPath -Path $ComposeFile -RepoRoot $repoRoot

    if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
        throw "找不到 $environmentPath。請先複製 .env.remote.example 為 .env.remote 並填入真正 secrets。"
    }
    if (-not (Test-Path -LiteralPath $composePath -PathType Leaf)) {
        throw "找不到 Compose 檔案：$composePath"
    }

    $publicUrl = Get-DotEnvValue -Path $environmentPath -Name "AGENT_GAME_TABLE_PUBLIC_URL"
    $stateKey = Get-DotEnvValue -Path $environmentPath -Name "AGENT_GAME_TABLE_STATE_KEY"
    $managementKey = Get-DotEnvValue -Path $environmentPath -Name "AGENT_GAME_TABLE_HUMAN_ACCESS_KEY"
    $keysSetting = Get-DotEnvValue -Path $environmentPath -Name "AGENT_GAME_TABLE_REMOTE_KEYS_PATH"
    if (-not $keysSetting) { $keysSetting = "./data/remote-keys.json" }
    $keysPath = Resolve-RepoPath -Path $keysSetting -RepoRoot $repoRoot

    if (-not $publicUrl -or -not $publicUrl.StartsWith("https://", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "AGENT_GAME_TABLE_PUBLIC_URL 必須是 Cloudflare Tunnel 對外提供的 HTTPS URL。"
    }
    if (-not $stateKey -or $stateKey.StartsWith("replace-")) {
        throw "AGENT_GAME_TABLE_STATE_KEY 尚未設定。請使用 npm run generate:remote-secrets 產生。"
    }
    if (-not $managementKey -or $managementKey.Length -lt 32 -or $managementKey.StartsWith("replace-")) {
        throw "AGENT_GAME_TABLE_HUMAN_ACCESS_KEY 必須是至少 32 字元的真正營運管理密碼。"
    }
    if (-not (Test-Path -LiteralPath $keysPath -PathType Leaf)) {
        throw "找不到 Agent keys：$keysPath"
    }

    $keyEntries = Get-Content -LiteralPath $keysPath -Raw | ConvertFrom-Json
    $keyProperties = @($keyEntries.PSObject.Properties)
    if ($keyProperties.Count -eq 0) {
        throw "remote-keys.json 至少要有一位朋友的 Bearer token。"
    }
    $seenTokens = @{}
    foreach ($property in $keyProperties) {
        $tokenValue = [string]$property.Value
        if ([string]::IsNullOrWhiteSpace($property.Name) -or [string]::IsNullOrWhiteSpace($tokenValue) -or $tokenValue.Length -lt 32) {
            throw "remote-keys.json 的每個名稱都必須對應至少 32 字元的不同 token。"
        }
        if ($seenTokens.ContainsKey($tokenValue)) {
            throw "remote-keys.json 不可讓兩位朋友共用同一組 token。"
        }
        $seenTokens[$tokenValue] = $true
    }

    & docker info --format "{{.ServerVersion}}" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Desktop daemon 尚未啟動。"
    }

    $composeBase = @("compose", "--env-file", $environmentPath, "-f", $composePath)
    Invoke-Docker -Arguments ($composeBase + @("config", "--quiet"))
    $action = if ($NoBuild) { "啟動 Agent Game Table Remote MCP" } else { "建置並啟動 Agent Game Table Remote MCP" }
    if (-not $PSCmdlet.ShouldProcess("$publicUrl（本機 127.0.0.1）", $action)) {
        return
    }

    $upArguments = $composeBase + @("up", "-d")
    if (-not $NoBuild) { $upArguments += "--build" }
    Invoke-Docker -Arguments $upArguments

    $containerId = [string](& docker @($composeBase + @("ps", "-q", "agent-game-table")) | Select-Object -First 1)
    $containerId = $containerId.Trim()
    if (-not $containerId) {
        throw "Compose 沒有建立 Agent Game Table 容器。"
    }

    $health = ""
    for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
        $health = (& docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $containerId).Trim()
        if ($health -eq "healthy") { break }
        if ($health -eq "exited" -or $health -eq "dead") { break }
        Start-Sleep -Milliseconds 500
    }
    if ($health -ne "healthy") {
        & docker @($composeBase + @("logs", "--tail", "80", "agent-game-table"))
        throw "Agent Game Table 容器沒有通過 healthcheck（狀態：$health）。"
    }

    Write-Host "[OK] Agent Game Table Remote MCP 已啟動：$publicUrl" -ForegroundColor Green
    Write-Host "[i] Docker 僅監聽 127.0.0.1；Cloudflare Tunnel 負責公開 HTTPS。" -ForegroundColor Cyan
    Write-Host "[i] Agent keys：$($keyProperties.Count) 組。" -ForegroundColor Cyan
} catch {
    Write-Error "啟動 Agent Game Table Remote MCP 失敗：$($_.Exception.Message)"
    exit 1
}
