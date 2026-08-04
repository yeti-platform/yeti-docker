$ErrorActionPreference = "Stop"

$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path

function Clone-IfMissing([string]$Repository) {
    $Target = Join-Path $WorkspaceRoot $Repository
    $GitMetadata = Join-Path $Target ".git"
    if (Test-Path $GitMetadata) {
        Write-Host "present: $Repository"
    } elseif (Test-Path $Target) {
        throw "Refusing to overwrite non-repository path: $Target"
    } else {
        git clone "https://github.com/yeti-platform/$Repository.git" $Target
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to clone $Repository"
        }
    }
}

Clone-IfMissing "yeti"
Clone-IfMissing "yeti-feeds-frontend"

$BackendConfig = Join-Path $WorkspaceRoot "yeti/yeti.conf"
if (-not (Test-Path $BackendConfig)) {
    Copy-Item (Join-Path $WorkspaceRoot "yeti/yeti.conf.sample") $BackendConfig
}

docker compose -f (Join-Path $PSScriptRoot "docker-compose.yaml") up
if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose failed"
}
