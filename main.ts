import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, Menu, requestUrl } from 'obsidian';
import * as OpenCC from 'opencc-js';

// --- 設定介面定義 ---
interface MyPluginSettings {
	deepLApiKey: string;
	deepLApiType: 'free' | 'pro';
	defaultTargetLang: string;
	technicalKeywords: string; // 逗號分隔的技術關鍵字清單
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	deepLApiKey: '',
	deepLApiType: 'free',
	defaultTargetLang: 'ZH-HANT', // 預設轉繁體中文
	technicalKeywords: 'API, SDK, REST, HTTP, JSON, XML, CSS, HTML, JavaScript, TypeScript, Python, React, Vue, Angular, Node.js, npm, Git, GitHub', // 預設技術關鍵字
}

// --- 主插件類別 ---
export default class TranslatePlugin extends Plugin {
	settings: MyPluginSettings;
	openccConverter: any;

	async onload() {
		await this.loadSettings();

		// 初始化 OpenCC (簡體 -> 台灣正體 + 慣用詞)
		// 這樣我們在本地就能處理，速度極快
		this.openccConverter = OpenCC.Converter({ from: 'cn', to: 'twp' });

		// 1. 註冊指令：全頁翻譯 -> 預設語言
		this.addCommand({
			id: 'translate-full-page-default',
			name: `Translate: Full Page → ${this.settings.defaultTargetLang}`,
			editorCallback: async (editor: Editor) => {
				const content = editor.getValue();
				await this.processUnifiedTranslation(editor, content, this.settings.defaultTargetLang, true);
			}
		});

		// 2. 註冊指令：選取翻譯 -> 預設語言
		this.addCommand({
			id: 'translate-section-default',
			name: `Translate: Section → ${this.settings.defaultTargetLang}`,
			editorCallback: async (editor: Editor) => {
				const selection = editor.getSelection();
				if (selection) {
					await this.processUnifiedTranslation(editor, selection, this.settings.defaultTargetLang, false);
				} else {
					new Notice('Please select text to translate');
				}
			}
		});

		// 3. 註冊指令：全頁翻譯 -> 繁體中文
		this.addCommand({
			id: 'translate-full-page-zhhant',
			name: 'Translate: Full Page → ZH-HANT',
			editorCallback: async (editor: Editor) => {
				const content = editor.getValue();
				await this.processUnifiedTranslation(editor, content, 'ZH-HANT', true);
			}
		});

		// 4. 註冊指令：選取翻譯 -> 繁體中文
		this.addCommand({
			id: 'translate-section-zhhant',
			name: 'Translate: Section → ZH-HANT',
			editorCallback: async (editor: Editor) => {
				const selection = editor.getSelection();
				if (selection) {
					await this.processUnifiedTranslation(editor, selection, 'ZH-HANT', false);
				} else {
					new Notice('Please select text to translate');
				}
			}
		});

		// 5. 註冊右鍵選單 (Context Menu)
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
				const selection = editor.getSelection();
				if (selection) {
					// 添加 "Translate to [Default]" 選項
					menu.addItem((item) => {
						item
							.setTitle(`Translate to ${this.settings.defaultTargetLang}`)
							.setIcon("languages")
							.onClick(async () => {
								await this.processUnifiedTranslation(editor, selection, this.settings.defaultTargetLang, false);
							});
					});
				}
			})
		);

		// 添加設定頁面
		this.addSettingTab(new TranslateSettingTab(this.app, this));
	}

	// --- 處理表格翻譯（完全提取分隔行，不使用佔位符）---
	handleTableTranslation(text: string, placeholderMap: Map<string, string>, placeholderIndex: number): { text: string; index: number; separators: Array<{line: number, content: string}> } {
		const lines = text.split('\n');
		const separators: Array<{line: number, content: string}> = [];
		let result = '';

		// 第一步：提取所有分隔行，記錄行號
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// 檢測是否為表格分隔行
			if (/^\|[\s|:-]+\|[ \t]*$/.test(line)) {
				separators.push({ line: i, content: line });
				// 用空行標記（稍後恢復時會知道位置）
				lines[i] = `XXSEPARATORLINEXX${i}XX`;
			} else if (/^\|(.+)\|[ \t]*$/.test(line)) {
				// 處理表格內容行：保護每個管道符號
				const pipeMatches = line.match(/\|/g);
				if (pipeMatches) {
					let processedLine = line;
					pipeMatches.forEach(() => {
						const placeholder = `XXTABLEPIPEXX${placeholderIndex}XXTABLEPIPEXX`;
						placeholderIndex++;
						placeholderMap.set(placeholder, '|');
						processedLine = processedLine.replace('|', placeholder);
					});
					lines[i] = processedLine;
				}
			}
		}

		result = lines.join('\n');
		return { text: result, index: placeholderIndex, separators };
	}

	// --- 恢復表格分隔行 ---
	restoreTableSeparators(text: string, separators: Array<{line: number, content: string}>): string {
		let lines = text.split('\n');

		// 恢復所有分隔行
		separators.forEach(sep => {
			// 查找標記行
			const markerIndex = lines.findIndex(line => line.includes(`XXSEPARATORLINEXX${sep.line}XX`));
			if (markerIndex !== -1) {
				lines[markerIndex] = sep.content;
			}
		});

		return lines.join('\n');
	}

	// --- 內容保護功能（保護程式碼、連結、HTML、路徑等不翻譯）---
	protectContent(text: string): { protectedText: string; placeholderMap: Map<string, string>; separators: Array<{line: number, content: string}> } {
		const placeholderMap = new Map<string, string>();
		let protectedText = text;
		let placeholderIndex = 0;

		// 先處理表格
		const tableResult = this.handleTableTranslation(protectedText, placeholderMap, placeholderIndex);
		protectedText = tableResult.text;
		placeholderIndex = tableResult.index;
		const separators = tableResult.separators;

		// 保護規則（順序很重要！）
		const protectionRules = [
			// 1. 程式碼區塊（三個反引號）
			{ name: 'CODEBLOCK', regex: /```[\s\S]*?```/g },

			// 2. 行內程式碼（單個反引號）
			{ name: 'INLINECODE', regex: /`[^`\n]+?`/g },

			// 3. Obsidian Wikilinks（包含嵌入）: [[link]] 或 [[link|alias]] 或 ![[embed]]
			{ name: 'WIKILINK', regex: /!?\[\[([^\]]+)\]\]/g },

			// 4. Markdown 連結 [text](url)
			{ name: 'LINK', regex: /\[([^\]]*)\]\(([^\)]+)\)/g },

			// 5. Obsidian Callouts: >[!note], >[!warning], >[!quote] 等
			{ name: 'CALLOUT', regex: /^>\s*\[![\w-]+\][^\n]*/gm },

			// 6. Obsidian Tags: #tag 或 #nested/tag
			{ name: 'TAG', regex: /#[\w\/-]+/g },

			// 7. Obsidian Block References: ^block-id
			{ name: 'BLOCKREF', regex: /\^[\w-]+/g },

			// 8. HTML 標籤
			{ name: 'HTMLTAG', regex: /<[^>]+>/g },

			// 9. 檔案路徑（Windows: C:\path\to\file, Unix: /path/to/file, 相對: ./path or ../path）
			{ name: 'FILEPATH', regex: /(?:[A-Z]:\\(?:[^\s\\/:*?"<>|]+\\)*[^\s\\/:*?"<>|]*)|(?:\.{0,2}\/(?:[^\s\/]+\/)*[^\s\/]*)|(?:\/(?:[^\s\/]+\/)*[^\s\/]+)/g },
		];

		// 依序套用保護規則
		protectionRules.forEach(rule => {
			const matches = protectedText.match(rule.regex);
			if (matches) {
				matches.forEach(match => {
					const placeholder = `XX${rule.name}XX${placeholderIndex}XX${rule.name}XX`;
					placeholderIndex++;
					placeholderMap.set(placeholder, match);
					// 只替換第一個匹配項（避免重複替換）
					protectedText = protectedText.replace(match, placeholder);
				});
			}
		});

		// 保護技術關鍵字
		const keywords = this.settings.technicalKeywords
			.split(',')
			.map(k => k.trim())
			.filter(k => k.length > 0);

		keywords.forEach((keyword) => {
			// 使用不區分大小寫的正則表達式來匹配關鍵字（保留原始大小寫）
			const regex = new RegExp(`\\b(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi');
			const matches = protectedText.match(regex);

			if (matches) {
				// 為每個匹配項創建唯一的佔位符
				matches.forEach(match => {
					const placeholder = `XXKEYWORDXX${placeholderIndex}XXKEYWORDXX`;
					placeholderIndex++;
					placeholderMap.set(placeholder, match);
					// 只替換第一個尚未替換的匹配項
					protectedText = protectedText.replace(match, placeholder);
				});
			}
		});

		return { protectedText, placeholderMap, separators };
	}

	restoreContent(text: string, placeholderMap: Map<string, string>): string {
		let restoredText = text;

		// 恢復所有受保護的內容（包括表格）
		placeholderMap.forEach((original, placeholder) => {
			// 首先嘗試精確匹配
			if (restoredText.includes(placeholder)) {
				restoredText = restoredText.split(placeholder).join(original);
			} else {
				// DeepL 可能在佔位符中添加空格，使用正則表達式處理
				// 將佔位符轉換為允許空格的正則表達式
				const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				// 允許 XX 之間有任意空格
				const flexiblePattern = escapedPlaceholder.replace(/XX/g, 'XX\\s*');
				const regex = new RegExp(flexiblePattern, 'g');
				restoredText = restoredText.replace(regex, original);
			}
		});

		return restoredText;
	}

	// --- 統一翻譯處理（自動選擇 OpenCC 或 DeepL）---
	async processUnifiedTranslation(editor: Editor, text: string, targetLang: string, isFullPage: boolean) {
		// 判斷目標語言，自動選擇翻譯引擎
		const useOpenCC = targetLang === 'ZH-HANT';

		new Notice(useOpenCC ? 'OpenCC Converting...' : 'DeepL Translating...');

		try {
			// 1. 保護所有需要保留的內容（程式碼、連結、HTML、路徑、技術關鍵字、表格）
			const { protectedText, placeholderMap, separators } = this.protectContent(text);

			// 2. 根據目標語言選擇翻譯引擎
			let translatedText: string;
			if (useOpenCC) {
				// 使用 OpenCC 進行簡繁轉換
				translatedText = this.openccConverter(protectedText);
			} else {
				// 使用 DeepL 翻譯
				translatedText = await this.callDeepL(protectedText, targetLang);
			}

			// 3. 先恢復表格分隔行（這些被完全提取出來，沒有送到 API）
			let restoredText = this.restoreTableSeparators(translatedText, separators);

			// 4. 再恢復其他受保護的內容（佔位符替換）
			restoredText = this.restoreContent(restoredText, placeholderMap);

			// 5. 根據是全頁還是選取來更新內容
			if (isFullPage) {
				editor.setValue(restoredText);
			} else {
				editor.replaceSelection(restoredText);
			}

			new Notice(useOpenCC ? 'Conversion Done!' : 'Translation Done!');

		} catch (error: any) {
			new Notice(`Translation Failed: ${error.message || String(error)}`);
			console.error(error);
		}
	}

	// --- 提示使用者選擇語言 ---
	async promptForLanguage(): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new LanguageSelectionModal(this.app, (selectedLang) => {
				resolve(selectedLang);
			});
			modal.open();
		});
	}

	// --- API 呼叫層 ---
	async callDeepL(text: string, targetLang: string): Promise<string> {
		if (!this.settings.deepLApiKey) {
			throw new Error("API Key is missing in settings");
		}

		const endpoint = this.settings.deepLApiType === 'free'
			? 'https://api-free.deepl.com/v2/translate'
			: 'https://api.deepl.com/v2/translate';

		const params = new URLSearchParams();
		params.append('text', text);
		params.append('target_lang', targetLang);
		params.append('enable_beta_languages', 'true'); // 啟用 Beta 語言支援（如 ZH-HANT）

		const response = await requestUrl({
			url: endpoint,
			method: 'POST',
			headers: {
				'Authorization': `DeepL-Auth-Key ${this.settings.deepLApiKey}`,
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: params.toString()
		});

		if (response.status !== 200) {
			throw new Error(`API Error: ${response.status} ${response.text}`);
		}

		const data = response.json;
		return data.translations[0].text;
	}

	// --- 測試 DeepL 連線功能 ---
	async testDeepLConnection(): Promise<{ success: boolean; message: string; details?: any }> {
		if (!this.settings.deepLApiKey) {
			return {
				success: false,
				message: "API Key is missing. Please enter your API key first."
			};
		}

		const endpoint = this.settings.deepLApiType === 'free'
			? 'https://api-free.deepl.com/v2/translate'
			: 'https://api.deepl.com/v2/translate';

		try {
			const params = new URLSearchParams();
			params.append('text', 'Hello');
			params.append('target_lang', 'ZH-HANT'); // 測試用：英文翻繁體中文
			params.append('enable_beta_languages', 'true'); // 啟用 Beta 語言支援

			const response = await requestUrl({
				url: endpoint,
				method: 'POST',
				headers: {
					'Authorization': `DeepL-Auth-Key ${this.settings.deepLApiKey}`,
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				body: params.toString()
			});

			if (response.status !== 200) {
				return {
					success: false,
					message: `Connection failed: ${response.status}`,
					details: response.text
				};
			}

			const data = response.json;
			return {
				success: true,
				message: "Connection successful! DeepL API is working correctly.",
				details: data
			};

		} catch (error: any) {
			return {
				success: false,
				message: `Connection error: ${error.message || String(error)}`,
				details: error
			};
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// --- 設定頁面 UI ---
class TranslateSettingTab extends PluginSettingTab {
	plugin: TranslatePlugin;

	constructor(app: App, plugin: TranslatePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {text: 'DeepL & OpenCC Settings'});

		new Setting(containerEl)
			.setName('DeepL API Key')
			.setDesc('Get your key from deepl.com')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.deepLApiKey)
				.onChange(async (value) => {
					this.plugin.settings.deepLApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('API Type')
			.setDesc('Free or Pro account?')
			.addDropdown(dropDown => dropDown
				.addOption('free', 'DeepL API Free')
				.addOption('pro', 'DeepL API Pro')
				.setValue(this.plugin.settings.deepLApiType)
				.onChange(async (value) => {
					this.plugin.settings.deepLApiType = value as 'free' | 'pro';
					await this.plugin.saveSettings();
				}));

		// Test Connection Button
		new Setting(containerEl)
			.setName('Test Connection')
			.setDesc('Check if your DeepL API key is working correctly.')
			.addButton(button => button
				.setButtonText('Test Connection')
				.setCta()
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText('Testing...');

					const result = await this.plugin.testDeepLConnection();

					// Log result to console
					console.log('DeepL Connection Test Result:', result);

					// Show notification to user
					if (result.success) {
						new Notice(`✓ ${result.message}`);
					} else {
						new Notice(`✗ ${result.message}`);
					}

					button.setDisabled(false);
					button.setButtonText('Test Connection');
				}));

		new Setting(containerEl)
			.setName('Default Target Language')
			.setDesc('Right-click menu will translate to this language. Note: After changing this, reload Obsidian to update command names in the command palette.')
			.addDropdown(dropDown => dropDown
				.addOption('ZH-HANT', 'Traditional Chinese')
				.addOption('ZH', 'Simplified Chinese')
				.addOption('EN', 'English')
				.addOption('FR', 'French')
				.addOption('DE', 'German')
				.addOption('JA', 'Japanese')
				.setValue(this.plugin.settings.defaultTargetLang)
				.onChange(async (value) => {
					this.plugin.settings.defaultTargetLang = value;
					await this.plugin.saveSettings();
					new Notice('Default language changed. Reload Obsidian to update command names.');
				}));

		new Setting(containerEl)
			.setName('Technical Keywords')
			.setDesc('Comma-separated list of keywords to preserve (keep in English) during translation.')
			.addTextArea(text => text
				.setPlaceholder('API, SDK, REST, HTTP...')
				.setValue(this.plugin.settings.technicalKeywords)
				.onChange(async (value) => {
					this.plugin.settings.technicalKeywords = value;
					await this.plugin.saveSettings();
				}));
	}
}

// --- 語言選擇模態框 ---
class LanguageSelectionModal extends Modal {
	onSubmit: (selectedLang: string | null) => void;
	selectedLang: string = 'ZH-HANT';

	constructor(app: App, onSubmit: (selectedLang: string | null) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Select Target Language' });

		new Setting(contentEl)
			.setName('Target Language')
			.setDesc('Choose the language to translate to')
			.addDropdown(dropdown => dropdown
				.addOption('ZH-HANT', 'Traditional Chinese (Taiwan)')
				.addOption('ZH', 'Simplified Chinese')
				.addOption('EN', 'English')
				.addOption('FR', 'French')
				.addOption('DE', 'German')
				.addOption('JA', 'Japanese')
				.setValue(this.selectedLang)
				.onChange((value) => {
					this.selectedLang = value;
				}));

		new Setting(contentEl)
			.addButton(button => button
				.setButtonText('Translate')
				.setCta()
				.onClick(() => {
					this.onSubmit(this.selectedLang);
					this.close();
				}))
			.addButton(button => button
				.setButtonText('Cancel')
				.onClick(() => {
					this.onSubmit(null);
					this.close();
				}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}