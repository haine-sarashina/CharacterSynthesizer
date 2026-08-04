use std::fs;
use std::io::Read;
use base64::Engine;
use tauri::Manager;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetItem {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub image_url: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub caption: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDatasetArgs {
    pub lora_name: String,
    pub trigger_word: String,
    pub repeats: u32,
    #[serde(default)]
    pub items: Vec<DatasetItem>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResponse {
    pub status: String,
    pub message: String,
    pub dataset_dir: String,
}

#[tauri::command]
fn load_app_data(app: tauri::AppHandle, key: String) -> Result<String, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let data_dir = config_dir.join("data");
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let file_path = data_dir.join(format!("{}.json", key));
    if file_path.exists() {
        fs::read_to_string(&file_path).map_err(|e| e.to_string())
    } else {
        let local_path = std::path::PathBuf::from("data").join(format!("{}.json", key));
        if local_path.exists() {
            if let Ok(data) = fs::read_to_string(&local_path) {
                let _ = fs::write(&file_path, &data);
                return Ok(data);
            }
        }
        Ok("".to_string())
    }
}

#[tauri::command]
fn save_app_data(app: tauri::AppHandle, key: String, content: String) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let data_dir = config_dir.join("data");
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let file_path = data_dir.join(format!("{}.json", key));
    fs::write(&file_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_lora_dataset(app: tauri::AppHandle, args: ExportDatasetArgs) -> Result<ExportResponse, String> {
    let lora_name = args.lora_name.trim().replace(' ', "_");
    let lora_name = if lora_name.is_empty() { "my_custom_lora".to_string() } else { lora_name };
    let trigger_word = args.trigger_word.trim().replace(' ', "_");
    let repeats = if args.repeats == 0 { 20 } else { args.repeats };
    
    let base_dir = if std::path::Path::new("C:/dev/CharacterSynthesizer").exists() {
        std::path::PathBuf::from("C:/dev/CharacterSynthesizer/datasets").join(&lora_name)
    } else {
        app.path().document_dir()
            .map_err(|e| e.to_string())?
            .join("CharacterSynthesizer_Datasets")
            .join(&lora_name)
    };

    let img_folder_name = if !trigger_word.is_empty() {
        format!("{}_{}", repeats, trigger_word)
    } else {
        format!("{}_custom", repeats)
    };
    
    let img_dir = base_dir.join("img").join(&img_folder_name);
    let model_dir = base_dir.join("model");
    let log_dir = base_dir.join("log");

    fs::create_dir_all(&img_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&model_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;

    let mut saved_count = 0;
    for (idx, item) in args.items.iter().enumerate() {
        let idx_num = idx + 1;
        let img_filename = format!("image_{:03}.png", idx_num);
        let txt_filename = format!("image_{:03}.txt", idx_num);

        let txt_path = img_dir.join(&txt_filename);
        let img_path = img_dir.join(&img_filename);

        let _ = fs::write(&txt_path, &item.caption);

        if item.image_url.starts_with("http://") || item.image_url.starts_with("https://") {
            if let Ok(response) = ureq::get(&item.image_url).call() {
                let mut bytes = Vec::new();
                if let Ok(_) = response.into_reader().read_to_end(&mut bytes) {
                    if let Ok(_) = fs::write(&img_path, &bytes) {
                        saved_count += 1;
                    }
                }
            }
        } else if item.image_url.starts_with("data:image") {
            if let Some(parts) = item.image_url.split_once(',') {
                if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(parts.1) {
                    if let Ok(_) = fs::write(&img_path, &decoded) {
                        saved_count += 1;
                    }
                }
            }
        } else if std::path::Path::new(&item.image_url).exists() {
            if let Ok(_) = fs::copy(&item.image_url, &img_path) {
                saved_count += 1;
            }
        }
    }

    let toml_content = format!(
r#"[general]
enable_bucket = true
bucket_no_upscale = true
bucket_reso_steps = 64
min_bucket_reso = 512
max_bucket_reso = 1536

[[datasets]]
resolution = 1024
batch_size = 1

  [[datasets.subsets]]
  image_dir = "{}"
  num_repeats = {}
"#, img_dir.display().to_string().replace('\\', "/"), repeats);

    let toml_path = base_dir.join("dataset_config.toml");
    let _ = fs::write(&toml_path, toml_content);

    let bat_content = format!(
r#"@echo off
echo ========================================================
echo  LoRA Training Launcher for {}
echo ========================================================
echo Dataset folder prepared at: %~dp0img\{}
echo Total image pairs: {}
echo.
echo If you have Kohya SS / sd-scripts installed, point your script to dataset_config.toml!
echo Output model directory: %~dp0model
echo.
pause
"#, lora_name, img_folder_name, saved_count);

    let bat_path = base_dir.join(format!("start_train_{}.bat", lora_name));
    let _ = fs::write(&bat_path, bat_content);

    Ok(ExportResponse {
        status: "success".to_string(),
        message: format!("Dataset '{}' successfully created with {} image/caption pairs!", lora_name, saved_count),
        dataset_dir: base_dir.to_string_lossy().to_string(),
    })
}

fn silent_command(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

#[tauri::command]
fn ollama_models() -> Result<Vec<String>, String> {
    if let Ok(resp) = ureq::get("http://localhost:11434/api/tags").call() {
        if let Ok(body_str) = resp.into_string() {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body_str) {
                if let Some(models) = json["models"].as_array() {
                    let mut list = Vec::new();
                    for m in models {
                        if let Some(name) = m["name"].as_str() {
                            list.push(name.to_string());
                        }
                    }
                    if !list.is_empty() {
                        return Ok(list);
                    }
                }
            }
        }
    }

    let out = silent_command("ollama")
        .args(["list"])
        .output()
        .map_err(|e| format!("Ollama API接続できず、CLI起動エラー: {}", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut models = Vec::new();
    for (i, line) in text.lines().enumerate() {
        if i == 0 { continue; }
        if let Some(name) = line.split_whitespace().next() {
            if !name.is_empty() {
                models.push(name.to_string());
            }
        }
    }
    Ok(models)
}

#[tauri::command]
fn ollama_generate(model: String, prompt: String, system: String) -> Result<String, String> {
    let payload = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "system": system,
        "stream": false,
        "format": "json",
        "options": { "temperature": 0.3 }
    });

    let resp = ureq::post("http://localhost:11434/api/generate")
        .set("Content-Type", "application/json")
        .send_string(&payload.to_string())
        .map_err(|e| format!("Ollama HTTP Error: {}", e))?;

    let body_str = resp.into_string().map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&body_str)
        .map_err(|e| format!("JSON Parse Error: {}", e))?;

    let content = json["response"].as_str().unwrap_or("").to_string();
    if content.is_empty() {
        return Err("Ollama から空の応答が返されました。モデルがJSON出力に対応しているかご確認下さい。".to_string());
    }
    Ok(content)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_app_data,
            export_lora_dataset,
            ollama_models,
            ollama_generate
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
