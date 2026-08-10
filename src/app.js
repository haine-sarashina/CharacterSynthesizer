// ComfyUI Server Configuration & Tauri IPC Storage Adapter
import { invoke } from '@tauri-apps/api/core';

async function diskSave(key, data) {
    try {
        await invoke('save_app_data', { key: key, content: JSON.stringify(data) });
    } catch (e) {
        console.error(`Failed to save ${key} to disk via Rust IPC:`, e);
        localStorage.setItem(key, JSON.stringify(data));
    }
}

async function diskLoad(key, defaultVal) {
    try {
        const str = await invoke('load_app_data', { key: key });
        if (!str || str.trim() === "") {
            const local = localStorage.getItem(key);
            if (local) {
                try {
                    const parsed = JSON.parse(local);
                    await diskSave(key, parsed);
                    return parsed;
                } catch (e) {}
            }
            return defaultVal;
        }
        return JSON.parse(str);
    } catch (e) {
        console.error(`Failed to load ${key} via Rust IPC:`, e);
        const local = localStorage.getItem(key);
        return local ? JSON.parse(local) : defaultVal;
    }
}

const SERVER_URL = "127.0.0.1:8188";
const CLIENT_ID = "char_synthesizer_" + Math.random().toString(36).substr(2, 9);

// UI Elements
const modelSelect = document.getElementById("model-select");
const vaeSelect = document.getElementById("vae-select");
const clipSelect = document.getElementById("clip-select");
const promptInput = document.getElementById("prompt-input");
const magicPromptInput = document.getElementById("magic-prompt");
const ollamaModelSelect = document.getElementById("ollama-model");
const negativeInput = document.getElementById("negative-input");
const imageWidthSelect = document.getElementById("image-width");
const imageHeightSelect = document.getElementById("image-height");
const batchSizeInput = document.getElementById("batch-size");
const stepsInput = document.getElementById("steps");
const cfgInput = document.getElementById("cfg-scale");
const clipSkipInput = document.getElementById("clip-skip");

const generateBtn = document.getElementById("generate-btn");
const btnFormatPrompt = document.getElementById("btn-format-prompt");
const synthesizeBtn = document.getElementById("synthesize-btn");
const saveBaseBtn = document.getElementById("save-base-btn");

const tagsList = document.getElementById("tags-list");
const addTagBtn = document.getElementById("add-tag-btn");
const pasteTagsBtn = document.getElementById("paste-tags-btn");
const copyTagsBtn = document.getElementById("copy-tags-btn");
const textConfirmArea = document.getElementById("text-confirm");
const metaTagsInput = document.getElementById("meta-tags-input");
const ratingSelect = document.getElementById("rating-select");

// --- Global UI Lock during Heavy Processing (Magic Prompt / Gacha Roll / Synthesis) ---
function setUIBusy(isBusy) {
    const controls = [
        magicPromptInput, textConfirmArea, metaTagsInput, negativeInput,
        imageWidthSelect, imageHeightSelect, batchSizeInput, stepsInput, cfgInput,
        modelSelect, vaeSelect, clipSelect, ratingSelect
    ];
    controls.forEach(el => { if (el) el.disabled = isBusy; });

    const buttons = [
        document.getElementById("btn-magic-prompt"),
        btnFormatPrompt, generateBtn, synthesizeBtn, saveBaseBtn,
        addTagBtn, pasteTagsBtn, copyTagsBtn,
        document.getElementById("settings-btn"),
        document.getElementById("save-library-btn"),
        document.getElementById("toggle-history-btn"),
        document.getElementById("btn-clear-base"),
        document.getElementById("btn-clear-part")
    ];
    buttons.forEach(btn => { if (btn) btn.disabled = isBusy; });

    const tagContainer = document.getElementById("tags-editor-container");
    if (tagContainer) {
        tagContainer.style.pointerEvents = isBusy ? "none" : "auto";
        tagContainer.style.opacity = isBusy ? "0.55" : "1";
    }

    if (!isBusy && promptInput && promptInput.value.trim().length === 0 && generateBtn) {
        generateBtn.disabled = true;
    }
}

// --- Dynamic Tags Logic ---
function createTagRow(tagName = "", weight = 1.0) {
    const row = document.createElement("div");
    row.className = "tag-row";
    
    const inputName = document.createElement("input");
    inputName.type = "text";
    inputName.className = "tag-input";
    inputName.value = tagName;
    inputName.placeholder = "tag";
    
    const inputWeight = document.createElement("input");
    inputWeight.type = "number";
    inputWeight.className = "tag-weight";
    inputWeight.value = parseFloat(weight).toFixed(1);
    inputWeight.min = "0.0";
    inputWeight.max = "2.0";
    inputWeight.step = "0.1";
    
    const removeBtn = document.createElement("button");
    removeBtn.className = "tag-remove-btn";
    removeBtn.innerText = "×";
    removeBtn.onclick = () => {
        row.remove();
        saveSettings();
        validateTags();
    };
    
    inputName.addEventListener("input", () => { saveSettings(); validateTags(); });
    inputWeight.addEventListener("input", saveSettings);
    
    row.appendChild(inputName);
    row.appendChild(inputWeight);
    row.appendChild(removeBtn);
    
    return row;
}

function renderTags(tagsArray) {
    tagsList.innerHTML = "";
    if (!tagsArray || tagsArray.length === 0) return;
    
    tagsArray.forEach(tag => {
        // Parse possible weighting like (tag:1.2) or just tag
        let name = tag.trim();
        let weight = 1.0;
        
        if (name.startsWith("(") && name.endsWith(")")) {
            const inner = name.slice(1, -1);
            const parts = inner.split(":");
            if (parts.length === 2 && !isNaN(parseFloat(parts[1]))) {
                name = parts[0].trim();
                weight = parseFloat(parts[1]);
            }
        }
        
        if (name) {
            tagsList.appendChild(createTagRow(name, weight));
        }
    });
}

function getTagsFromUI() {
    const rows = tagsList.querySelectorAll(".tag-row");
    const tags = [];
    rows.forEach(row => {
        const name = row.querySelector(".tag-input").value.trim();
        const weight = parseFloat(row.querySelector(".tag-weight").value);
        if (name) {
            if (weight !== 1.0 && !isNaN(weight)) {
                tags.push(`(${name}:${weight.toFixed(1)})`);
            } else {
                tags.push(name);
            }
        }
    });
    return tags;
}

if (addTagBtn) {
    addTagBtn.addEventListener("click", () => {
        tagsList.appendChild(createTagRow());
        saveSettings();
    });
}

if (pasteTagsBtn) {
    pasteTagsBtn.addEventListener("click", () => {
        const text = prompt("Paste tags separated by commas or newlines:");
        if (text) {
            const pastedTags = text.split(/[\n,]+/).map(t => t.trim()).filter(t => t);
            const currentTags = getTagsFromUI();
            const combined = [...currentTags, ...pastedTags];
            renderTags(combined);
            saveSettings();
            validateTags();
        }
    });
}

if (copyTagsBtn) {
    copyTagsBtn.addEventListener("click", () => {
        const tags = getTagsFromUI();
        if (tags.length === 0) {
            alert("No tags to copy.");
            return;
        }
        navigator.clipboard.writeText(tags.join(",\n")).then(() => {
            alert("Copied to clipboard!");
        });
    });
}
// ----------------------------

const samplerNameSelect = document.getElementById("sampler-name");
const schedulerSelect = document.getElementById("scheduler");

// Danbooru Tag Dictionary
let danbooruTags = new Set();
let danbooruTagsArray = [];
let danbooruTagCategories = new Map();

async function loadDanbooruTags() {
    try {
        const response = await fetch('danbooru.csv');
        if (!response.ok) throw new Error("Could not load danbooru.csv");
        const csvText = await response.text();
        const lines = csvText.split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            const parts = line.split(',');
            const tag = parts[0].trim();
            const category = parseInt(parts[1], 10);
            if (tag && tag !== "tag_name") { // skip header if exists
                const tagWithSpace = tag.replace(/_/g, ' ');
                danbooruTags.add(tag);
                danbooruTags.add(tagWithSpace);
                danbooruTagsArray.push(tagWithSpace);
                if (!isNaN(category)) {
                    danbooruTagCategories.set(tag, category);
                }
            }
        }
        console.log(`Loaded ${danbooruTagsArray.length} Danbooru tags.`);
    } catch (e) {
        console.error("Failed to load Danbooru tags dictionary.", e);
    }
}
// Load on startup
loadDanbooruTags();

