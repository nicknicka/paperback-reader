# Paperback Reader 安装指南

本文说明如何从 GitHub Actions 下载并安装 Paperback Reader 的 macOS 和 Windows 桌面安装包。

## 下载安装包

1. 打开 GitHub Actions 页面：

   https://github.com/nicknicka/paperback-reader/actions

2. 进入最新的 `Build Desktop Installers` 构建任务。

3. 在页面底部找到 `Artifacts`。

4. 按系统下载对应文件：

   - macOS：`paperback-reader-macos`
   - Windows：`paperback-reader-windows`

5. 下载后先解压 artifact 压缩包。

## macOS 安装

1. 解压 `paperback-reader-macos`。

2. 找到 `.dmg` 文件，例如：

   ```text
   Paperback Reader_0.1.0_aarch64.dmg
   ```

3. 双击打开 `.dmg`。

4. 将 `Paperback Reader.app` 拖到 `Applications` 文件夹。

5. 第一次打开时，如果 macOS 提示无法验证开发者：

   ```text
   右键 Paperback Reader.app -> 打开 -> 打开
   ```

   或进入：

   ```text
   系统设置 -> 隐私与安全性 -> 仍要打开
   ```

说明：当前应用没有 Apple Developer 签名，所以 macOS 第一次打开时可能会拦截，这是正常现象。

## Windows 安装

1. 解压 `paperback-reader-windows`。

2. 找到 `.msi` 或 `.exe` 安装包。

3. 双击安装。

4. 如果 Windows SmartScreen 提示未知发布者：

   ```text
   更多信息 -> 仍要运行
   ```

说明：当前应用没有 Windows 代码签名证书，所以 SmartScreen 可能会提示未知发布者，这是正常现象。

## 开发模式运行

如果不安装桌面包，也可以在本地以开发模式运行。

```bash
git clone git@github.com:nicknicka/paperback-reader.git
cd paperback-reader
npm install
npm run tauri dev
```

Windows 开发环境需要提前安装：

- Node.js
- Rust
- Microsoft C++ Build Tools
- WebView2 Runtime

## 重新打包

在本机打包当前系统对应的安装包：

```bash
npm run tauri build
```

macOS 会生成 `.app` 和 `.dmg`，Windows 会生成 `.msi` 或 `.exe`。不同系统需要在对应平台上打包，macOS 不能直接生成可用的 Windows 安装包。
