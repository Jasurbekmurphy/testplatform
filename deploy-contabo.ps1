# Uploads this folder to the Contabo server and restarts the site. Data on the server is kept.
# Usage (PowerShell, in this folder):  .\deploy-contabo.ps1
$ErrorActionPreference = "Stop"
$server = "root@13.140.188.11"
$key = "$env:USERPROFILE\.ssh\texnikum_contabo"
$tgz = Join-Path $env:TEMP "tt.tgz"
tar.exe -czf $tgz --exclude=node_modules --exclude=data --exclude=.git --exclude=*.db --exclude=deploy-contabo.ps1 -C $PSScriptRoot .
scp -i $key $tgz "${server}:/opt/texnikum-test/tt.tgz"
ssh -i $key $server "sh /opt/texnikum-test/deploy.sh"
Remove-Item $tgz
Write-Host "Tayyor: https://testplatform.13-140-188-11.sslip.io"
