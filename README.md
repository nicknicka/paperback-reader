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

## Import Rules

Paperback Reader 支持两种导入方式：导入单个文件，或导入一个由多个 TXT 文件组成的目录。导入完成后，正文会被解析为应用内部书籍数据并保存到本地 IndexedDB；阅读不依赖原文件路径、账号或服务器。

### File Import

文件导入适合一本小说已经在单个文件里的场景。

支持格式：

- `.txt`
- `.docx`
- `.doc`

规则：

- `.txt` 会自动尝试 `utf-8`、`gb18030`、`gbk` 编码。
- `.docx` 会提取纯文本内容，不保留 Word 原始排版样式。
- `.doc` 是兼容入口；当前版本不承诺成功解析，失败时会提示转换为 `.docx` 或 `.txt`。
- 文件名会作为默认书名，例如 `我的小说.txt` 会导入为 `我的小说`。
- 导入后会自动识别章节标题；如果章节不足以识别，会按正文位置生成目录。

章节标题识别示例：

```text
第1章 开始
第一章 开始
序章
楔子
尾声
番外 他的故事
Chapter 1 The Beginning
```

### Directory Import

目录导入适合一章一个 TXT 文件的分章小说。

基础要求：

- 目录内必须包含至少一个 `.txt` 文件。
- 每个 `.txt` 文件会被导入为一个章节。
- 目录名会作为默认书名。
- 文件按自然顺序排序，所以 `2.txt` 会排在 `10.txt` 前面。
- 当前目录导入只支持 TXT，不支持目录内的 DOC/DOCX。

推荐格式：

```text
小说名/
  第001章.txt
  第002章.txt
  第003章.txt
```

或：

```text
小说名/
  1.txt
  2.txt
  10.txt
```

Tauri 桌面端还支持 `chapters/` 子目录作为兼容路径。如果根目录没有 TXT，但存在 `chapters/`，会读取 `chapters/*.txt`：

```text
小说名/
  chapters/
    0001_41550.txt
    0002_41551.txt
```

### Optional Directory Manifest

目录根路径可以包含一个可选的 `directory.json`，用于校准章节标题和完整章节数量。

格式：

```json
[
  {
    "order": 1,
    "title": "第1章 开始",
    "chapter_id": "41550"
  },
  {
    "order": 2,
    "title": "第2章 远行",
    "chapter_id": "41551"
  }
]
```

文件名匹配规则：

```text
{order补4位}_{chapter_id}.txt
```

例如：

```text
0001_41550.txt
0002_41551.txt
```

如果 TXT 文件名只是数字，或类似 `0001_41550.txt`，章节标题会优先使用 `directory.json`；没有 manifest 时，会优先使用正文第一段作为章节标题。