// Ollama Magic Prompt Generation
async function generateAnimaPrompt() {
    const magicInput = magicPromptInput.value;
    const btn = document.getElementById('btn-magic-prompt');
    
    if (!magicInput.trim()) {
        alert("情景を入力してください。");
        return;
    }
    
    setUIBusy(true);
    btn.innerHTML = '<span class="icon">✨</span> Generating...';
    
    // 既存のタグとテキストを保持
    const existingTags = getTagsFromUI();
    const existingText = textConfirmArea.value;
    
    promptInput.value = ""; // Clear Positive Prompt
    renderTags([]);
    textConfirmArea.value = "";
    document.getElementById('tags-warnings').innerHTML = ""; // Clear warnings
    saveSettings(); // Save immediately so reload doesn't bring them back
    
    const systemPrompt = `You are an expert prompt engineer for an Anime-style AI image generator called Anima.
Your task is to translate the user's Japanese description into an English prompt EXACTLY as requested, without hallucinating.
CRITICAL RULE 1: ALL outputs MUST be in English ONLY. Do NOT output ANY Japanese or Chinese characters.
CRITICAL RULE 2: Output ONLY a valid JSON object. Do NOT output ANY "thinking process", "thought process", explanations, or conversational text. Provide ONLY the JSON.
CRITICAL RULE 3: The "tags" array MUST contain ONLY short Danbooru-style tags (maximum 1-3 words). ABSOLUTELY NO sentences, verbs, or prepositional phrases. 
CRITICAL RULE 4: DO NOT OMIT ANY DETAILS. You must exhaustively translate EVERY SINGLE concept, clothing item, background element, and action provided by the user into tags. Do NOT summarize or skip anything.
BAD TAGS: "a girl with red hair", "she is standing", "looking at the viewer", "in the city"
GOOD TAGS: "1girl", "red hair", "standing", "looking at viewer", "city"
Do NOT make up random clothing, weapons, or backgrounds unless implied. 

Rules for the "tags" array (MUST be in this specific order according to Anima guide):
1. Subject count & Character: (e.g., "1girl", "solo", "original character", "hatsune miku").
2. Body & Hair & Face & Outfit: (e.g., "pale skin", "long hair", "red hair", "blue eyes", "school uniform").
3. Pose & Action: (e.g., "standing", "looking at viewer", "holding umbrella").
4. Camera & Composition: (e.g., "full body", "cowboy shot", "from above").
5. Background & Scene: (e.g., "city", "night", "rain").
6. Lighting & Effects: (e.g., "cinematic lighting", "lens flare").
(Note: Do NOT include meta/quality tags like "masterpiece" or rating tags as they are added separately by the system.)

Rules for the "text" array:
Provide 1 to 3 English sentences describing the scene, action, and atmosphere faithfully.

You MUST output a valid JSON object with EXACTLY two arrays:
1. "tags": An array of strings following the order above. MUST BE ENGLISH ONLY and SHORT TAGS ONLY.
2. "text": An array of strings containing the natural language description. MUST BE ENGLISH ONLY.

Do NOT use parentheses or weight modifiers like (1girl:1.2).
Do NOT include any markdown code blocks (like \`\`\`json). Just the raw JSON object starting with { and ending with }.

Example JSON output:
{
  "tags": ["1girl", "solo", "long red hair", "blue eyes", "standing", "looking at viewer", "full body", "city", "night", "cinematic lighting"],
  "text": ["A young woman with long red hair and blue eyes is standing in the city at night."]
}`;
    let elapsedSeconds = 0;
    const timerInterval = setInterval(() => {
        elapsedSeconds++;
        btn.innerHTML = `<span class="icon">✨</span> Generating... (${elapsedSeconds}s)`;
    }, 1000);
    
    try {
        const ollamaModel = document.getElementById('ollama-model').value;
        const ollamaKeepAlive = document.getElementById('ollama-keep-alive')?.checked || false;
        const respText = await invoke("ollama_generate", {
            model: ollamaModel,
            prompt: magicInput,
            system: systemPrompt,
            keepAlive: ollamaKeepAlive
        });
        console.log("Ollama raw response via Rust IPC:", respText);
        
        if (!respText || respText.trim() === "") {
            throw new Error("Ollama returned an empty response. The model might not support the current prompt or options.");
        }
        let rawStr = respText.trim();
        // Remove standard <think> blocks
        rawStr = rawStr.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        
        // Isolate JSON block using brace counting to avoid trailing text with stray braces
        const firstBrace = rawStr.indexOf('{');
        let jsonStr = rawStr;
        
        if (firstBrace !== -1) {
            let depth = 0;
            let lastBrace = -1;
            for (let i = firstBrace; i < rawStr.length; i++) {
                if (rawStr[i] === '{') depth++;
                else if (rawStr[i] === '}') {
                    depth--;
                    if (depth === 0) {
                        lastBrace = i;
                        break;
                    }
                }
            }
            if (lastBrace !== -1) {
                jsonStr = rawStr.substring(firstBrace, lastBrace + 1);
            }
        }

        let jsonResponse = null;
        try {
            // Attempt to auto-fix common JSON errors like trailing commas
            const cleanedJsonStr = jsonStr.replace(/,\s*([\}\]])/g, '$1');
            jsonResponse = JSON.parse(cleanedJsonStr);
        } catch (parseError) {
            console.warn("JSON parse failed, attempting fallback regex parsing...", parseError);
            jsonResponse = { tags: [], text: [] };
            
            // Extract anything that looks like an array of strings
            const arraysMatches = [...jsonStr.matchAll(/\[(.*?)\]/gs)];
            
            if (arraysMatches.length > 0) {
                // Assume first array is tags
                const tagsStr = arraysMatches[0][1];
                const tagRegex = /"([^"]+)"/g;
                let m;
                while ((m = tagRegex.exec(tagsStr)) !== null) {
                    jsonResponse.tags.push(m[1]);
                }
                
                // Assume second array (if exists) is text
                if (arraysMatches.length > 1) {
                    const textStr = arraysMatches[1][1];
                    while ((m = tagRegex.exec(textStr)) !== null) {
                        jsonResponse.text.push(m[1]);
                    }
                }
            }
            
            if (jsonResponse.tags.length === 0 && jsonResponse.text.length === 0) {
                // Ultimate fallback: Just put the extracted JSON block in text so the user doesn't lose it
                jsonResponse.text = [jsonStr];
            }
        }
        
        // In v0.3.4, Generate Magic Prompt overwrote the UI. We restore this behavior to prevent stacking previous generations.
        // We only preserve unexpanded presets (#...) in case the user manually added them to the UI before generating.
        const unexpandedTagPresets = existingTags.filter(t => t.startsWith('#'));
        let finalTags = Array.isArray(jsonResponse.tags) ? [...unexpandedTagPresets, ...jsonResponse.tags] : [...unexpandedTagPresets];
        
        const unexpandedTextPresets = existingText.split('\n').map(t => t.trim()).filter(t => t.startsWith('#'));
        let finalTexts = Array.isArray(jsonResponse.text) ? [...unexpandedTextPresets, ...jsonResponse.text] : [...unexpandedTextPresets];
        
        // Expand presets based on Magic Prompt input and Ollama output
        const magicStr = magicInput.toLowerCase();
        Object.keys(customPresets).forEach(presetName => {
            const pLower = presetName.toLowerCase();
            const foundInTags = finalTags.some(t => t.toLowerCase() === pLower);
            const foundInText = finalTexts.join('\n').toLowerCase().includes(pLower);
            const foundInMagic = magicStr.includes(pLower);
            
            if (foundInTags || foundInText || foundInMagic) {
                // Remove the preset name itself if Ollama output it as a tag
                finalTags = finalTags.filter(t => t.toLowerCase() !== pLower);
                
                const preset = customPresets[presetName];
                if (preset.tags && preset.tags.length > 0) {
                    preset.tags.forEach(subTag => {
                        if (!finalTags.includes(subTag)) {
                            finalTags.push(subTag);
                        }
                    });
                }
                
                if (preset.text && preset.text.trim()) {
                    const presetTxt = preset.text.trim();
                    if (!finalTexts.includes(presetTxt)) {
                        finalTexts.push(presetTxt);
                    }
                }
            }
        });
        
        finalTags = [...new Set(finalTags)];
        renderTags(finalTags);
        textConfirmArea.value = finalTexts.join('\n');
        
        saveSettings();
        
    } catch (error) {
        console.error("Ollama API Error or Parse Error:", error);
        alert(`処理中にエラーが発生しました。\n詳細: ${error.message}`);
    } finally {
        clearInterval(timerInterval);
        setUIBusy(false);
        btn.innerHTML = '<span class="icon">🪄</span> Generate Magic Prompt';
    }
}

// --- Custom Character & Costume Presets (LoRA & Tag Macros) ---
let customPresets = {};

async function loadCustomPresets() {
    customPresets = await diskLoad("custom_presets", null);
    if (!customPresets) {
        customPresets = await diskLoad("anima_custom_presets", {});
    }
    renderPresetsList();
    renderQuickPresetPalette();
    console.log("✅ PC内永続バックアップ(data/custom_presets.json)からプリセットが同期・ロードされました！");
}

function saveCustomPresets() {
    renderPresetsList();
    renderQuickPresetPalette();
    diskSave("custom_presets", customPresets).then(() => {
        console.log("💾 プリセットがPCのフォルダ(data/custom_presets.json)に自動永続保存されました！");
    });
}




function renderPresetsList() {
    const container = document.getElementById("presets-list-container");
    if (!container) return;
    const keys = Object.keys(customPresets);
    if (keys.length === 0) {
        container.innerHTML = '<div style="text-align: center; opacity: 0.5; font-size: 0.85em; padding: 10px;">登録されているプリセットはありません。</div>';
        return;
    }
    container.innerHTML = "";
    keys.forEach(key => {
        const p = customPresets[key];
        const card = document.createElement("div");
        card.className = "preset-card";
        
        const infoDiv = document.createElement("div");
        infoDiv.className = "preset-card-info";
        
        const titleDiv = document.createElement("div");
        titleDiv.className = "preset-card-title";
        titleDiv.innerHTML = `<span>${p.name}</span>` + (p.lora_name ? `<span class="preset-card-badge">LoRA: ${p.lora_name} (${p.weight})</span>` : '');
        
        const tagsDiv = document.createElement("div");
        tagsDiv.className = "preset-card-tags";
        let summaryParts = [];
        if (p.tags && p.tags.length > 0) summaryParts.push(`<b>Tags:</b> ${p.tags.join(", ")}`);
        if (p.text && p.text.trim()) summaryParts.push(`<b>Text:</b> ${p.text.trim()}`);
        tagsDiv.innerHTML = summaryParts.length > 0 ? summaryParts.join("<br>") : "タグ/文章展開なし";
        
        infoDiv.appendChild(titleDiv);
        infoDiv.appendChild(tagsDiv);
        
        const actionsDiv = document.createElement("div");
        actionsDiv.className = "preset-card-actions";
        
        const editBtn = document.createElement("button");
        editBtn.className = "dna-delete-btn";
        editBtn.style.color = "var(--accent-color)";
        editBtn.title = "内容を編集";
        editBtn.innerHTML = "✏️";
        editBtn.onclick = () => {
            document.getElementById("preset-name-input").value = p.name;
            document.getElementById("preset-tags-input").value = p.tags ? p.tags.join(", ") : "";
            const textInput = document.getElementById("preset-text-input");
            if (textInput) textInput.value = p.text || "";
            const loraSelect = document.getElementById("preset-lora-select");
            if (loraSelect && p.lora_name) loraSelect.value = p.lora_name;
            else if (loraSelect) loraSelect.value = "";
            const weightInput = document.getElementById("preset-lora-weight");
            if (weightInput && p.weight !== undefined) weightInput.value = p.weight;
            document.getElementById("preset-name-input").focus();
        };
        actionsDiv.appendChild(editBtn);
        
        const delBtn = document.createElement("button");
        delBtn.className = "dna-delete-btn";
        delBtn.title = "削除";
        delBtn.innerHTML = "🗑️";
        delBtn.onclick = () => {
            if (confirm(`プリセット ${p.name} を削除してもよろしいですか？`)) {
                delete customPresets[key];
                saveCustomPresets();
            }
        };
        actionsDiv.appendChild(delBtn);
        
        card.appendChild(infoDiv);
        card.appendChild(actionsDiv);
        container.appendChild(card);
    });
}

