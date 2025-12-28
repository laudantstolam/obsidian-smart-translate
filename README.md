# Smart Translator for Obsidian

Intelligent translation plugin using DeepL API with smart content protection.

[繁體中文版本](#繁體中文說明) | [English Version](#english-version)

---

## English Version

### Main Features

- **Intelligent Translation**: Auto-selects OpenCC (offline) for Traditional Chinese, DeepL for other languages
- **Smart Protection**: Always preserves code, links, tables, Obsidian syntax, file paths, and technical keywords
- **Table Support**: Translate table content while keeping structure intact
- **Multiple Languages**: Traditional Chinese, Simplified Chinese, English, French, German, Japanese
- **Flexible Usage**: Full page or selection translation with right-click menu or command palette
- **Connection Test**: Built-in API connection testing with detailed logging
- **No API for Chinese**: Traditional Chinese conversion uses OpenCC offline (no DeepL API needed)

### Protected Content

- **Code**: Blocks (` ``` `) and inline (`` ` ``)
- **Tables**: Pipe characters (`|`) and separator rows preserved
- **Obsidian**: Wikilinks (`[[note]]`), embeds (`![[image]]`), callouts (`>[!note]`)
- **Metadata**: Tags (`#tag`), block references (`^block-id`)
- **Links**: Markdown (`[text](url)`), HTML tags
- **Paths**: Windows (`C:\...`), Unix (`/...`), Relative (`./...`)
- **Keywords**: Customizable technical terms (API, SDK, REST, etc.)

### Installation

#### From Community Plugins (Recommended)
1. Open Obsidian Settings → Community Plugins
2. Search "Smart Translator"
3. Click Install → Enable

#### Manual Installation
1. Download latest release from [GitHub Releases](https://github.com/your-repo/releases)
2. Extract to `.obsidian/plugins/smart-translator/`
3. Enable in Obsidian Settings → Community Plugins

### Setup

1. Get DeepL API key from [deepl.com/pro-api](https://www.deepl.com/pro-api)
2. Open plugin settings in Obsidian
3. Enter your API key and select type (Free/Pro)
4. Click **"Test Connection"** to verify setup
5. Set default target language and customize technical keywords

### Usage

#### Method 1: Right-Click Menu
1. Select text in your note
2. Right-click → **"Translate to [Default Language]"**
3. Automatically uses OpenCC for Traditional Chinese, DeepL for others

#### Method 2: Command Palette - Default Language
- **Full Page**: `Ctrl+P` → **"Translate: Full Page → [Default Language]"**
- **Section**: `Ctrl+P` → **"Translate: Section → [Default Language]"**

#### Method 3: Command Palette - Traditional Chinese (OpenCC)
- **Full Page**: `Ctrl+P` → **"Translate: Full Page → ZH-HANT"** (offline, no API needed)
- **Section**: `Ctrl+P` → **"Translate: Section → ZH-HANT"** (offline, no API needed)

### Table Translation

**Always Preserved**: Table structure (pipes and separators) is automatically protected in all translations

**Full Table**: Select entire table → Use any translate command → Structure preserved
**Partial Selection**: Select specific rows/columns → Use any translate command → Only selected content translated

**Example:**
```markdown
Before:
| Feature | Description |
| ------- | ----------- |
| Login   | User authentication |

After (to Traditional Chinese):
| 功能 | 說明 |
| ------- | ----------- |
| 登入   | 用戶身份驗證 |
```

**How It Works**: The plugin automatically protects all Obsidian syntax, code blocks, links, file paths, and technical keywords in both full page and selection translations.

### Supported Languages

| Code | Language |
|------|----------|
| ZH-HANT | Traditional Chinese (Taiwan) |
| ZH | Simplified Chinese |
| EN | English |
| FR | French |
| DE | German |
| JA | Japanese |

### Configuration

**Plugin Settings**:
- **DeepL API Key**: Your authentication key
- **API Type**: Free or Pro account
- **Test Connection**: Verify API setup with one click
- **Default Target Language**: Language for translations
- **Technical Keywords**: Comma-separated terms to preserve (e.g., `API, SDK, REST, HTTP, JSON`)

### Examples

**Code Protection:**
```
Input: The API endpoint is `https://api.example.com/v2/users`
Output: API 端點位於 `https://api.example.com/v2/users`
```

**Link Protection:**
```
Input: See [[Documentation|docs]] for more info
Output: 更多資訊請見 [[Documentation|docs]]
```

**Keyword Protection:**
```
Input: The REST API returns JSON responses
Output: REST API 返回 JSON 回應
```

### Commands

| Command | Description |
|---------|-------------|
| `Translate: Full Page → [Default Language]` | Translate entire note to default language (auto-selects OpenCC/DeepL) |
| `Translate: Section → [Default Language]` | Translate selected text to default language (auto-selects OpenCC/DeepL) |
| `Translate: Full Page → ZH-HANT` | Translate entire note to Traditional Chinese using OpenCC (offline, no API) |
| `Translate: Section → ZH-HANT` | Translate selected text to Traditional Chinese using OpenCC (offline, no API) |

**Note**:
- When target language is Traditional Chinese (ZH-HANT), OpenCC is used automatically (no API needed). For other languages, DeepL API is used.
- Command names showing `[Default Language]` will update when you change the default language setting (requires reloading Obsidian)

### Support

- Issues: [GitHub Issues](https://github.com/your-repo/issues)
- Documentation: [Wiki](https://github.com/your-repo/wiki)

---

## 繁體中文說明

### 主要功能

- **智慧翻譯**：繁體中文自動使用 OpenCC（離線），其他語言使用 DeepL
- **智慧保護**：自動保留程式碼、連結、表格、Obsidian 語法、檔案路徑和技術關鍵字
- **表格支援**：翻譯表格內容同時保持結構完整
- **多語言支援**：繁體中文、簡體中文、英文、法文、德文、日文
- **靈活使用**：全頁或選取翻譯，支援右鍵選單與命令面板
- **連線測試**：內建 API 連線測試與詳細日誌
- **中文免 API**：繁體中文轉換使用 OpenCC 離線處理（無需 DeepL API）

### 保護內容

- **程式碼**：程式碼區塊（` ``` `）和行內程式碼（`` ` ``）
- **表格**：管道符號（`|`）和分隔行保持完整
- **Obsidian**：Wikilinks（`[[筆記]]`）、嵌入（`![[圖片]]`）、標註框（`>[!note]`）
- **元資料**：標籤（`#標籤`）、區塊引用（`^block-id`）
- **連結**：Markdown（`[文字](url)`）、HTML 標籤
- **路徑**：Windows（`C:\...`）、Unix（`/...`）、相對路徑（`./...`）
- **關鍵字**：可自訂技術術語（API、SDK、REST 等）

### 安裝方式

#### 從社群外掛安裝（推薦）
1. 開啟 Obsidian 設定 → 社群外掛
2. 搜尋「Smart Translator」
3. 點擊安裝 → 啟用

#### 手動安裝
1. 從 [GitHub Releases](https://github.com/your-repo/releases) 下載最新版本
2. 解壓縮到 `.obsidian/plugins/smart-translator/`
3. 在 Obsidian 設定 → 社群外掛中啟用

### 設定步驟

1. 從 [deepl.com/pro-api](https://www.deepl.com/pro-api) 取得 DeepL API 金鑰
2. 開啟外掛設定
3. 輸入 API 金鑰並選擇類型（免費/專業版）
4. 點擊「測試連線」驗證設定
5. 設定預設目標語言並自訂關鍵字

### 使用方法

#### 方法 1：右鍵選單
1. 在筆記中選取文字
2. 右鍵選單 → **「Translate to [預設語言]」**
3. 繁體中文自動使用 OpenCC，其他語言使用 DeepL

#### 方法 2：命令面板 - 預設語言
- **全頁翻譯**：`Ctrl+P` → **「Translate: Full Page → [預設語言]」**
- **選取翻譯**：`Ctrl+P` → **「Translate: Section → [預設語言]」**

#### 方法 3：命令面板 - 繁體中文（OpenCC）
- **全頁翻譯**：`Ctrl+P` → **「Translate: Full Page → ZH-HANT」**（離線，無需 API）
- **選取翻譯**：`Ctrl+P` → **「Translate: Section → ZH-HANT」**（離線，無需 API）

### 表格翻譯

**自動保護**：所有翻譯中表格結構（管道符號和分隔線）會自動保護

**完整表格**：選取整個表格 → 使用任何翻譯指令 → 結構保留
**部分選取**：選取特定行/列 → 使用任何翻譯指令 → 僅翻譯選取內容

**範例：**
```markdown
翻譯前：
| Feature | Description |
| ------- | ----------- |
| Login   | User authentication |

翻譯後（轉繁體中文）：
| 功能 | 說明 |
| ------- | ----------- |
| 登入   | 用戶身份驗證 |
```

**運作方式**：外掛會自動保護所有 Obsidian 語法、程式碼區塊、連結、檔案路徑和技術關鍵字，無論是全頁或選取翻譯。

### 支援語言

| 代碼 | 語言 |
|------|------|
| ZH-HANT | 繁體中文（台灣） |
| ZH | 簡體中文 |
| EN | 英文 |
| FR | 法文 |
| DE | 德文 |
| JA | 日文 |

### 設定選項

**可調整項目**：
- DeepL API 金鑰
- API 類型（免費/專業版）
- 預設目標語言
- 技術關鍵字（逗號分隔）

### 範例

**翻譯前**：
```
Check the API at `https://api.example.com`. See [[Documentation]] for details.
```

**翻譯後**（翻成中文）：
```
檢查位於 `https://api.example.com` 的 API。詳情請見 [[Documentation]]。
```

### 指令

| 指令 | 說明 |
|------|------|
| `Translate: Full Page → [預設語言]` | 翻譯整個筆記為預設語言（自動選擇 OpenCC/DeepL） |
| `Translate: Section → [預設語言]` | 翻譯選取文字為預設語言（自動選擇 OpenCC/DeepL） |
| `Translate: Full Page → ZH-HANT` | 翻譯整個筆記為繁體中文，使用 OpenCC（離線，無需 API） |
| `Translate: Section → ZH-HANT` | 翻譯選取文字為繁體中文，使用 OpenCC（離線，無需 API） |

**注意**：
- 當目標語言為繁體中文（ZH-HANT）時，會自動使用 OpenCC（無需 API）。其他語言則使用 DeepL API。
- 顯示「[預設語言]」的指令名稱會在您更改預設語言設定後更新（需要重新載入 Obsidian）

### 支援

- 問題回報：[GitHub Issues](https://github.com/your-repo/issues)
- 文件說明：[Wiki](https://github.com/your-repo/wiki)

---

## License

MIT License

## Credits

- [DeepL API](https://www.deepl.com/) - Translation service
- [OpenCC](https://github.com/BYVoid/OpenCC) - Chinese character conversion
