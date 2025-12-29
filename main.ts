import { App, Editor, Notice, Plugin, PluginSettingTab, Setting, Menu, requestUrl } from 'obsidian';

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
	openccConverter: any = null; // Lazy load only when needed

	async onload() {
		await this.loadSettings();

		// === DeepL 翻譯指令 ===
		// 1. 全頁翻譯到預設語言
		this.addCommand({
			id: 'translate-full-page-default',
			name: `Translate: Full Page → ${this.settings.defaultTargetLang}`,
			editorCallback: async (editor: Editor) => {
				const content = editor.getValue();
				await this.processDeepLTranslation(editor, content, this.settings.defaultTargetLang, true);
			}
		});

		// 2. 選取翻譯到預設語言
		this.addCommand({
			id: 'translate-section-default',
			name: `Translate: Section → ${this.settings.defaultTargetLang}`,
			editorCallback: async (editor: Editor) => {
				const selection = editor.getSelection();
				if (selection) {
					await this.processDeepLTranslation(editor, selection, this.settings.defaultTargetLang, false);
				} else {
					new Notice('Please select text to translate');
				}
			}
		});

		// === OpenCC 簡繁轉換指令 ===
		// 3. 全頁簡繁轉換
		this.addCommand({
			id: 'opencc-convert-full-page',
			name: '簡繁轉換：全頁',
			editorCallback: async (editor: Editor) => {
				const content = editor.getValue();
				await this.processOpenCCConversion(editor, content, true);
			}
		});

		// 4. 選取簡繁轉換
		this.addCommand({
			id: 'opencc-convert-selection',
			name: '簡繁轉換：選取',
			editorCallback: async (editor: Editor) => {
				const selection = editor.getSelection();
				if (selection) {
					await this.processOpenCCConversion(editor, selection, false);
				} else {
					new Notice('請先選取文字');
				}
			}
		});

		// 5. 註冊右鍵選單 (Context Menu)
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
				const selection = editor.getSelection();
				if (selection) {
					// DeepL 翻譯選項
					menu.addItem((item) => {
						item
							.setTitle(`翻譯到 ${this.settings.defaultTargetLang}`)
							.setIcon("languages")
							.onClick(async () => {
								await this.processDeepLTranslation(editor, selection, this.settings.defaultTargetLang, false);
							});
					});

					// OpenCC 簡繁轉換選項
					menu.addItem((item) => {
						item
							.setTitle('簡繁轉換')
							.setIcon("repeat")
							.onClick(async () => {
								await this.processOpenCCConversion(editor, selection, false);
							});
					});
				}
			})
		);

		// 添加設定頁面
		this.addSettingTab(new TranslateSettingTab(this.app, this));
	}

	// --- UUID 生成器 ---
	generateUUID(): string {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
			const r = Math.random() * 16 | 0;
			const v = c == 'x' ? r : (r & 0x3 | 0x8);
			return v.toString(16);
		});
	}

	// --- 處理表格翻譯（使用 UUID 標記代替行索引）---
	handleTableTranslation(text: string, placeholderMap: Map<string, string>, placeholderIndex: number): { text: string; index: number; separators: Map<string, string> } {
		const lines = text.split('\n');
		const separators = new Map<string, string>();

		// 處理每一行
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// 檢測是否為表格分隔行
			if (/^\|[\s|:-]+\|[ \t]*$/.test(line)) {
				const uuid = this.generateUUID();
				separators.set(uuid, line);
				// 用 UUID 標記替換
				lines[i] = `XXSEPARATORLINEXX${uuid}XX`;
			} else if (/^\|(.+)\|[ \t]*$/.test(line)) {
				// 處理表格內容行：保護每個管道符號（從後往前替換）
				const pipeRegex = /\|/g;
				const matches = Array.from(line.matchAll(pipeRegex));

				// 從後往前替換，避免索引位置變化
				let processedLine = line;
				matches.reverse().forEach(match => {
					const placeholder = `XXTABLEPIPEXX${placeholderIndex}XXTABLEPIPEXX`;
					placeholderIndex++;
					placeholderMap.set(placeholder, '|');

					// 使用索引位置精確替換
					const start = match.index!;
					const end = start + 1; // '|' 的長度是 1
					processedLine = processedLine.substring(0, start) + placeholder + processedLine.substring(end);
				});

				lines[i] = processedLine;
			}
		}

		const result = lines.join('\n');
		return { text: result, index: placeholderIndex, separators };
	}

	// --- 恢復表格分隔行（使用 UUID 和多級回退策略）---
	restoreTableSeparators(text: string, separators: Map<string, string>): string {
		let lines = text.split('\n');
		let restoredCount = 0;

		// 第一級：嘗試精確 UUID 匹配
		separators.forEach((originalContent, uuid) => {
			const exactMarker = `XXSEPARATORLINEXX${uuid}XX`;
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].includes(exactMarker)) {
					lines[i] = originalContent;
					restoredCount++;
					separators.delete(uuid); // 標記為已恢復
					break;
				}
			}
		});

		// 第二級：模糊匹配（DeepL 可能在 UUID 中添加空格）
		if (separators.size > 0) {
			separators.forEach((originalContent, uuid) => {
				const flexiblePattern = `XXSEPARATORLINEXX\\s*${uuid.replace(/-/g, '\\s*-\\s*')}\\s*XX`;
				const regex = new RegExp(flexiblePattern, 'g');
				
				for (let i = 0; i < lines.length; i++) {
					if (regex.test(lines[i])) {
						lines[i] = originalContent;
						restoredCount++;
						separators.delete(uuid);
						break;
					}
				}
			});
		}

		// 第三級：模式匹配（尋找任何遺留的 SEPARATORLINE 標記）
		if (separators.size > 0) {
			const separatorMarkerPattern = /XXSEPARATORLINEXX[0-9a-fA-F-]+XX/g;
			
			for (let i = 0; i < lines.length; i++) {
				const match = lines[i].match(separatorMarkerPattern);
				if (match) {
					// 找到最近的未恢復分隔符
					const firstAvailable = separators.keys().next().value;
					if (firstAvailable) {
						lines[i] = separators.get(firstAvailable)!;
						restoredCount++;
						separators.delete(firstAvailable);
					}
				}
			}
		}

		// 第四級：智能重建（如果仍有遺留的分隔符）
		if (separators.size > 0) {
			lines = this.rebuildMissingSeparators(lines, separators);
		}

		return lines.join('\n');
	}

	// --- 智能重建缺失的表格分隔符 ---
	rebuildMissingSeparators(lines: string[], remainingSeparators: Map<string, string>): string[] {
		for (let i = 0; i < lines.length - 1; i++) {
			const currentLine = lines[i];
			const nextLine = lines[i + 1];

			// 檢查是否為表格標題行且下一行不是分隔符
			if (/^\|(.+)\|[ \t]*$/.test(currentLine) && !/^\|[\s|:-]+\|[ \t]*$/.test(nextLine)) {
				// 從標題行推斷分隔符格式
				const pipeCount = (currentLine.match(/\|/g) || []).length;
				let separator = '|';

				for (let j = 1; j < pipeCount - 1; j++) {
					separator += '---|';
				}
				separator += '\n';

				// 在標題行後插入分隔符
				lines.splice(i + 1, 0, separator);
				
				// 移除一個已使用的分隔符
				const firstAvailable = remainingSeparators.keys().next().value;
				if (firstAvailable) {
					remainingSeparators.delete(firstAvailable);
				}

				// 跳過新插入的行
				i++;
			}
		}

		return lines;
	}

	// --- 驗證表格結構完整性 ---
	validateTableStructure(lines: string[]): { isValid: boolean; issues: string[] } {
		const issues: string[] = [];
		let inTable = false;
		let headerLineIndex = -1;
		let separatorLineIndex = -1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();

			// 檢測表格開始
			if (/^\|(.+)\|[ \t]*$/.test(line) && !inTable) {
				inTable = true;
				headerLineIndex = i;
				continue;
			}

			// 檢測分隔符
			if (inTable && /^\|[\s|:-]+\|[ \t]*$/.test(line)) {
				if (separatorLineIndex === -1) {
					separatorLineIndex = i;
				}
				continue;
			}

			// 檢測表格結束
			if (inTable && !/^\|(.+)\|[ \t]*$/.test(line) && !/^\|[\s|:-]+\|[ \t]*$/.test(line)) {
				// 驗證剛剛結束的表格
				if (separatorLineIndex === -1) {
					issues.push(`Table at line ${headerLineIndex + 1} missing separator line`);
				} else {
					// 檢查標題行和分隔符的管道數量是否一致
					const headerPipes = (lines[headerLineIndex].match(/\|/g) || []).length;
					const separatorPipes = (lines[separatorLineIndex].match(/\|/g) || []).length;
					
					if (headerPipes !== separatorPipes) {
						issues.push(`Table at line ${headerLineIndex + 1} has mismatched pipe counts: header has ${headerPipes}, separator has ${separatorPipes}`);
					}
				}

				// 重置狀態
				inTable = false;
				headerLineIndex = -1;
				separatorLineIndex = -1;
			}
		}

		// 檢查文件末尾的表格
		if (inTable) {
			if (separatorLineIndex === -1) {
				issues.push(`Table at line ${headerLineIndex + 1} missing separator line`);
			} else {
				const headerPipes = (lines[headerLineIndex].match(/\|/g) || []).length;
				const separatorPipes = (lines[separatorLineIndex].match(/\|/g) || []).length;
				
				if (headerPipes !== separatorPipes) {
					issues.push(`Table at line ${headerLineIndex + 1} has mismatched pipe counts: header has ${headerPipes}, separator has ${separatorPipes}`);
				}
			}
		}

		return {
			isValid: issues.length === 0,
			issues
		};
	}

	// --- 自動修復表格結構 ---
	repairTableStructure(text: string): string {
		const lines = text.split('\n');
		const repairedLines = [...lines];
		let inTable = false;
		let tableHasSeparator = false;
		let tableStartIndex = -1;

		for (let i = 0; i < repairedLines.length; i++) {
			const currentLine = repairedLines[i];
			const isTableRow = /^\|(.+)\|[ \t]*$/.test(currentLine);
			const isSeparator = /^\|[\s|:-]+\|[ \t]*$/.test(currentLine);

			// 檢測表格開始
			if (isTableRow && !isSeparator && !inTable) {
				inTable = true;
				tableHasSeparator = false;
				tableStartIndex = i;
			}
			// 檢測分隔符
			else if (isSeparator && inTable) {
				tableHasSeparator = true;
			}
			// 檢測表格結束
			else if (!isTableRow && !isSeparator && inTable) {
				// 如果表格沒有分隔符，在第一行後插入
				if (!tableHasSeparator && tableStartIndex >= 0) {
					const headerLine = repairedLines[tableStartIndex];
					const pipeCount = (headerLine.match(/\|/g) || []).length;
					let separator = '|';

					for (let j = 1; j < pipeCount - 1; j++) {
						separator += '---|';
					}

					// 在標題行後插入分隔符
					repairedLines.splice(tableStartIndex + 1, 0, separator);
					i++; // 調整索引
				}

				// 重置狀態
				inTable = false;
				tableHasSeparator = false;
				tableStartIndex = -1;
			}
		}

		// 處理文件末尾的表格
		if (inTable && !tableHasSeparator && tableStartIndex >= 0) {
			const headerLine = repairedLines[tableStartIndex];
			const pipeCount = (headerLine.match(/\|/g) || []).length;
			let separator = '|';

			for (let j = 1; j < pipeCount - 1; j++) {
				separator += '---|';
			}

			repairedLines.splice(tableStartIndex + 1, 0, separator);
		}

		return repairedLines.join('\n');
	}

	// --- 內容保護功能（保護程式碼、連結、HTML、路徑等不翻譯）---
	protectContent(text: string): { protectedText: string; placeholderMap: Map<string, string>; separators: Map<string, string> } {
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

		// 依序套用保護規則（使用 matchAll 配合索引位置，從後往前替換）
		protectionRules.forEach(rule => {
			const matches = Array.from(protectedText.matchAll(rule.regex));

			// 從後往前替換，避免索引位置變化
			matches.reverse().forEach(match => {
				const placeholder = `XX${rule.name}XX${placeholderIndex}XX${rule.name}XX`;
				placeholderIndex++;
				placeholderMap.set(placeholder, match[0]);

				// 使用索引位置精確替換
				const start = match.index!;
				const end = start + match[0].length;
				protectedText = protectedText.substring(0, start) + placeholder + protectedText.substring(end);
			});
		});

		// 保護技術關鍵字
		const keywords = this.settings.technicalKeywords
			.split(',')
			.map(k => k.trim())
			.filter(k => k.length > 0);

		keywords.forEach((keyword) => {
			// 使用不區分大小寫的正則表達式來匹配關鍵字（保留原始大小寫）
			const regex = new RegExp(`\\b(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi');
			const matches = Array.from(protectedText.matchAll(regex));

			// 從後往前替換，避免索引位置變化
			matches.reverse().forEach(match => {
				const placeholder = `XXKEYWORDXX${placeholderIndex}XXKEYWORDXX`;
				placeholderIndex++;
				placeholderMap.set(placeholder, match[0]);

				// 使用索引位置精確替換
				const start = match.index!;
				const end = start + match[0].length;
				protectedText = protectedText.substring(0, start) + placeholder + protectedText.substring(end);
			});
		});

		return { protectedText, placeholderMap, separators };
	}

	// --- 懶加載 OpenCC（僅在需要時初始化）---
	async getOpenCCConverter() {
		if (!this.openccConverter) {
			const OpenCC = await import('opencc-js');
			this.openccConverter = OpenCC.Converter({ from: 'cn', to: 'twp' });
		}
		return this.openccConverter;
	}

	restoreContent(text: string, placeholderMap: Map<string, string>, tablePipesOnly: boolean = false): string {
		let restoredText = text;

		// 恢復所有受保護的內容
		placeholderMap.forEach((original, placeholder) => {
			// 如果只恢復表格管道符，跳過其他類型
			if (tablePipesOnly && !placeholder.includes('TABLEPIPE')) {
				return;
			}
			// 如果不是恢復表格管道，跳過表格管道符（它們已經被恢復過了）
			if (!tablePipesOnly && placeholder.includes('TABLEPIPE')) {
				return;
			}

			// 首先嘗試精確匹配（最常見的情況）
			if (restoredText.includes(placeholder)) {
				restoredText = restoredText.split(placeholder).join(original);
				return;
			}

			// DeepL 可能在佔位符中添加空格或改變大小寫
			// 將佔位符轉換為允許空格和不區分大小寫的正則表達式
			const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			// 允許 XX 之間有任意空格
			const flexiblePattern = escapedPlaceholder.replace(/XX/g, 'XX\\s*');
			// 不區分大小寫匹配（DeepL 翻譯到中文時會將佔位符變成小寫！）
			const regex = new RegExp(flexiblePattern, 'gi');
			restoredText = restoredText.replace(regex, original);
		});

		return restoredText;
	}

	// --- DeepL 翻譯處理 ---
	async processDeepLTranslation(editor: Editor, text: string, targetLang: string, isFullPage: boolean) {
		new Notice(`翻譯中 (DeepL)...`);

		try {
			// 1. 保護所有需要保留的內容
			const { protectedText, placeholderMap, separators } = this.protectContent(text);

			// 2. 使用 DeepL 翻譯
			const translatedText = await this.callDeepL(protectedText, targetLang);

			// 3. 先恢復表格分隔行（UUID 標記）
			let restoredText = this.restoreTableSeparators(translatedText, separators);

			// 4. 恢復表格管道符（必須在修復表格前完成，否則修復功能無法識別表格行）
			restoredText = this.restoreContent(restoredText, placeholderMap, true);

			// 5. 驗證並修復表格結構（現在可以正確識別 | 符號）
			restoredText = this.repairTableStructure(restoredText);

			// 6. 恢復其他受保護的內容（程式碼、連結等）
			restoredText = this.restoreContent(restoredText, placeholderMap, false);

			// 7. 更新內容
			if (isFullPage) {
				editor.setValue(restoredText);
			} else {
				editor.replaceSelection(restoredText);
			}

			new Notice('翻譯完成！');

		} catch (error: any) {
			new Notice(`翻譯失敗：${error.message || String(error)}`);
			console.error(error);
		}
	}

	// --- OpenCC 簡繁轉換處理 ---
	async processOpenCCConversion(editor: Editor, text: string, isFullPage: boolean) {
		new Notice('轉換中 (OpenCC)...');

		try {
			// 1. 保護所有需要保留的內容
			const { protectedText, placeholderMap, separators } = this.protectContent(text);

			// 2. 使用 OpenCC 進行簡繁轉換（懶加載）
			const converter = await this.getOpenCCConverter();
			const convertedText = converter(protectedText);

			// 3. 先恢復表格分隔行（UUID 標記）
			let restoredText = this.restoreTableSeparators(convertedText, separators);

			// 4. 恢復表格管道符（必須在修復表格前完成，否則修復功能無法識別表格行）
			restoredText = this.restoreContent(restoredText, placeholderMap, true);

			// 5. 驗證並修復表格結構（現在可以正確識別 | 符號）
			restoredText = this.repairTableStructure(restoredText);

			// 6. 恢復其他受保護的內容（程式碼、連結等）
			restoredText = this.restoreContent(restoredText, placeholderMap, false);

			// 7. 更新內容
			if (isFullPage) {
				editor.setValue(restoredText);
			} else {
				editor.replaceSelection(restoredText);
			}

			new Notice('轉換完成！');

		} catch (error: any) {
			new Notice(`轉換失敗：${error.message || String(error)}`);
			console.error(error);
		}
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