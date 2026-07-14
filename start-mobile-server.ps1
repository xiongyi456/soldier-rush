param(
  [int]$Port = 8080
)

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
  Write-Error "没有找到 Node.js/npm。请先安装 Node.js，然后在本目录运行 npm install。"
  exit 1
}

if (-not (Test-Path -LiteralPath "$PSScriptRoot\node_modules")) {
  Write-Host "首次运行，正在安装依赖…" -ForegroundColor Yellow
  & $npm.Source install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  Select-Object -ExpandProperty IPAddress -Unique

Write-Host ""
Write-Host "手机和电脑连接同一个 Wi-Fi 后，在手机浏览器打开：" -ForegroundColor Green
foreach ($address in $addresses) {
  Write-Host "  http://${address}:$Port"
}
Write-Host ""
Write-Host "本机地址：http://localhost:$Port"
Write-Host "按 Ctrl+C 停止服务器。首次运行时请允许 Windows 防火墙访问专用网络。"
Write-Host ""

& $npm.Source run dev -- --host 0.0.0.0 --port $Port