function renderQuickPresetPalette() {
    const palette = document.getElementById("quick-preset-palette");
    if (!palette) return;
    const keys = Object.keys(customPresets);
    
    palette.innerHTML = '<span style="font-size: 0.8em; color: var(--accent-color); opacity: 0.8;">⚡ プリセット呼び出し:</span>';
    
    if (keys.length === 0) {
        palette.innerHTML += '<span id="no-preset-msg" style="font-size: 0.8em; opacity: 0.5;">(⚙️設定からキャラ・服装を登録できます)</span>';
        return;
    }
    
    keys.forEach(key => {
        const btn = document.createElement("button");
        btn.className = "preset-quick-btn";
        btn.innerText = key;
        btn.title = `クリックで ${key} をタグに挿入`;
        btn.onclick = () => {
            const current = getTagsFromUI();
            if (!current.includes(key)) {
                current.push(key);
                renderTags(current);
                validateTags();
                saveSettings();
            }
        };
        palette.appendChild(btn);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const btnSavePreset = document.getElementById("btn-save-preset");
    if (btnSavePreset) {
        btnSavePreset.addEventListener("click", () => {
            let name = document.getElementById("preset-name-input").value.trim();
            if (!name) {
                alert("登録タグ名を入力してください (例: #ボブ子)");
                return;
            }
            if (!name.startsWith("#")) {
                name = "#" + name;
            }
            const tagsStr = document.getElementById("preset-tags-input").value;
            const tags = tagsStr.split(",").map(t => t.trim()).filter(t => t.length > 0);
            const textInput = document.getElementById("preset-text-input");
            const text = textInput ? textInput.value.trim() : "";
            const loraSelect = document.getElementById("preset-lora-select");
            const loraName = loraSelect ? loraSelect.value : "";
            const weightInput = document.getElementById("preset-lora-weight");
            const weight = weightInput ? parseFloat(weightInput.value) || 0.8 : 0.8;
            
            customPresets[name] = { name, tags, text, lora_name: loraName, weight };
            saveCustomPresets();
            
            document.getElementById("preset-name-input").value = "";
            document.getElementById("preset-tags-input").value = "";
            if (textInput) textInput.value = "";
            if (loraSelect) loraSelect.value = "";
            if (weightInput) weightInput.value = "0.80";
        });
    }
});

// Helper to sort tags based on Anima guide
function getTagSortWeight(tag) {
    const t = tag.toLowerCase().trim();
    if (t.startsWith('#')) return 5; // Custom presets always float to the very top!
    const cat = danbooruTagCategories.get(t.replace(/ /g, '_')) ?? 0;
    
    // 1. Subject Count & Character & Artist & Series
    if (cat === 4 || cat === 3 || cat === 1 || t.match(/^[0-9]+(girl|boy)s?$/) || ['solo', 'multiple girls', 'multiple boys', 'group', 'original character'].includes(t)) {
        return 10;
    }
    
    // 4. Camera & Composition
    const cameraTags = ['full body', 'cowboy shot', 'upper body', 'close-up', 'portrait', 'from above', 'from below', 'from side', 'from behind', 'dutch angle', 'fisheye', 'depth of field', 'blurry background', 'blurry foreground', 'focus', 'pov', 'wide shot', 'macro'];
    if (cameraTags.some(c => t.includes(c))) return 40;
    
    // 5. Background & Scene
    const bgTags = ['background', 'scenery', 'city', 'sky', 'night', 'day', 'outdoors', 'indoors', 'room', 'forest', 'beach', 'water', 'building', 'cloud', 'tree', 'sunset', 'sunrise', 'rain', 'snow', 'nature'];
    if (bgTags.some(c => t.includes(c))) return 50;
    
    // 6. Lighting & Effects
    const lightTags = ['lighting', 'shadow', 'flare', 'glow', 'sparkle', 'particles', 'ray', 'sunlight', 'moonlight', 'chromatic aberration', 'cinematic', 'bloom', 'neon', 'light'];
    if (lightTags.some(c => t.includes(c))) return 60;
    
    // 3. Pose & Action
    if (t.endsWith('ing')) return 30;
    const poseTags = ['sitting', 'standing', 'lying', 'kneeling', 'squatting', 'crouching', 'leaning'];
    if (poseTags.some(c => t.includes(c))) return 30;
    
    // 2. Body & Hair & Face & Outfit (Everything else in General)
    return 20;
}

// Format final prompt from tags and text (with Preset expansion)
function formatFinalPrompt() {
    let metaTags = metaTagsInput.value.split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0)
        .join(', ');
    const rating = ratingSelect.value;
    
    // Expand presets and sort individual tags based on Anima guide
    let tags = getTagsFromUI();
    let expandedTags = [];
    let addedTexts = [];
    
    tags.forEach(t => {
        const trimmed = t.trim();
        if (!trimmed) return;
        if (!expandedTags.includes(trimmed)) expandedTags.push(trimmed);
    });
    
    // Scan ALL inputs (Tags, Step 2 Text, Step 1 Japanese Magic Prompt, Final Prompt) for any #preset mentions!
    Object.keys(customPresets).forEach(presetName => {
        const pLower = presetName.toLowerCase();
        const foundInTags = expandedTags.some(t => t.toLowerCase() === pLower);
        const foundInText = textConfirmArea && textConfirmArea.value.toLowerCase().includes(pLower);
        
        if (foundInTags || foundInText) {
            expandedTags = expandedTags.filter(t => t.toLowerCase() !== pLower);
            const preset = customPresets[presetName];
            if (preset.tags && preset.tags.length > 0) {
                preset.tags.forEach(subTag => {
                    if (!expandedTags.includes(subTag)) {
                        expandedTags.push(subTag);
                    }
                });
            }
            if (preset.text && preset.text.trim()) {
                const presetTxt = preset.text.trim();
                const currentTextVal = textConfirmArea.value.trim();
                if (!currentTextVal.includes(presetTxt) && !addedTexts.includes(presetTxt)) {
                    addedTexts.push(presetTxt);
                }
            }
        }
    });
    
    const validTags = [...new Set(expandedTags)];
    validTags.sort((a, b) => getTagSortWeight(a) - getTagSortWeight(b));
    
    // Re-render the tags in the UI to reflect the new order and expanded items
    renderTags(validTags);
    
    // Inject any added texts into Text area!
    if (addedTexts.length > 0) {
        let currentLines = textConfirmArea.value.split('\n').map(t => t.trim()).filter(t => t.length > 0);
        addedTexts.forEach(txt => {
            if (!currentLines.includes(txt)) {
                currentLines.push(txt);
            }
        });
        textConfirmArea.value = currentLines.join('\n');
    }
    
    const text = textConfirmArea.value.split('\n')
        .map(t => t.trim())
        .filter(t => t.length > 0)
        .join(' ');
        
    saveSettings();
    
    // Filter out #tags from final prompt string (since they are macros/identifiers, not for CLIP encoders)
    const promptTags = validTags.filter(t => !t.trim().startsWith('#'));
    let cleanText = text;
    Object.keys(customPresets).forEach(pName => {
        const regex = new RegExp(pName, 'gi');
        cleanText = cleanText.replace(regex, '').trim();
    });
    // Also strip any stray #tokens from cleanText just in case
    cleanText = cleanText.replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
    
    // Combine everything: Meta -> Rating -> Tags -> Text
    let finalPromptParts = [];
    if (metaTags) finalPromptParts.push(metaTags);
    if (rating) finalPromptParts.push(rating);
    if (promptTags.length > 0) finalPromptParts.push(promptTags.join(', '));
    if (cleanText) finalPromptParts.push(cleanText);
    
    let finalPrompt = finalPromptParts.join(', ').replace(/,\s*,/g, ',').trim();
    if (finalPrompt.startsWith(',')) finalPrompt = finalPrompt.substring(1).trim();
    if (finalPrompt.endsWith(',')) finalPrompt = finalPrompt.substring(0, finalPrompt.length - 1).trim();
    
    promptInput.value = finalPrompt;
    if (finalPrompt.trim().length > 0) {
        generateBtn.disabled = false;
    } else {
        generateBtn.disabled = true;
    }
    saveSettings();
}

const clipsegPrompt = document.getElementById("clipseg-prompt");
const denoiseSlider = document.getElementById("denoise-slider");
const denoiseVal = document.getElementById("denoise-val");

const candidatesGrid = document.getElementById("candidates-grid");
const scrollLeftBtn = document.getElementById("scroll-left-btn");
const scrollRightBtn = document.getElementById("scroll-right-btn");

const basePreviewImg = document.getElementById("base-preview-img");
const basePlaceholder = document.getElementById("base-placeholder");
const partPreviewImg = document.getElementById("part-preview-img");
const partPlaceholder = document.getElementById("part-placeholder");

const resultImg = document.getElementById("result-img");
const resultPlaceholder = document.getElementById("result-placeholder");

// ... (existing modal logic)

