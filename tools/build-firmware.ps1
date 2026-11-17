# 职责：将固件同步到英文目录，避免 Windows 工具链错误解析中文路径。
param(
    # 已安装 ESP-IDF 的激活脚本。
    [string]$ActivationScript = 'C:\Espressif\tools\Microsoft.v6.1.PowerShell_profile.ps1',
    # 必须是独立英文目录，不能指向用户其他工程。
    [string]$BuildDirectory = 'D:\esp\codex-alert-work'
)
$ErrorActionPreference = 'Stop'
# 源码位于当前项目；只复制，不删除编译目录中的文件。
$projectRoot = Split-Path $PSScriptRoot -Parent
$source = Join-Path $projectRoot 'firmware'
if ($BuildDirectory -match '[^\x00-\x7F]|\s') { throw '编译目录不能含中文或空格。' }
if (Test-Path -LiteralPath $BuildDirectory) {
    $existingProject = Join-Path $BuildDirectory 'CMakeLists.txt'
    if ((Test-Path -LiteralPath $existingProject) -and (Get-Content -LiteralPath $existingProject -Raw) -notmatch 'project\(codex_alert\)') {
        throw '目标目录已有其他工程，停止复制。'
    }
}
New-Item -ItemType Directory -Path $BuildDirectory -Force | Out-Null
robocopy $source $BuildDirectory /E /XD build /XF sdkconfig sdkconfig.old /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw '同步固件源码失败。' }
$env:PYTHONUTF8 = '1'
. $ActivationScript
idf.py -C $BuildDirectory build
if ($LASTEXITCODE -ne 0) { throw '固件构建失败。' }
Write-Host "构建完成：$BuildDirectory\build\codex_alert.bin"
