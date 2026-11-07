# LocalFlow smoke checks (no GUI automation).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "== cargo test =="
Push-Location src-tauri
$env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"
cargo test --quiet
Pop-Location

Write-Host "== frontend typecheck =="
npm run build

$nsis = Get-ChildItem "src-tauri\target\release\bundle\nsis\*.exe" -ErrorAction SilentlyContinue
if ($nsis) {
  Write-Host "NSIS installer(s):"
  $nsis | ForEach-Object { Write-Host " - $($_.FullName) ($([math]::Round($_.Length/1MB,1)) MB)" }
} else {
  Write-Host "No NSIS installer found yet (run npm run tauri build)."
}

Write-Host "Smoke checks finished."