// Carousel Scroll Logic
if (scrollLeftBtn && candidatesGrid) {
    scrollLeftBtn.addEventListener("click", () => {
        candidatesGrid.scrollBy({ left: -400, behavior: 'smooth' });
    });
}
if (scrollRightBtn && candidatesGrid) {
    scrollRightBtn.addEventListener("click", () => {
        candidatesGrid.scrollBy({ left: 400, behavior: 'smooth' });
    });
}

const progressContainer = document.getElementById("progress-container");
const progressStatus = document.getElementById("progress-status");
const progressPercent = document.getElementById("progress-percent");
const progressBar = document.getElementById("progress-bar");

// Modal Elements (Image)
const imageModal = document.getElementById("image-modal");
const modalImg = document.getElementById("modal-img");
const modalClose = document.getElementById("modal-close");

// Modal Elements (Settings)
const settingsModal = document.getElementById("settings-modal");
const btnOpenSettings = document.getElementById("btn-open-settings");
const settingsClose = document.getElementById("settings-close");

// Image Modal Functions
function openModal(imgUrl) {
    if (imageModal && modalImg) {
        modalImg.src = imgUrl;
        imageModal.classList.remove("hidden");
    }
}
function closeModal() {
    if (imageModal) imageModal.classList.add("hidden");
}
if (modalClose) modalClose.addEventListener("click", closeModal);
if (imageModal) {
    imageModal.addEventListener("click", (e) => {
        if (e.target === imageModal) closeModal();
    });
}

// Settings Modal Functions
function openSettingsModal() {
    if (settingsModal) {
        settingsModal.classList.remove("hidden");
    }
}
function closeSettingsModal() {
    if (settingsModal) {
        settingsModal.classList.add("hidden");
    }
}
if (btnOpenSettings) btnOpenSettings.addEventListener("click", openSettingsModal);
if (settingsClose) settingsClose.addEventListener("click", closeSettingsModal);
if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
        if (e.target === settingsModal) closeSettingsModal();
    });
}

// State
let currentCandidates = [];
let baseImageUrl = null;
let baseFilename = null;
let partImageUrl = null;
let partFilename = null;
let synthesizedImageUrl = null;
let synthesizedFilename = null;

// Slider sync
denoiseSlider.addEventListener("input", (e) => {
    denoiseVal.textContent = parseFloat(e.target.value).toFixed(2);
});

// Load Models from ComfyUI
async function loadModels() {
    try {
        const response = await fetch(`http://${SERVER_URL}/object_info/UNETLoader`);
        const info = await response.json();
        
        let allModels = [];
        if (info.UNETLoader && info.UNETLoader.input.required.unet_name) {
            allModels = info.UNETLoader.input.required.unet_name[0];
        }
        
        // Remove duplicates and populate
        allModels = [...new Set(allModels)];
        modelSelect.innerHTML = "";
        allModels.forEach(model => {
            const opt = document.createElement("option");
            opt.value = model;
            opt.innerText = model;
            modelSelect.appendChild(opt);
        });
    } catch (e) {
        console.warn("Failed to load diffusion_models.", e);
    }
}

// Load Text Encoders (CLIP) from ComfyUI
async function loadCLIPs() {
    try {
        const response = await fetch(`http://${SERVER_URL}/object_info/CLIPLoader`);
        const info = await response.json();
        if (info.CLIPLoader && info.CLIPLoader.input.required.clip_name) {
            const clips = info.CLIPLoader.input.required.clip_name[0];
            clipSelect.innerHTML = '<option value="default">Default</option>';
            clips.forEach(clip => {
                const opt = document.createElement("option");
                opt.value = clip;
                opt.innerText = clip;
                clipSelect.appendChild(opt);
            });
        }
    } catch (e) {
        console.warn("Failed to load CLIPs.", e);
    }
}

// Load VAEs from ComfyUI
async function loadVAEs() {
    try {
        const response = await fetch(`http://${SERVER_URL}/object_info/VAELoader`);
        const info = await response.json();
        if (info.VAELoader && info.VAELoader.input.required.vae_name) {
            const vaes = info.VAELoader.input.required.vae_name[0];
            vaeSelect.innerHTML = '<option value="baked">None (Use Baked VAE)</option>';
            vaes.forEach(vae => {
                const opt = document.createElement("option");
                opt.value = vae;
                opt.innerText = vae;
                vaeSelect.appendChild(opt);
            });
        }
    } catch (e) {
        console.log("WebSocket connected!");
    };
    
    // Setup LoRA progress listener
    try {
        const { listen } = await import('@tauri-apps/api/event');
        listen('lora-training-progress', (event) => {
            const payload = event.payload;
            const progressContainer = document.getElementById("training-progress-container");
            const statusText = document.getElementById("training-status-text");
            const percentText = document.getElementById("training-percent-text");
            const progressBar = document.getElementById("training-progress-bar");
            
            if (progressContainer) progressContainer.classList.remove("hidden");
            if (statusText) statusText.textContent = payload.status || "Training...";
            
            if (payload.percent !== undefined) {
                if (progressBar) progressBar.style.width = payload.percent + "%";
                if (percentText) percentText.textContent = payload.percent + "%";
            }
            
            if (payload.status === "FINISHED" || payload.status === "ERROR") {
                const btn = document.getElementById("btn-start-training");
                const exportBtn = document.getElementById("btn-export-dataset");
                if (btn) btn.disabled = false;
                if (exportBtn) exportBtn.disabled = false;
                
                const statusMsg = document.getElementById("export-status-msg");
                if (payload.status === "FINISHED") {
                    if (statusMsg) statusMsg.textContent = "✅ 学習が完了しました！";
                    alert("学習が正常に終了しました！\nモデルフォルダをご確認ください。");
                } else {
                    if (statusMsg) statusMsg.textContent = "❌ 学習中にエラーが発生しました。";
                    alert("学習プロセスがエラー終了しました。ログを確認してください。");
                }
            }
        });
    } catch(e) { console.error(e); }
    
    // Attach change events for LoRA config inputs
    ["lora-sd-scripts-path", "lora-base-model-path", "lora-epochs", "lora-batch-size", "lora-network-dim", "lora-network-alpha"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", saveSettings);
            el.addEventListener("input", saveSettings);
        }
    });
}

// Load LoRAs from ComfyUI
async function loadLoRAs() {
    try {
        const response = await fetch(`http://${SERVER_URL}/object_info/LoraLoader`);
        const info = await response.json();
        const selectEl = document.getElementById("preset-lora-select");
        if (!selectEl) return;
        if (info.LoraLoader && info.LoraLoader.input.required.lora_name) {
            const loras = info.LoraLoader.input.required.lora_name[0];
            selectEl.innerHTML = '<option value="">なし (タグ展開のみ)</option>';
            loras.forEach(l => {
                const opt = document.createElement("option");
                opt.value = l;
                opt.innerText = l;
                selectEl.appendChild(opt);
            });
        }
    } catch (e) {
        console.warn("Failed to load LoRAs from ComfyUI.", e);
    }
}

// Ensure dropdown retains value even if not populated yet
function setSelectValue(selectEl, val) {
    if (!selectEl || !val) return;
    let exists = false;
    for (let i = 0; i < selectEl.options.length; i++) {
        if (selectEl.options[i].value === val) {
            exists = true;
            break;
        }
    }
    if (!exists) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.innerText = val + " (Offline/Saved)";
        selectEl.appendChild(opt);
    }
    selectEl.value = val;
}

// Auto-save Settings
function saveSettings() {
    if (!modelSelect) return;
    const settings = {
        model: modelSelect.value,
        vae: vaeSelect.value,
        clip: clipSelect.value,
        ollamaModel: ollamaModelSelect.value,
        ollamaKeepAlive: document.getElementById('ollama-keep-alive')?.checked,
        prompt: promptInput.value,
        tagsConfirm: getTagsFromUI().join('\n'),
        textConfirm: textConfirmArea.value,
        metaTags: metaTagsInput.value,
        rating: ratingSelect.value,
        sampler: samplerNameSelect.value,
        scheduler: schedulerSelect.value,
        magicPrompt: magicPromptInput.value,
        negative: negativeInput.value,
        width: imageWidthSelect.value,
        height: imageHeightSelect.value,
        batchSize: batchSizeInput.value,
        steps: stepsInput.value,
        cfg: cfgInput.value,
        clipSkip: clipSkipInput ? clipSkipInput.value : -2,
        loraSdScriptsPath: document.getElementById("lora-sd-scripts-path")?.value,
        loraBaseModelPath: document.getElementById("lora-base-model-path")?.value,
        loraEpochs: document.getElementById("lora-epochs")?.value,
        loraBatchSize: document.getElementById("lora-batch-size")?.value,
        loraNetworkDim: document.getElementById("lora-network-dim")?.value,
        loraNetworkAlpha: document.getElementById("lora-network-alpha")?.value
    };
    diskSave("gacha_settings", settings);
}

