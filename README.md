# Paperback Reader

本地桌面小说阅读器 MVP。核心范围是本地书库、TXT/DOC/DOCX 导入、自动目录、单页分页阅读、排版台和阅读进度恢复。

## Run

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:1420/` 可先用浏览器预览。浏览器预览使用文件选择器导入本地文件。

## Desktop

```bash
npm run tauri -- dev
npm run tauri -- build
```

Tauri 桌面模式使用原生文件对话框和本地文件系统插件。第一次构建需要从 crates.io 下载 Rust 依赖。

## Current Scope

- 支持 `.txt` 和 `.docx` 正文解析。
- `.doc` 作为兼容入口处理，失败时显示清晰提示，建议转换为 `.docx` 或 `.txt`。
- 支持目录导入：一个目录里的多个 `.txt` 会按文件名自然排序合并为一本书。
- 本地数据保存在 WebView 的 IndexedDB 中，不上传服务器。
- EPUB、云同步、账号、批注、全文搜索不在第一版。

## Import Strategy

- 导入文件：适合单个完整小说文件，支持 TXT、DOCX、DOC。
- 导入目录：适合分章 TXT。目录名作为书名，每个 TXT 作为一个章节。
- 目录导入优先读取当前目录这一层；如果根目录包含 `chapters/` 子目录，会自动读取 `chapters/*.txt`。
- 如果根目录包含 `directory.json`，会用它校准章节标题，并提示完整目录与已导入章节数。
- 文件名按自然顺序排序，所以 `2.txt` 会排在 `10.txt` 前面。
- 如果 TXT 文件名只是数字，或类似 `0001_41550.txt`，章节标题会优先使用 `directory.json` 或正文第一段。
