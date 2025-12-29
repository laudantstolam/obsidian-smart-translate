import { App, Editor, Notice, Plugin, PluginSettingTab, Setting, Menu, requestUrl } from 'obsidian';

// --- 設定介面定義 ---
interface MyPluginSettings {
	deepLApiKey: string;
	deepLApiType: 'free' | 'pro';
	defaultTargetLang: string;
	technicalKeywords: string; // 逗號分隔的技術關鍵字清單
	// 新增：可調整的 curl 參數
	preserveFormatting: boolean;
	splitSentences: string;
	tagHandling: string;
	nonSplittingTags: string;
	ignoreTags: string;
	outlineDetection: boolean;
	formality: string;
	modelType: string;
	context: string;
	glossaryId: string;
	styleId: string;
	customInstructions: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	deepLApiKey: '',
	deepLApiType: 'free',
	defaultTargetLang: 'ZH-HANT', // 預設轉繁體中文
	technicalKeywords: 'API, SDK, REST, HTTP, JSON, XML, CSS, HTML, JavaScript, TypeScript, Python, React, Vue, Angular, Node.js, npm, Git, GitHub', // 預設技術關鍵字
	// 新增參數的預設值
	preserveFormatting: true,
	splitSentences: 'nonewlines',
	tagHandling: 'html',
	nonSplittingTags: '',
	ignoreTags: '',
	outlineDetection: false,
	formality: 'default',
	modelType: '',
	context: '',
	glossaryId: '',
	styleId: '',
	customInstructions: '',
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
					// DeepL 翻譯選項 - 使用子選單
					menu.addItem((item) => {
						item
							.setTitle('翻譯到')
							.setIcon("languages");

						// 創建語言選擇子選單
						const languageOptions = [
							{ code: 'ZH-HANT', name: '繁體中文 (Traditional Chinese)' },
							{ code: 'ZH', name: '簡體中文 (Simplified Chinese)' },
							{ code: 'EN', name: '英文 (English)' },
							{ code: 'FR', name: '法文 (Français)' },
							{ code: 'DE', name: '德文 (Deutsch)' },
							{ code: 'JA', name: '日文 (日本語)' },
						];

						// 為每個語言創建子選單項目
						const submenu = (item as any).setSubmenu();
						languageOptions.forEach(lang => {
							submenu.addItem((subitem: any) => {
								// 標記預設語言
								const isDefault = lang.code === this.settings.defaultTargetLang;
								const title = isDefault ? `★ ${lang.name}` : lang.name;

								subitem
									.setTitle(title)
									.onClick(async () => {
										await this.processDeepLTranslation(editor, selection, lang.code, false);
									});
							});
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

	// --- 恢復表格分隔行（使用 Unicode 字符匹配）---
	restoreTableSeparators(text: string, separators: Map<string, string>): string {
		let lines = text.split('\n');

		// 查找並恢復分隔行（▓字符組成的行）
		separators.forEach((originalContent, placeholderId) => {
			for (let i = 0; i < lines.length; i++) {
				// 檢查是否整行都是▓字符
				if (lines[i].trim() && /^▓+$/.test(lines[i].trim())) {
					lines[i] = originalContent;
					separators.delete(placeholderId);
					break;
				}
			}
		});

		// 如果還有未匹配的分隔符，使用智能重建
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

	// --- 內容保護功能（改進版本）---
	protectContent(text: string): { protectedText: string; placeholderMap: Map<string, string>; separators: Map<string, string> } {
		const placeholderMap = new Map<string, string>();
		const separators = new Map<string, string>();
		let protectedText = text;
		let placeholderIndex = 0;

		// 使用 Unicode 字符作為佔位符，DeepL 不會在這些字符處分行
		const PIPE_PLACEHOLDER = '█'; // Unicode 實心方塊
		const SEPARATOR_PLACEHOLDER = '▓'; // Unicode 中等陰影方塊

		// 處理表格結構 - 只保護管道符號和分隔行，允許內容被翻譯
		const lines = protectedText.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// 檢測並保護表格分隔行 (例如: |---|---|)
			if (/^\|[\s|:-]+\|[ \t]*$/.test(line)) {
				const placeholderId = `SEP${placeholderIndex++}`;
				separators.set(placeholderId, line);
				// 用等長的▓字符串替換，保持視覺寬度
				const replacement = SEPARATOR_PLACEHOLDER.repeat(line.length);
				placeholderMap.set(placeholderId, replacement);
				lines[i] = replacement;
			}
			// 檢測表格內容行，保護管道符號但允許內容翻譯
			else if (/^\|(.+)\|[ \t]*$/.test(line)) {
				// 直接將所有管道符號替換為 █
				lines[i] = line.replace(/\|/g, PIPE_PLACEHOLDER);
			}
		}

		protectedText = lines.join('\n');

		// 處理行內程式碼
		const codeRegex = /`[^`\n]+?`/g;
		const codeMatches = Array.from(protectedText.matchAll(codeRegex));
		
		codeMatches.reverse().forEach(match => {
			const codeId = `CODE-${placeholderIndex++}`;
			const codePlaceholder = `__${codeId}__`;
			placeholderMap.set(codePlaceholder, match[0]);
			
			const start = match.index!;
			const end = start + match[0].length;
			protectedText = protectedText.substring(0, start) + codePlaceholder + protectedText.substring(end);
		});

		// 處理程式碼區塊
		const codeBlockRegex = /```[\s\S]*?```/g;
		const codeBlockMatches = Array.from(protectedText.matchAll(codeBlockRegex));
		
		codeBlockMatches.reverse().forEach(match => {
			const blockId = `BLOCK-${placeholderIndex++}`;
			const blockPlaceholder = `__${blockId}__`;
			placeholderMap.set(blockPlaceholder, match[0]);
			
			const start = match.index!;
			const end = start + match[0].length;
			protectedText = protectedText.substring(0, start) + blockPlaceholder + protectedText.substring(end);
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

	restoreContent(text: string, placeholderMap: Map<string, string>): string {
		let restoredText = text;

		// 恢復表格管道符號 (█ → |)
		restoredText = restoredText.replace(/█/g, '|');

		// 恢復程式碼區塊佔位符 (格式: __CODE-XX__)
		placeholderMap.forEach((originalContent, placeholder) => {
			if (placeholder.startsWith('__') && placeholder.endsWith('__')) {
				restoredText = restoredText.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), originalContent);
			}
		});

		return restoredText;
	}

	// --- 多級占位符恢復策略 ---
	restorePlaceholder(text: string, placeholderInfo: PlaceholderInfo, attemptLevel: number): { success: boolean; text: string } {
		let restoredText = text;
		const placeholderId = placeholderInfo.id;
		const originalContent = placeholderInfo.content;

		// 第一級：精確匹配完整標籤
		if (attemptLevel === 0) {
			const exactPattern = `<x id="${placeholderId}" type="${placeholderInfo.type}">([^<]+)</x>`;
			const regex = new RegExp(exactPattern, 'g');
			restoredText = restoredText.replace(regex, originalContent);
			
			return {
				success: restoredText !== text,
				text: restoredText
			};
		}

		// 第二級：寬鬆匹配（允許屬性順序變化和空格）
		if (attemptLevel === 1) {
			const patterns = [
				// 允許屬性順序變化
				`<x[^>]*id="${placeholderId}"[^>]*type="${placeholderInfo.type}"[^>]*>([^<]+)</x>`,
				`<x[^>]*type="${placeholderInfo.type}"[^>]*id="${placeholderId}"[^>]*>([^<]+)</x>`,
				// 允許額外屬性
				`<x[^>]*id="${placeholderId}"[^>]*>([^<]+)</x>`,
				`<x[^>]*type="${placeholderInfo.type}"[^>]*>([^<]+)</x>`
			];

			for (const pattern of patterns) {
				const regex = new RegExp(pattern, 'gi');
				const before = restoredText;
				restoredText = restoredText.replace(regex, originalContent);
				if (restoredText !== before) {
					return {
						success: true,
						text: restoredText
					};
				}
			}
		}

		// 第三級：模糊匹配（基於內容和上下文）
		if (attemptLevel === 2) {
			// 對於特定類型，使用內容匹配
			if (placeholderInfo.type === 'PIPE') {
				// 查找可能的管道符占位符
				const pipePattern = /<x[^>]*type=["']PIPE["'][^>]*>\|<\/x>/gi;
				const matches = Array.from(restoredText.matchAll(pipePattern));
				
				// 從後往前替換，避免位置變化
				matches.reverse().forEach(match => {
					if (match.index !== undefined) {
						const start = match.index;
						const end = start + match[0].length;
						restoredText = restoredText.substring(0, start) + '|' + restoredText.substring(end);
					}
				});
				
				return {
					success: matches.length > 0,
					text: restoredText
				};
			}

			// 對於其他類型，基於內容匹配
			if (originalContent.length > 0) {
				// 查找包含原始內容的標籤
				const contentPattern = new RegExp(`<x[^>]*id="${placeholderId}"[^>]*>.*?${this.escapeRegex(originalContent)}.*?</x>`, 'gi');
				const before = restoredText;
				restoredText = restoredText.replace(contentPattern, originalContent);
				
				return {
					success: restoredText !== before,
					text: restoredText
				};
			}
		}

		return {
			success: false,
			text: restoredText
		};
	}

	// --- 驗證恢復結果 ---
	validateRestoration(text: string, placeholderMap: Map<string, PlaceholderInfo>, tablePipesOnly: boolean): { isValid: boolean; unrestoredCount: number; unrestoredTypes: string[] } {
		const unrestoredTypes: string[] = [];
		let unrestoredCount = 0;

		placeholderMap.forEach((placeholderInfo, placeholderId) => {
			// 如果只恢復表格管道符，跳過其他類型
			if (tablePipesOnly && placeholderInfo.type !== 'PIPE') {
				return;
			}
			// 如果不是恢復表格管道，跳過表格管道符
			if (!tablePipesOnly && placeholderInfo.type === 'PIPE') {
				return;
			}

			// 檢查是否還有未恢復的占位符
			const patterns = [
				`<x[^>]*id="${placeholderId}"[^>]*>`,
				`<x[^>]*type="${placeholderInfo.type}"[^>]*id="${placeholderId}"[^>]*>`
			];

			const hasUnrestored = patterns.some(pattern => {
				const regex = new RegExp(pattern, 'i');
				return regex.test(text);
			});

			if (hasUnrestored) {
				unrestoredCount++;
				if (!unrestoredTypes.includes(placeholderInfo.type)) {
					unrestoredTypes.push(placeholderInfo.type);
				}
			}
		});

		return {
			isValid: unrestoredCount === 0,
			unrestoredCount,
			unrestoredTypes
		};
	}

	// --- 模糊恢復 ---
	fuzzyRestore(text: string, placeholderMap: Map<string, PlaceholderInfo>, tablePipesOnly: boolean): string {
		let restoredText = text;

		placeholderMap.forEach((placeholderInfo, placeholderId) => {
			// 如果只恢復表格管道符，跳過其他類型
			if (tablePipesOnly && placeholderInfo.type !== 'PIPE') {
				return;
			}
			// 如果不是恢復表格管道，跳過表格管道符
			if (!tablePipesOnly && placeholderInfo.type === 'PIPE') {
				return;
			}

			// 基於類型的特殊恢復邏輯
			switch (placeholderInfo.type) {
				case 'PIPE':
					// 查找任何可能的管道符占位符
					restoredText = restoredText.replace(/<x[^>]*type=["']PIPE["'][^>]*>\|<\/x>/gi, '|');
					break;

				default:
					// 對於其他類型，移除未恢復的標籤
					const removePattern = new RegExp(`<x[^>]*id="${placeholderId}"[^>]*>[^<]*</x>`, 'gi');
					restoredText = restoredText.replace(removePattern, placeholderInfo.content);
					break;
			}
		});

		return restoredText;
	}
	
		// --- DeepL 翻譯處理 ---
	async processDeepLTranslation(editor: Editor, text: string, targetLang: string, isFullPage: boolean) {
		new Notice(`翻譯中 (DeepL)...`);

		try {
			// Step 1: 先保護所有程式碼區塊（多行）
			let workingText = text;
			const codeBlockMap = new Map<string, string>();
			let codeBlockIndex = 0;

			// 保護多行程式碼區塊 (```...```)
			const codeBlockRegex = /```[\s\S]*?```/g;
			const codeBlockMatches = Array.from(workingText.matchAll(codeBlockRegex));
			codeBlockMatches.reverse().forEach(match => {
				const placeholder = `__CODEBLOCK${codeBlockIndex++}__`;
				codeBlockMap.set(placeholder, match[0]);
				workingText = workingText.substring(0, match.index!) + placeholder + workingText.substring(match.index! + match[0].length);
			});

			// Step 2: 逐行翻譯表格以保持結構
			const lines = workingText.split('\n');
			const translatedLines: string[] = [];

			for (const line of lines) {
				// 跳過包含程式碼區塊佔位符的行（不翻譯）
				if (/^__CODEBLOCK\d+__$/.test(line.trim())) {
					translatedLines.push(line);
					continue;
				}

				// 檢查是否為表格分隔行 (不翻譯)
				if (/^\|[\s|:-]+\|[ \t]*$/.test(line)) {
					translatedLines.push(line);
					continue;
				}

				// 檢查是否為表格行 (保護管道符號，翻譯內容)
				if (/^\|(.+)\|[ \t]*$/.test(line)) {
					// 保護行內程式碼
					let protectedLine = line;
					const inlineCodeMap = new Map<string, string>();
					let inlineCodeIndex = 0;

					const codeMatches = Array.from(protectedLine.matchAll(/`[^`\n]+?`/g));
					codeMatches.reverse().forEach(match => {
						const placeholder = `__CODE${inlineCodeIndex++}__`;
						inlineCodeMap.set(placeholder, match[0]);
						protectedLine = protectedLine.substring(0, match.index!) + placeholder + protectedLine.substring(match.index! + match[0].length);
					});

					// 保護管道符號
					const cells = protectedLine.split('|').map(cell => cell.trim());

					// 翻譯每個單元格
					const translatedCells: string[] = [];
					for (const cell of cells) {
						if (cell === '') {
							translatedCells.push('');
						} else {
							try {
								const translated = await this.callDeepL(cell, targetLang);
								translatedCells.push(translated);
							} catch (error) {
								translatedCells.push(cell); // 翻譯失敗時保留原文
							}
						}
					}

					// 重組表格行
					let restoredLine = '| ' + translatedCells.slice(1, -1).join(' | ') + ' |';

					// 恢復行內程式碼
					inlineCodeMap.forEach((originalCode, placeholder) => {
						restoredLine = restoredLine.replace(placeholder, originalCode);
					});

					translatedLines.push(restoredLine);
				} else {
					// 非表格行，正常翻譯（但跳過程式碼區塊）
					if (line.trim() === '') {
						translatedLines.push(line);
					} else {
						try {
							// 保護行內程式碼
							let protectedLine = line;
							const inlineCodeMap = new Map<string, string>();
							let inlineCodeIndex = 0;

							const codeMatches = Array.from(protectedLine.matchAll(/`[^`\n]+?`/g));
							codeMatches.reverse().forEach(match => {
								const placeholder = `__INLINECODE${inlineCodeIndex++}__`;
								inlineCodeMap.set(placeholder, match[0]);
								protectedLine = protectedLine.substring(0, match.index!) + placeholder + protectedLine.substring(match.index! + match[0].length);
							});

							const translated = await this.callDeepL(protectedLine, targetLang);

							// 恢復行內程式碼
							let restoredLine = translated;
							inlineCodeMap.forEach((originalCode, placeholder) => {
								restoredLine = restoredLine.replace(placeholder, originalCode);
							});

							translatedLines.push(restoredLine);
						} catch (error) {
							translatedLines.push(line);
						}
					}
				}
			}

			// Step 3: 恢復多行程式碼區塊
			let finalText = translatedLines.join('\n');
			codeBlockMap.forEach((originalBlock, placeholder) => {
				finalText = finalText.replace(placeholder, originalBlock);
			});

			// 更新內容
			if (isFullPage) {
				editor.setValue(finalText);
			} else {
				editor.replaceSelection(finalText);
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

			// 3. 先恢復管道符號和其他佔位符
			let restoredText = this.restoreContent(convertedText, placeholderMap);

			// 4. 恢復表格分隔行
			restoredText = this.restoreTableSeparators(restoredText, separators);

			// 5. 更新內容
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

		// 🎯 使用JSON格式请求，使用可调整的参数
		const requestData: any = {
			text: [text], // 必须是数组格式
			target_lang: targetLang,
			enable_beta_languages: true,
			show_billed_characters: true,
		};

		// 根据设置添加可选参数
		if (this.settings.preserveFormatting !== undefined) {
			requestData.preserve_formatting = this.settings.preserveFormatting;
		}
		
		if (this.settings.splitSentences) {
			requestData.split_sentences = this.settings.splitSentences;
		}
		
		if (this.settings.tagHandling) {
			requestData.tag_handling = this.settings.tagHandling;
			requestData.tag_handling_version = "v1";
		}
		
		if (this.settings.nonSplittingTags) {
			requestData.non_splitting_tags = this.settings.nonSplittingTags.split(',').map(tag => tag.trim()).filter(tag => tag);
		}
		
		if (this.settings.ignoreTags) {
			requestData.ignore_tags = this.settings.ignoreTags.split(',').map(tag => tag.trim()).filter(tag => tag);
		}
		
		if (this.settings.outlineDetection !== undefined) {
			requestData.outline_detection = this.settings.outlineDetection;
		}
		
		if (this.settings.formality) {
			requestData.formality = this.settings.formality;
		}
		
		if (this.settings.modelType) {
			requestData.model_type = this.settings.modelType;
		}
		
		if (this.settings.context) {
			requestData.context = this.settings.context;
		}
		
		if (this.settings.glossaryId) {
			requestData.glossary_id = this.settings.glossaryId;
		}
		
		if (this.settings.styleId) {
			requestData.style_id = this.settings.styleId;
		}
		
		if (this.settings.customInstructions) {
			requestData.custom_instructions = this.settings.customInstructions.split(',').map(inst => inst.trim()).filter(inst => inst);
		}

		try {
			const response = await requestUrl({
				url: endpoint,
				method: 'POST',
				headers: {
					'Authorization': `DeepL-Auth-Key ${this.settings.deepLApiKey}`,
					'Content-Type': 'application/json' // 使用JSON格式
				},
				body: JSON.stringify(requestData) // 序列化为JSON
			});

			if (response.status !== 200) {
				console.error('DeepL API Response:', response);
				throw new Error(`API Error: ${response.status} ${response.text}`);
			}

			const data = response.json;
			if (!data.translations || !data.translations[0]) {
				throw new Error('Invalid API response: missing translations');
			}

			return data.translations[0].text;
		} catch (error) {
			console.error('DeepL API call failed:', error);
			throw error;
		}
	}

	// --- 判断是否为拉丁语系到亚洲语言的翻译 ---
	isLatinToAsianTranslation(targetLang: string): boolean {
		const asianLanguages = ['ZH', 'ZH-HANT', 'JA', 'KO'];
		return asianLanguages.includes(targetLang);
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

		// === Basic Settings ===
		containerEl.createEl('h3', {text: 'Basic Settings'});

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

		// === Advanced Settings ===
		containerEl.createEl('h3', {text: 'Advanced Settings'});

		new Setting(containerEl)
			.setName('Model Type')
			.setDesc('Translation model quality. Options: "", "quality_optimized", "speed_optimized". Leave empty for default')
			.addText(text => text
				.setPlaceholder('quality_optimized')
				.setValue(this.plugin.settings.modelType)
				.onChange(async (value) => {
					this.plugin.settings.modelType = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Formality')
			.setDesc('Translation formality level for supported languages')
			.addDropdown(dropDown => dropDown
				.addOption('default', 'Default')
				.addOption('more', 'More Formal')
				.addOption('less', 'Less Formal')
				.setValue(this.plugin.settings.formality)
				.onChange(async (value) => {
					this.plugin.settings.formality = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Context')
			.setDesc('Additional context for better translation (optional)')
			.addText(text => text
				.setPlaceholder('This is a technical document...')
				.setValue(this.plugin.settings.context)
				.onChange(async (value) => {
					this.plugin.settings.context = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Glossary ID')
			.setDesc('UUID of DeepL glossary for consistent terminology (optional)')
			.addText(text => text
				.setPlaceholder('def3a26b-3e84-45b3-84ae-0c0aaf3525f7')
				.setValue(this.plugin.settings.glossaryId)
				.onChange(async (value) => {
					this.plugin.settings.glossaryId = value;
					await this.plugin.saveSettings();
				}));
	}
}