async function loadSettings() {
    const settings = await diskLoad("gacha_settings", null);
    if (settings) {
        try {
            if (settings.model) setSelectValue(modelSelect, settings.model);
            if (settings.vae) setSelectValue(vaeSelect, settings.vae);
            if (settings.clip) setSelectValue(clipSelect, settings.clip);
            if (settings.ollamaModel) setSelectValue(ollamaModelSelect, settings.ollamaModel);
            if (settings.ollamaKeepAlive !== undefined) {
                const el = document.getElementById('ollama-keep-alive');
                if (el) el.checked = settings.ollamaKeepAlive;
            }
            if (settings.prompt) {
                promptInput.value = settings.prompt;
                if (settings.prompt.trim().length > 0) {
                    generateBtn.disabled = false;
                }
            }
            if (settings.batchSize !== undefined) batchSizeInput.value = settings.batchSize;
            if (settings.steps !== undefined) stepsInput.value = settings.steps;
            if (settings.cfg !== undefined) cfgInput.value = settings.cfg;
            if (settings.clipSkip !== undefined && clipSkipInput) clipSkipInput.value = settings.clipSkip;
            if (settings.tagsConfirm !== undefined) renderTags(settings.tagsConfirm.split('\n').filter(t => t));
            if (settings.textConfirm !== undefined) textConfirmArea.value = settings.textConfirm;
            if (settings.metaTags !== undefined) metaTagsInput.value = settings.metaTags;
            if (settings.rating !== undefined) ratingSelect.value = settings.rating;
            if (settings.sampler !== undefined) setSelectValue(samplerNameSelect, settings.sampler);
            if (settings.scheduler !== undefined) setSelectValue(schedulerSelect, settings.scheduler);
            if (settings.magicPrompt !== undefined) magicPromptInput.value = settings.magicPrompt;
            if (settings.negative) negativeInput.value = settings.negative;
            if (settings.width) imageWidthSelect.value = settings.width;
            if (settings.height) imageHeightSelect.value = settings.height;
            if (settings.loraSdScriptsPath) { const el = document.getElementById("lora-sd-scripts-path"); if(el) el.value = settings.loraSdScriptsPath; }
            if (settings.loraBaseModelPath) { const el = document.getElementById("lora-base-model-path"); if(el) el.value = settings.loraBaseModelPath; }
            if (settings.loraEpochs) { const el = document.getElementById("lora-epochs"); if(el) el.value = settings.loraEpochs; }
            if (settings.loraBatchSize) { const el = document.getElementById("lora-batch-size"); if(el) el.value = settings.loraBatchSize; }
            if (settings.loraNetworkDim) { const el = document.getElementById("lora-network-dim"); if(el) el.value = settings.loraNetworkDim; }
            if (settings.loraNetworkAlpha) { const el = document.getElementById("lora-network-alpha"); if(el) el.value = settings.loraNetworkAlpha; }
        } catch(e) {}
    }
}

// Save settings on any input change
[modelSelect, vaeSelect, clipSelect, ollamaModelSelect, textConfirmArea, metaTagsInput, ratingSelect, samplerNameSelect, schedulerSelect, promptInput, magicPromptInput, negativeInput, imageWidthSelect, imageHeightSelect, batchSizeInput, stepsInput, cfgInput, clipSkipInput].forEach(el => {
    if (el) {
        el.addEventListener("change", saveSettings);
        if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
            el.addEventListener("input", saveSettings);
        }
    }
});

const ollamaKeepAliveCheckbox = document.getElementById('ollama-keep-alive');
if (ollamaKeepAliveCheckbox) {
    ollamaKeepAliveCheckbox.addEventListener('change', saveSettings);
}

// WebSockets
let ws = null;
let profilerStartTime = 0;
let profilerCurrentNode = null;
window.currentWorkflowNodes = window.currentWorkflowNodes || {};

function connectWebSocket() {
    ws = new WebSocket(`ws://${SERVER_URL}/ws?clientId=${CLIENT_ID}`);
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "progress") {
            const val = Math.round((data.data.value / data.data.max) * 100);
            updateProgressBar(val, `Processing... (${val}%)`);
        } else if (data.type === "executing") {
            const now = Date.now();
            const profilerEl = document.getElementById("profiler-log");
            
            // Record time for previous node
            if (profilerCurrentNode !== null && data.data.node !== profilerCurrentNode) {
                const elapsed = ((now - profilerStartTime) / 1000).toFixed(2);
                const className = window.currentWorkflowNodes[profilerCurrentNode] || `Node ${profilerCurrentNode}`;
                console.log(`[Profiler] ${className} took ${elapsed}s`);
                if (profilerEl) {
                    profilerEl.textContent = `Completed: ${className} (${elapsed}s)`;
                }
            }
            
            if (data.data.node === null) {
                hideProgressBar();
                profilerCurrentNode = null;
                if (profilerEl) {
                    setTimeout(() => { if (profilerCurrentNode === null) profilerEl.textContent = ""; }, 5000);
                }
            } else {
                profilerCurrentNode = data.data.node;
                profilerStartTime = now;
            }
        }
    };
    ws.onclose = () => { setTimeout(connectWebSocket, 2000); };
}

// Progress UI
function showProgressBar(status = "Processing...") {
    progressContainer.classList.remove("hidden");
    progressStatus.textContent = status;
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";
}
function updateProgressBar(percent, status) {
    progressContainer.classList.remove("hidden");
    if (status) progressStatus.textContent = status;
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
}
function hideProgressBar() { progressContainer.classList.add("hidden"); }

// Generate Candidates (Gacha)
generateBtn.addEventListener("click", async () => {
    setUIBusy(true);
    showProgressBar("Requesting Gacha Roll...");
    
    // Clear previous results to avoid confusion
    currentCandidates = [];
    renderCandidates();
    document.getElementById('tags-warnings').innerHTML = ""; // Clear warnings
    
    const prompt = promptInput.value;
    const negative = negativeInput.value;
    const batchSize = parseInt(batchSizeInput.value);
    const steps = parseInt(stepsInput.value);
    const cfg = parseFloat(cfgInput.value);
    const seed = Math.floor(Math.random() * 1000000);
    const width = parseInt(imageWidthSelect.value);
    const height = parseInt(imageHeightSelect.value);
    
    // Generate yyyy-MM-dd format date string for filename
    const today = new Date();
    const dateStr = today.getFullYear() + "-" + 
                    String(today.getMonth() + 1).padStart(2, '0') + "-" + 
                    String(today.getDate()).padStart(2, '0');
    const samplerName = samplerNameSelect.value;
    const scheduler = schedulerSelect.value;
    
    // Anima specific workflow (UNET + CLIP + VAE Loaders)
    const workflow = {
        "3": {
            "inputs": {
                "seed": seed, "steps": steps, "cfg": cfg,
                "sampler_name": samplerName, "scheduler": scheduler, "denoise": 1,
                "model": ["4", 0], "positive": ["8", 0], "negative": ["9", 0], "latent_image": ["7", 0]
            },
            "class_type": "KSampler"
        },
        "4": { "inputs": { "unet_name": modelSelect.value, "weight_dtype": "default" }, "class_type": "UNETLoader" },
        "5": { "inputs": { "clip_name": clipSelect.value !== "default" ? clipSelect.value : "qwen_3_06b_base.safetensors", "type": "stable_diffusion", "device": "default" }, "class_type": "CLIPLoader" },
        "6": { "inputs": { "vae_name": "qwen_image_vae.safetensors" }, "class_type": "VAELoader" },
        "7": { "inputs": { "width": width, "height": height, "batch_size": batchSize }, "class_type": "EmptyLatentImage" },
        "8": { "inputs": { "text": prompt, "clip": ["5", 0] }, "class_type": "CLIPTextEncode" },
        "9": { "inputs": { "text": negative, "clip": ["5", 0] }, "class_type": "CLIPTextEncode" },
        "10": { "inputs": { "samples": ["3", 0], "vae": ["6", 0] }, "class_type": "VAEDecode" },
        "11": { "inputs": { "filename_prefix": `Anima_Gacha_${dateStr}`, "images": ["10", 0] }, "class_type": "SaveImage" }
    };
    
    // Dynamic LoRA injection based on active #presets in prompt/tags
    let currentModelLink = ["4", 0];
    let currentClipLink = ["5", 0];
    let loraIdCounter = 100;
    
    const activeTags = getTagsFromUI();
    const lorasToLoad = [];
    Object.keys(customPresets).forEach(presetName => {
        const p = customPresets[presetName];
        if (!p.lora_name) return;
        const pLower = presetName.toLowerCase();
        const foundInTags = activeTags.some(t => t.trim().toLowerCase() === pLower);
        const foundInPrompt = prompt.toLowerCase().includes(pLower);
        const foundInText = textConfirmArea && textConfirmArea.value.toLowerCase().includes(pLower);
        const foundInMagic = magicPromptInput && magicPromptInput.value.toLowerCase().includes(pLower);
        if (foundInTags || foundInPrompt || foundInText || foundInMagic) {
            lorasToLoad.push(p);
        }
    });
    
    lorasToLoad.forEach(p => {
        const nodeIdStr = String(loraIdCounter++);
        workflow[nodeIdStr] = {
            "inputs": {
                "model": currentModelLink,
                "clip": currentClipLink,
                "lora_name": p.lora_name,
                "strength_model": parseFloat(p.weight) || 0.8,
                "strength_clip": parseFloat(p.weight) || 0.8
            },
            "class_type": "LoraLoader"
        };
        currentModelLink = [nodeIdStr, 0];
        currentClipLink = [nodeIdStr, 1];
    });
    
    if (lorasToLoad.length > 0) {
        workflow["3"].inputs.model = currentModelLink;
        workflow["8"].inputs.clip = currentClipLink;
        workflow["9"].inputs.clip = currentClipLink;
        console.log(`Attached ${lorasToLoad.length} LoRA model(s) dynamically via #presets.`);
    }
    // Cache node classes for profiler
    window.currentWorkflowNodes = {};
    for (const [id, node] of Object.entries(workflow)) {
        window.currentWorkflowNodes[id] = node.class_type;
    }
    
    try {
        const response = await fetch(`http://${SERVER_URL}/prompt`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: workflow, client_id: CLIENT_ID })
        });
        const result = await response.json();
        await pollGachaStatus(result.prompt_id);
    } catch (e) {
        alert("ComfyUI connection failed.");
        hideProgressBar();
        setUIBusy(false);
    }
});

