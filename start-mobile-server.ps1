param(
  [int]$Port = 8080
)

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  $python = Get-Command py -ErrorAction SilentlyContinue
}

if (-not $python) {
  Write-Error "没有找到 Python。请安装 Python，或把本目录上传到任意静态网站托管服务。"
  exit 1
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

if ($python.Name -eq "py.exe") {
  & $python.Source -m http.server $Port --bind 0.0.0.0
} else {
  & $python.Source -m http.server $Port --bind 0.0.0.0
}
