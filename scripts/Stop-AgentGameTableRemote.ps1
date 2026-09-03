<#
.SYNOPSIS
    關閉本機 Agent Game Table Remote MCP，保留加密牌桌 volume。

.DESCRIPTION
    使用 docker compose down 移除容器與 Compose network，降低平常未使用時的攻擊面。
    腳本不傳入 --volumes，因此加密牌桌狀態會保留供下次啟動恢復。

.PARAMETER EnvironmentFile
    相對於 repo 根目錄或絕對路徑的 dotenv 設定檔。

.PARAMETER ComposeFile
    相對於 repo 根目錄或絕對路徑的 Compose 檔案。

.EXAMPLE
    .\scripts\Stop-AgentGameTableRemote.ps1

.EXAMPLE
    .\scripts\Stop-AgentGameTableRemote.ps1 -WhatIf
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter()]
    [string]$EnvironmentFile = ".env.remote",

    [Parameter()]
    [string]$ComposeFile = "compose.remote.yml"
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

try {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath ".."))
    $environmentPath = Resolve-RepoPath -Path $EnvironmentFile -RepoRoot $repoRoot
    $composePath = Resolve-RepoPath -Path $ComposeFile -RepoRoot $repoRoot
    if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
        throw "找不到環境設定檔：$environmentPath"
    }
    if (-not (Test-Path -LiteralPath $composePath -PathType Leaf)) {
        throw "找不到 Compose 檔案：$composePath"
    }

    & docker info --format "{{.ServerVersion}}" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[-] Docker daemon 未啟動，Agent Game Table Remote MCP 已經不在執行。" -ForegroundColor DarkGray
        return
    }
    if (-not $PSCmdlet.ShouldProcess("agent-game-table-remote Compose project", "移除容器與 network，保留牌桌 volume")) {
        return
    }

    $arguments = @(
        "compose", "--env-file", $environmentPath, "-f", $composePath,
        "down", "--remove-orphans"
    )
    & docker @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose down 執行失敗。"
    }

    Write-Host "[OK] Agent Game Table Remote MCP 已關閉；加密牌桌 volume 保留。" -ForegroundColor Green
    Write-Host "[i] 容器已移除，因此平常不會留著含 secrets 的 container metadata。" -ForegroundColor Cyan
} catch {
    Write-Error "關閉 Agent Game Table Remote MCP 失敗：$($_.Exception.Message)"
    exit 1
}