async function pollGachaStatus(promptId) {
    while (true) {
        const response = await fetch(`http://${SERVER_URL}/history/${promptId}`);
        const history = await response.json();
        if (promptId in history) {
            const outputs = history[promptId].outputs;
            let images = null;
            for (const key in outputs) {
                if (outputs[key] && outputs[key].images) {
                    images = outputs[key].images;
                    break;
                }
            }
            
            if (images) {
                currentCandidates = images.map(img => ({
                    url: `http://${SERVER_URL}/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}`,
                    filename: img.filename
                }));
                renderCandidates();
            }
            hideProgressBar();
            setUIBusy(false);
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

function renderCandidates() {
    candidatesGrid.innerHTML = "";
    currentCandidates.forEach((candidate, idx) => {
        const card = document.createElement("div");
        card.className = "candidate-card";
        
        const img = document.createElement("img");
        img.src = candidate.url;
        
        const overlay = document.createElement("div");
        overlay.className = "card-overlay";
        
        const viewBtn = document.createElement("button");
        viewBtn.className = "overlay-btn";
        viewBtn.innerHTML = "&#128269; Enlarge";
        viewBtn.onclick = () => openModal(candidate.url);
        
        const stockBtn = document.createElement("button");
        stockBtn.className = "overlay-btn";
        stockBtn.style.background = "linear-gradient(135deg, rgba(121, 40, 202, 0.8), rgba(0, 195, 255, 0.8))";
        stockBtn.style.borderColor = "#00c3ff";
        stockBtn.style.color = "#fff";
        stockBtn.innerHTML = "⭐ Stock for LoRA";
        stockBtn.onclick = () => {
            addToLoraCart(candidate);
            stockBtn.innerHTML = "✅ Stocked!";
            stockBtn.style.background = "#00ff88";
            stockBtn.style.color = "#000";
        };
        
        overlay.appendChild(viewBtn);
        overlay.appendChild(stockBtn);
        card.appendChild(img);
        card.appendChild(overlay);
        candidatesGrid.appendChild(card);
    });
}

function checkReady() {
    if (baseFilename && partFilename && clipsegPrompt.value.trim() !== "") {
        synthesizeBtn.disabled = false;
    } else {
        synthesizeBtn.disabled = true;
    }
}
clipsegPrompt.addEventListener("input", checkReady);

// Synthesis (CLIPSeg + Inpaint)
synthesizeBtn.addEventListener("click", async () => {
    if (modelSelect.value.toLowerCase().includes('anima')) {
        alert("Animaモデルは現在画像合成(Inpaint)には対応していません。合成を行うにはSD1.5等の対応モデルを選択してください。");
        return;
    }

    setUIBusy(true);
    showProgressBar("Synthesizing...");
    
    const prompt = promptInput.value;
    const negative = negativeInput.value;
    const steps = parseInt(stepsInput.value);
    const cfg = parseFloat(cfgInput.value);
    const denoise = parseFloat(denoiseSlider.value);
    const seed = Math.floor(Math.random() * 1000000);
    const clipsegText = clipsegPrompt.value.trim();
    const samplerName = samplerNameSelect.value;
    const scheduler = schedulerSelect.value;
    
    let vaeNodeLink = ["4", 2]; // Default to Baked VAE
    
    const workflow = {
        "3": {
            "inputs": {
                "seed": seed, "steps": steps, "cfg": cfg,
                "sampler_name": samplerName, "scheduler": scheduler, "denoise": denoise,
                "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0],
                "latent_image": ["12", 0] // VAEEncodeForInpaint output
            },
            "class_type": "KSampler"
        },
        "4": { "inputs": { "ckpt_name": modelSelect.value }, "class_type": "CheckpointLoaderSimple" },
        "6": { "inputs": { "text": prompt, "clip": ["4", 1] }, "class_type": "CLIPTextEncode" },
        "7": { "inputs": { "text": negative, "clip": ["4", 1] }, "class_type": "CLIPTextEncode" },
        "8": { "inputs": { "samples": ["3", 0], "vae": vaeNodeLink }, "class_type": "VAEDecode" },
        "9": { "inputs": { "filename_prefix": "Montage", "images": ["8", 0] }, "class_type": "SaveImage" },
        "10": { "inputs": { "image": baseFilename, "upload": "image" }, "class_type": "LoadImage" }, // Base Image
        "11": { "inputs": { "image": partFilename, "upload": "image" }, "class_type": "LoadImage" }, // Part Image
        
        // CLIPSeg Text Node
        "15": {
            "inputs": {
                "text": clipsegText,
                "blur_radius": 5.0,
                "threshold": 0.4,
                "image": ["11", 0] // Part Image
            },
            "class_type": "CLIPSegText"
        },
        
        // Composite Image (Overlay Part onto Base using Mask)
        "16": {
            "inputs": {
                "x": 0, "y": 0, "resize_source": false,
                "destination": ["10", 0], // Base
                "source": ["11", 0],      // Part
                "mask": ["15", 0]         // CLIPSeg Mask
            },
            "class_type": "ImageCompositeMasked"
        },
        
        // Inpaint Encoding
        "12": {
            "inputs": {
                "grow_mask_by": 6,
                "pixels": ["16", 0], // Composited Image
                "vae": vaeNodeLink,  // Use selected VAE
                "mask": ["15", 0]    // Mask
            },
            "class_type": "VAEEncodeForInpaint"
        }
    };
    
    if (vaeSelect.value !== "baked") {
        workflow["99"] = { "inputs": { "vae_name": vaeSelect.value }, "class_type": "VAELoader" };
        workflow["8"].inputs.vae = ["99", 0];
        workflow["12"].inputs.vae = ["99", 0];
    }
    // Cache node classes for profiler
    window.currentWorkflowNodes = {};
    for (const [id, node] of Object.entries(workflow)) {
        window.currentWorkflowNodes[id] = node.class_type;
    }
    
    try {
        const response = await fetch(`http://${SERVER_URL}/prompt`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: workflow, client_id: CLIENT_ID })
        });
        const result = await response.json();
        await pollSynthesisStatus(result.prompt_id);
    } catch (e) {
        alert("ComfyUI synthesis failed.");
        hideProgressBar();
        setUIBusy(false);
    }
});

async function pollSynthesisStatus(promptId) {
    while (true) {
        const response = await fetch(`http://${SERVER_URL}/history/${promptId}`);
        const history = await response.json();
        if (promptId in history) {
            const outputs = history[promptId].outputs;
            let images = null;
            for (const key in outputs) {
                if (outputs[key] && outputs[key].images) {
                    images = outputs[key].images;
                    break;
                }
            }
            
            if (images && images.length > 0) {
                const img = images[0];
                synthesizedFilename = img.filename;
                synthesizedImageUrl = `http://${SERVER_URL}/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}`;
                
                resultImg.src = synthesizedImageUrl;
                resultImg.classList.remove("hidden");
                resultPlaceholder.classList.add("hidden");
                saveBaseBtn.disabled = false;
                
                const saveLibBtn = document.getElementById("save-library-btn");
                if (saveLibBtn) saveLibBtn.disabled = false;
            }
            hideProgressBar();
            setUIBusy(false);
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

// Save Result as Base Image for Next Iteration
saveBaseBtn.addEventListener("click", () => {
    if (!synthesizedImageUrl || !synthesizedFilename) return;
    baseImageUrl = synthesizedImageUrl;
    baseFilename = synthesizedFilename;
    basePreviewImg.src = baseImageUrl;
    basePreviewImg.classList.remove("hidden");
    basePlaceholder.classList.add("hidden");
    checkReady();
    alert("Set synthesized image as the new Base Image!");
});

// Asset Library Logic
const libraryFilter = document.getElementById("library-filter");
const assetLibraryGrid = document.getElementById("asset-library-grid");
const assetNameInput = document.getElementById("asset-name");
const assetCategorySelect = document.getElementById("asset-category");
const saveLibraryBtn = document.getElementById("save-library-btn");

let assetDB = [];
async function initAssetDB() {
    assetDB = await diskLoad("asset_library_db", []);
}
function getAssetDB() {
    return assetDB;
}

function saveAssetDB(db) {
    assetDB = db;
    diskSave("asset_library_db", db);
}

if (saveLibraryBtn) {
    saveLibraryBtn.addEventListener("click", () => {
        const name = assetNameInput.value.trim();
        if (!name) return alert("Please enter an asset name.");
        if (!synthesizedFilename) return alert("No image to save.");
        
        const newAsset = {
            id: "asset_" + Date.now(),
            name: name,
            category: assetCategorySelect.value,
            filename: synthesizedFilename,
            created_at: Date.now()
        };
        
        const db = getAssetDB();
        db.push(newAsset);
        saveAssetDB(db);
        
        assetNameInput.value = "";
        alert(`Saved ${name} to Library!`);
        renderLibrary();
    });
}

if (libraryFilter) {
    libraryFilter.addEventListener("change", renderLibrary);
}

function renderLibrary() {
    if (!assetLibraryGrid) return;
    assetLibraryGrid.innerHTML = "";
    
    let db = getAssetDB();
    const filter = libraryFilter ? libraryFilter.value : "all";
    if (filter !== "all") {
        db = db.filter(asset => asset.category === filter);
    }
    
    // Sort by newest first
    db.sort((a, b) => b.created_at - a.created_at);
    
    if (db.length === 0) {
        assetLibraryGrid.innerHTML = `<div class="library-placeholder">No assets found.</div>`;
        return;
    }
    
    db.forEach(asset => {
        const card = document.createElement("div");
        card.className = "asset-card";
        
        const img = document.createElement("img");
        const url = `http://${SERVER_URL}/view?filename=${asset.filename}&subfolder=&type=output`;
        img.src = url;
        
        const overlay = document.createElement("div");
        overlay.className = "card-overlay";
        
        const viewBtn = document.createElement("button");
        viewBtn.className = "overlay-btn";
        viewBtn.innerHTML = "&#128269; Enlarge";
        viewBtn.onclick = () => openModal(url);
        
        const delBtn = document.createElement("button");
        delBtn.className = "overlay-btn";
        delBtn.style.backgroundColor = "rgba(255, 0, 0, 0.5)";
        delBtn.style.borderColor = "red";
        delBtn.innerText = "Delete";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if(confirm(`Delete ${asset.name}?`)) {
                const newDb = getAssetDB().filter(a => a.id !== asset.id);
                saveAssetDB(newDb);
                renderLibrary();
            }
        };
        
        overlay.appendChild(viewBtn);
        overlay.appendChild(delBtn);
        
        const label = document.createElement("div");
        label.className = "asset-card-label";
        label.innerText = asset.name;
        
        const categoryBadge = document.createElement("div");
        categoryBadge.className = "asset-card-category";
        categoryBadge.innerText = asset.category.charAt(0).toUpperCase() + asset.category.slice(1);
        
        card.appendChild(img);
        card.appendChild(overlay);
        card.appendChild(categoryBadge);
        card.appendChild(label);
        assetLibraryGrid.appendChild(card);
    });
}

async function loadOllamaModels() {
    try {
        const models = await invoke("ollama_models");
        if (models && Array.isArray(models)) {
            const select = document.getElementById("ollama-model");
            const currentVal = select.value;
            select.innerHTML = "";
            models.forEach(modelName => {
                const opt = document.createElement("option");
                opt.value = modelName;
                opt.innerText = modelName;
                select.appendChild(opt);
            });
            const hasOption = Array.from(select.options).some(opt => opt.value === currentVal);
            if (hasOption) {
                select.value = currentVal;
            } else if (select.options.length > 0) {
                select.value = select.options[0].value;
            }
        }
    } catch (e) {
        console.error("Failed to load Ollama models via Rust IPC:", e);
    }
}

async function init() {
    await initAssetDB();
    await initLoraCart();
    connectWebSocket();
    await loadModels();
    await loadVAEs();
    await loadCLIPs();
    await loadLoRAs();
    await loadOllamaModels();
    await loadSettings();
    await loadCustomPresets();
    renderLibrary();

    try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().show();
    } catch (e) {
        console.warn("Failed to show window", e);
    }

    // 起動時の自動アップデート監視
    setTimeout(async () => {
        try {
            const { check } = await import('@tauri-apps/plugin-updater');
            const update = await check();
            if (update) {
                const { ask } = await import('@tauri-apps/plugin-dialog');
                const yes = await ask(`最新のアプリケーショングレード (${update.version}) がリリースされています。\n自動でダウンロードとインストールを適用し、再起動しますか？`, {
                    title: "CHARACTER_SYNTHESIZER 更新通知",
                    kind: "info",
                });
                if (yes) {
                    await update.downloadAndInstall();
                    const { relaunch } = await import('@tauri-apps/plugin-process');
                    await relaunch();
                }
            }
        } catch (e) {
            console.log("自動アプデ監視スキップ（開発モード等）:", e);
        }
    }, 4000);
}
init();

// --- Tag Validation & Autocomplete ---
const tagsWarningsDiv = document.getElementById("tags-warnings");
const autocompleteDiv = document.getElementById("autocomplete-suggestions");
let activeTagInput = null;

function validateTags() {
    if (!tagsWarningsDiv) return;
    const inputs = tagsList.querySelectorAll(".tag-input");
    let unknownTags = [];
    
    if (danbooruTags.size === 0) {
        tagsWarningsDiv.innerText = "Loading dictionary...";
        return;
    }

    inputs.forEach(input => {
        const tag = input.value.trim();
        if (!tag || tag.startsWith('#')) return; // Ignore custom #presets in dictionary validation!
        const words = tag.split(' ');
        if (words.length > 4 || (!danbooruTags.has(tag) && !danbooruTags.has(tag.replace(/ /g, '_')))) {
            unknownTags.push(tag);
        }
    });
    
    if (unknownTags.length > 0) {
        tagsWarningsDiv.innerHTML = `⚠️ <b>辞書未登録タグ</b><br>${unknownTags.map(t => `• ${t}`).join('<br>')}`;
    } else {
        tagsWarningsDiv.innerText = "";
    }
}

// Event Delegation for tags list autocomplete
tagsList.addEventListener("input", (e) => {
    if (e.target.classList.contains("tag-input")) {
        activeTagInput = e.target;
        showAutocomplete();
    }
});
tagsList.addEventListener("click", (e) => {
    if (e.target.classList.contains("tag-input")) {
        activeTagInput = e.target;
        showAutocomplete();
    }
});
tagsList.addEventListener("keydown", (e) => {
    if (e.target.classList.contains("tag-input")) {
        if (!autocompleteDiv.classList.contains("hidden")) {
            if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter") {
                handleAutocompleteKey(e);
            }
        }
    }
});

