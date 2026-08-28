$ErrorActionPreference = "Stop"

$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$SourceRefs = @{}
foreach ($Line in Get-Content (Join-Path $PSScriptRoot "source-refs.env")) {
    $TrimmedLine = $Line.Trim()
    if (-not $TrimmedLine -or $TrimmedLine.StartsWith("#")) {
        continue
    }
    $Name, $Value = $TrimmedLine.Split("=", 2)
    $SourceRefs[$Name] = $Value
}

$YetiRef = $SourceRefs["YETI_REF"]
$FrontendRef = $SourceRefs["YETI_FEEDS_FRONTEND_REF"]
if ($YetiRef -notmatch "^[0-9a-f]{40}$") {
    throw "YETI_REF must be a full Git commit SHA"
}
if ($FrontendRef -notmatch "^[0-9a-f]{40}$") {
    throw "YETI_FEEDS_FRONTEND_REF must be a full Git commit SHA"
}

function Prepare-Repository([string]$Repository, [string]$PinnedRef) {
    $Target = Join-Path $WorkspaceRoot $Repository
    $GitMetadata = Join-Path $Target ".git"
    if (Test-Path $GitMetadata) {
        $CurrentRef = (& git -C $Target rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to resolve the existing $Repository checkout: $Target"
        }
        if ($CurrentRef -eq $PinnedRef) {
            Write-Host "present: $Repository ($CurrentRef)"
        } else {
            Write-Warning "Existing $Repository checkout is at $CurrentRef; pinned ref is $PinnedRef; leaving it unchanged"
        }
    } elseif (Test-Path $Target) {
        throw "Refusing to overwrite non-repository path: $Target"
    } else {
        & git clone "https://github.com/yeti-platform/$Repository.git" $Target
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to clone $Repository"
        }
        & git -C $Target checkout --detach $PinnedRef
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to check out pinned $Repository ref $PinnedRef"
        }
    }
}

Prepare-Repository "yeti" $YetiRef
Prepare-Repository "yeti-feeds-frontend" $FrontendRef

$BackendConfig = Join-Path $WorkspaceRoot "yeti/yeti.conf"
if (-not (Test-Path $BackendConfig)) {
    Copy-Item (Join-Path $WorkspaceRoot "yeti/yeti.conf.sample") $BackendConfig
}

docker compose -f (Join-Path $PSScriptRoot "docker-compose.yaml") up
if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose failed"
}
