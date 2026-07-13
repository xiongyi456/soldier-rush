# 士兵冲锋 3D：手机运行说明

游戏现已支持手机浏览器触控、响应式界面和桌面安装（PWA）。手机不能直接打开电脑硬盘里的 `index.html`，需要通过网页服务器访问。

## 在同一 Wi-Fi 下试玩

1. 在本目录右键 `start-mobile-server.ps1`，选择“使用 PowerShell 运行”。
2. 如果系统询问防火墙权限，只允许“专用网络”即可。
3. 让手机和电脑连接同一个 Wi-Fi。
4. 在手机浏览器中打开脚本显示的地址，例如 `http://192.168.1.5:8080`。

也可以在 PowerShell 中运行：

```powershell
./start-mobile-server.ps1
```

如果 PowerShell 阻止脚本，可在本目录直接运行：

```powershell
python -m http.server 8080 --bind 0.0.0.0
```

## 发给其他人玩

把整个目录部署到任意支持 HTTPS 的静态网站服务即可，例如 GitHub Pages、Cloudflare Pages、Netlify 或自己的服务器。必须同时上传：

- `index.html`
- `three.min.js`
- `manifest.webmanifest`
- `service-worker.js`
- `icon.svg`

通过 HTTPS 打开后，Android Chrome 会提供“安装到手机桌面”；iPhone Safari 可使用“分享 → 添加到主屏幕”。首次联网加载完成后，安装版可离线启动。

## 操作方式

- 手机：按住游戏画面，左右滑动移动小队。
- 电脑：方向键、A/D 或鼠标拖动。