let currentSuggestionIndex = -1;

function showAutocomplete() {
    if (!activeTagInput) return;
    const query = activeTagInput.value.trim().toLowerCase();
    
    if (query.length < 1) {
        hideAutocomplete();
        return;
    }
    
    let matches = [];
    if (query.startsWith('#')) {
        matches = Object.keys(customPresets).filter(t => t.toLowerCase().includes(query));
    } else {
        if (query.length < 2 || danbooruTagsArray.length === 0) {
            hideAutocomplete();
            return;
        }
        matches = danbooruTagsArray.filter(t => t.toLowerCase().includes(query)).slice(0, 15);
    }
    
    if (matches.length === 0 || (matches.length === 1 && matches[0].toLowerCase() === query)) {
        hideAutocomplete();
        return;
    }
    
    renderAutocomplete(matches);
}

function renderAutocomplete(matches) {
    autocompleteDiv.innerHTML = "";
    autocompleteDiv.classList.remove("hidden");
    currentSuggestionIndex = -1;
    
    matches.forEach((match, index) => {
        const div = document.createElement("div");
        div.innerText = match;
        div.dataset.index = index;
        div.dataset.value = match;
        
        div.addEventListener("mousedown", (e) => {
            e.preventDefault(); 
            applyAutocomplete(match);
        });
        div.addEventListener("mouseover", () => {
            setAutocompleteSelection(index);
        });
        
        autocompleteDiv.appendChild(div);
    });
}

function hideAutocomplete() {
    if (autocompleteDiv) {
        autocompleteDiv.classList.add("hidden");
        autocompleteDiv.innerHTML = "";
        currentSuggestionIndex = -1;
    }
}

function setAutocompleteSelection(index) {
    const items = autocompleteDiv.querySelectorAll("div");
    items.forEach(item => item.classList.remove("selected"));
    if (index >= 0 && index < items.length) {
        items[index].classList.add("selected");
        items[index].scrollIntoView({ block: "nearest" });
        currentSuggestionIndex = index;
    }
}

function handleAutocompleteKey(e) {
    const items = autocompleteDiv.querySelectorAll("div");
    if (items.length === 0) return;
    
    if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocompleteSelection((currentSuggestionIndex + 1) % items.length);
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocompleteSelection((currentSuggestionIndex - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
        if (currentSuggestionIndex >= 0) {
            e.preventDefault();
            const selectedItem = items[currentSuggestionIndex];
            applyAutocomplete(selectedItem.dataset.value);
        }
    }
}

function applyAutocomplete(match) {
    if (activeTagInput) {
        activeTagInput.value = match;
    }
    hideAutocomplete();
    validateTags();
    saveSettings();
}

document.addEventListener("click", (e) => {
    if (e.target !== autocompleteDiv && !autocompleteDiv.contains(e.target) && (!e.target.classList.contains("tag-input"))) {
        hideAutocomplete();
    }
});

// ========================================================
// Phase 2: Full-auto LoRA Training Studio Engine (v0.2.0)
// ========================================================
let loraDatasetCart = [];

async function initLoraCart() {
    loraDatasetCart = await diskLoad("anima_lora_cart", []);
    updateLoraCartUI();
}

function saveLoraCart() {
    diskSave("anima_lora_cart", loraDatasetCart);
    updateLoraCartUI();
}

function switchStudioTab(tab) {
    const viewGacha = document.getElementById("view-gacha");
    const viewLora = document.getElementById("view-lora");
    const btnGacha = document.getElementById("tab-btn-gacha");
    const btnLora = document.getElementById("tab-btn-lora");
    
    if (tab === 'gacha') {
        if (viewGacha) viewGacha.classList.remove("hidden");
        if (viewLora) viewLora.classList.add("hidden");
        if (btnGacha) btnGacha.classList.add("active");
        if (btnLora) btnLora.classList.remove("active");
    } else {
        if (viewGacha) viewGacha.classList.add("hidden");
        if (viewLora) viewLora.classList.remove("hidden");
        if (btnGacha) btnGacha.classList.remove("active");
        if (btnLora) btnLora.classList.add("active");
        updateLoraCartUI();
    }
}

function addToLoraCart(candidate) {
    let autoCaption = promptInput ? promptInput.value.trim() : "";
    if (!autoCaption && typeof formatFinalPrompt === "function") {
        autoCaption = formatFinalPrompt();
    }
    
    loraDatasetCart.push({
        id: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        imageUrl: candidate.url,
        filename: candidate.filename,
        caption: autoCaption || "1girl, anime style, high quality"
    });
    
    saveLoraCart();
}

function removeFromLoraCart(id) {
    loraDatasetCart = loraDatasetCart.filter(item => item.id !== id);
    saveLoraCart();
}

function clearLoraCart() {
    if (loraDatasetCart.length === 0) return;
    if (confirm("ストック中の学習用画像一覧をクリアしてもよろしいですか？")) {
        loraDatasetCart = [];
        saveLoraCart();
    }
}

function updateLoraCartUI() {
    const badge = document.getElementById("lora-cart-badge");
    if (badge) badge.textContent = loraDatasetCart.length;
    
    const countSpan = document.getElementById("tray-count");
    if (countSpan) countSpan.textContent = loraDatasetCart.length;
    
    const grid = document.getElementById("lora-stock-grid");
    if (!grid) return;
    
    if (loraDatasetCart.length === 0) {
        grid.innerHTML = `
            <div class="empty-tray-notice" style="text-align: center; padding: 60px; color: rgba(255,255,255,0.3); font-size: 1.1em;">
                ガチャ生成後の結果画像から「⭐ Stock for LoRA」をポンッとクリックして<br>ここに学習データセットをストックしていきましょう！
            </div>
        `;
        return;
    }
    
    grid.innerHTML = "";
    loraDatasetCart.forEach(item => {
        const card = document.createElement("div");
        card.className = "lora-stock-card";
        
        const thumb = document.createElement("img");
        thumb.src = item.imageUrl;
        thumb.className = "lora-stock-thumb";
        thumb.title = "クリックで拡大";
        thumb.onclick = () => openModal(item.imageUrl);
        
        const captionArea = document.createElement("div");
        captionArea.className = "lora-stock-caption-area";
        
        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.justifyContent = "space-between";
        header.style.alignItems = "center";
        header.innerHTML = `<span style="font-size: 0.8em; opacity: 0.7;">${item.filename || 'dataset_image'}</span>`;
        
        const delBtn = document.createElement("button");
        delBtn.className = "tag-action-btn";
        delBtn.style.padding = "2px 8px";
        delBtn.style.fontSize = "0.8em";
        delBtn.style.borderColor = "rgba(255,68,68,0.4)";
        delBtn.style.color = "#ff6464";
        delBtn.innerHTML = "🗑️ Remove";
        delBtn.onclick = () => removeFromLoraCart(item.id);
        header.appendChild(delBtn);
        
        const textarea = document.createElement("textarea");
        textarea.rows = 4;
        textarea.style.width = "100%";
        textarea.style.background = "rgba(0,0,0,0.3)";
        textarea.style.border = "1px solid var(--border-color)";
        textarea.style.borderRadius = "4px";
        textarea.style.padding = "8px";
        textarea.style.color = "#fff";
        textarea.style.fontSize = "0.9em";
        textarea.value = item.caption;
        textarea.oninput = (e) => {
            item.caption = e.target.value;
            diskSave("anima_lora_cart", loraDatasetCart);
        };
        
        captionArea.appendChild(header);
        captionArea.appendChild(textarea);
        card.appendChild(thumb);
        card.appendChild(captionArea);
        grid.appendChild(card);
    });
}

function applyTriggerWordToAll() {
    const input = document.getElementById("lora-trigger-word");
    if (!input || !input.value.trim()) {
        alert("トリガーワード（例: bobuko_chr）を入力してください。");
        return;
    }
    const trigger = input.value.trim();
    if (loraDatasetCart.length === 0) {
        alert("ストックされた画像がありません。");
        return;
    }
    
    loraDatasetCart.forEach(item => {
        const parts = item.caption.split(",").map(s => s.trim());
        if (!parts.includes(trigger)) {
            item.caption = trigger + ", " + item.caption;
        }
    });
    
    saveLoraCart();
    alert(`全 ${loraDatasetCart.length} 件のキャプション先頭に「${trigger}」を追加しました！`);
}

async function exportLoraDataset() {
    if (loraDatasetCart.length === 0) {
        alert("学習データがストックされていません！ガチャ画像からストックしてください。");
        return;
    }
    
    const loraName = (document.getElementById("lora-dataset-name")?.value || "my_character").trim();
    const triggerWord = (document.getElementById("lora-trigger-word")?.value || "custom_chr").trim();
    const repeats = parseInt(document.getElementById("lora-repeats")?.value || "20");
    
    const btn = document.getElementById("btn-export-dataset");
    const statusMsg = document.getElementById("export-status-msg");
    
    try {
        if (btn) btn.disabled = true;
        if (statusMsg) statusMsg.textContent = "⌛ データセットを PC 内に生成・保存中...";
        
        const payload = {
            loraName: loraName,
            triggerWord: triggerWord,
            repeats: repeats,
            items: loraDatasetCart
        };
        
        const result = await invoke("export_lora_dataset", { args: payload });
        if (result && result.status === "success") {
            if (statusMsg) statusMsg.textContent = "✨ " + result.message;
            alert(`🎉 【データセット作成＆学習環境の構築完了！】\n\nPC内の「${result.datasetDir}」フォルダに画像とキャプション(.txt)が保存されました。\n\n💡 Kohya SS / sd-scripts / OneTrainer で学習を開始する場合：\n生成された「start_train_${loraName}.bat」および「dataset_config.toml」をご活用ください！`);
        } else {
            throw new Error((result && result.message) || "エラーが発生しました");
        }
    } catch (err) {
        console.error("Dataset Export Error:", err);
        const errorMsg = typeof err === 'string' ? err : (err.message || JSON.stringify(err));
        if (statusMsg) statusMsg.textContent = "❌ エラー: " + errorMsg;
        alert(`データセット保存中にエラーが発生しました。\n詳細: ${errorMsg}`);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function checkUpdateManually() {
    const btn = document.getElementById("btn-check-update");
    try {
        if (btn) btn.innerHTML = "🔄 確認中...";
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (update) {
            const { ask } = await import('@tauri-apps/plugin-dialog');
            const yes = await ask(`新バージョン (${update.version}) が見つかりました。\nダウンロード＆インストールを開始してアプリを再起動しますか？`, {
                title: "アップデート確認通知",
                kind: "info",
            });
            if (yes) {
                if (btn) btn.innerHTML = "⬇️ 更新中...";
                await update.downloadAndInstall();
                const { relaunch } = await import('@tauri-apps/plugin-process');
                await relaunch();
            } else {
                if (btn) btn.innerHTML = "🔄 アップデート確認";
            }
        } else {
            const { message } = await import('@tauri-apps/plugin-dialog');
            const { getVersion } = await import('@tauri-apps/api/app');
            const currentVersion = await getVersion();
            await message(`現在のバージョン (v${currentVersion}) は最新の状態です。`, { title: "更新確認結果", kind: "info" });
            if (btn) btn.innerHTML = "🔄 アップデート確認";
        }
    } catch (e) {
        console.error("手動アプデ確認スキップ・エラー:", e);
        try {
            const { message } = await import('@tauri-apps/plugin-dialog');
            await message("更新確認がスキップされました。（現在、オフライン・ローカル開発モードか未リリースの状態です）\n詳細: " + e, { title: "確認完了", kind: "warning" });
        } catch (dialogErr) {
            alert("更新確認スキップ (開発モード): " + e);
        }
        if (btn) btn.innerHTML = "🔄 アップデート確認";
    }
}

// Expose functions to window for HTML inline event handlers in ES Module mode
window.switchStudioTab = switchStudioTab;
window.generateAnimaPrompt = generateAnimaPrompt;
window.formatFinalPrompt = formatFinalPrompt;
window.applyTriggerWordToAll = applyTriggerWordToAll;
window.exportLoraDataset = exportLoraDataset;
window.clearLoraCart = clearLoraCart;
window.checkUpdateManually = checkUpdateManually;

window.startLoraTraining = async function() {
    if (loraDatasetCart.length === 0) {
        alert("学習データがストックされていません！ガチャ画像からストックしてください。");
        return;
    }
    
    const loraName = (document.getElementById("lora-dataset-name")?.value || "my_character").trim();
    const triggerWord = (document.getElementById("lora-trigger-word")?.value || "custom_chr").trim();
    const repeats = parseInt(document.getElementById("lora-repeats")?.value || "20");
    const sdScriptsPath = document.getElementById("lora-sd-scripts-path")?.value.trim();
    const baseModelPath = document.getElementById("lora-base-model-path")?.value.trim();
    const epochs = parseInt(document.getElementById("lora-epochs")?.value || "10");
    const batchSize = parseInt(document.getElementById("lora-batch-size")?.value || "1");
    const networkDim = parseInt(document.getElementById("lora-network-dim")?.value || "32");
    const networkAlpha = parseInt(document.getElementById("lora-network-alpha")?.value || "16");
    
    if (!sdScriptsPath) {
        alert("sd-scripts フォルダパスを指定してください。");
        return;
    }
    if (!baseModelPath) {
        alert("ベースモデルパスを指定してください。");
        return;
    }
    
    const btn = document.getElementById("btn-start-training");
    const exportBtn = document.getElementById("btn-export-dataset");
    const statusMsg = document.getElementById("export-status-msg");
    const progressContainer = document.getElementById("training-progress-container");
    const statusText = document.getElementById("training-status-text");
    const percentText = document.getElementById("training-percent-text");
    const progressBar = document.getElementById("training-progress-bar");
    
    try {
        if (btn) btn.disabled = true;
        if (exportBtn) exportBtn.disabled = true;
        if (statusMsg) statusMsg.textContent = "⌛ データセット生成 ＆ 学習準備中...";
        if (progressContainer) progressContainer.classList.remove("hidden");
        if (statusText) statusText.textContent = "Initializing Dataset...";
        if (progressBar) progressBar.style.width = "0%";
        if (percentText) percentText.textContent = "0%";
        
        const payload = {
            loraName: loraName,
            triggerWord: triggerWord,
            repeats: repeats,
            items: loraDatasetCart,
            sdScriptsPath: sdScriptsPath,
            baseModelPath: baseModelPath,
            epochs: epochs,
            batchSize: batchSize,
            networkDim: networkDim,
            networkAlpha: networkAlpha
        };
        
        const result = await invoke("start_lora_training", { args: payload });
        
        if (result && result.status === "success") {
            if (statusMsg) statusMsg.textContent = "✨ 学習プロセスをバックグラウンドで開始しました！";
        } else {
            throw new Error((result && result.message) || "エラーが発生しました");
        }
    } catch (err) {
        console.error("Training Error:", err);
        alert("学習の開始に失敗しました:\n" + err.message);
        if (statusMsg) statusMsg.textContent = "❌ エラーが発生しました。";
        if (btn) btn.disabled = false;
        if (exportBtn) exportBtn.disabled = false;
        if (progressContainer) progressContainer.classList.add("hidden");
    }
};

// --- Layout Resizer ---
const resizer = document.getElementById('drag-resizer');
const leftPanel = document.getElementById('control-panel');
let isResizing = false;

if (resizer && leftPanel) {
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        let newWidth = e.clientX;
        if (newWidth < 250) newWidth = 250;
        if (newWidth > window.innerWidth * 0.7) newWidth = window.innerWidth * 0.7;
        leftPanel.style.width = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
        }
    });
}
