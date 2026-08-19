use std::fs;
use std::io::Read;
use base64::Engine;
use tauri::{Manager, Emitter};


#[tauri::command]
fn save_history(app: tauri::AppHandle, image_url: String, metadata: serde_json::Value) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("history");
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let timestamp = metadata["id"].as_str().unwrap_or("unknown_id").to_string();
    let img_path = data_dir.join(format!("{}.png", timestamp));
    let json_path = data_dir.join(format!("{}.json", timestamp));

    if let Ok(response) = ureq::get(&image_url).call() {
        let mut bytes = Vec::new();
        if response.into_reader().read_to_end(&mut bytes).is_ok() {
            fs::write(&img_path, &bytes).map_err(|e| e.to_string())?;
            let json_str = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
            fs::write(&json_path, json_str).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("Failed to download or save image".to_string())
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub metadata: serde_json::Value,
    pub image_path: String,
}

#[tauri::command]
fn get_history(app: tauri::AppHandle) -> Result<Vec<HistoryItem>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("history");
    if !data_dir.exists() {
        return Ok(vec![]);
    }

    let mut items = Vec::new();
    if let Ok(entries) = fs::read_dir(&data_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(metadata) = serde_json::from_str::<serde_json::Value>(&content) {
                        let id = metadata["id"].as_str().unwrap_or("").to_string();
                        let img_path = data_dir.join(format!("{}.png", id));
                        items.push(HistoryItem {
                            metadata,
                            image_path: img_path.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        }
    }
    
    items.sort_by(|a, b| {
        let id_a = a.metadata["id"].as_str().unwrap_or("");
        let id_b = b.metadata["id"].as_str().unwrap_or("");
        id_b.cmp(id_a)
    });

    Ok(items)
}

#[derive(Debug, Clone, serde::Deserialize)]
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

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDatasetArgs {
    pub lora_name: String,
    pub trigger_word: String,
    pub repeats: u32,
    #[serde(default)]
    pub items: Vec<DatasetItem>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTrainingArgs {
    pub lora_name: String,
    pub trigger_word: String,
    pub repeats: u32,
    #[serde(default)]
    pub items: Vec<DatasetItem>,
    pub sd_scripts_path: String,
    pub base_model_path: String,
    pub epochs: u32,
    pub batch_size: u32,
    pub network_dim: u32,
    pub network_alpha: u32,
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

#[tauri::command]
fn start_lora_training(app: tauri::AppHandle, args: StartTrainingArgs) -> Result<ExportResponse, String> {
    let export_args = ExportDatasetArgs {
        lora_name: args.lora_name.clone(),
        trigger_word: args.trigger_word.clone(),
        repeats: args.repeats,
        items: args.items.clone(),
    };
    
    let export_res = export_lora_dataset(app.clone(), export_args)?;
    let base_dir = std::path::PathBuf::from(&export_res.dataset_dir);
    
    let config_toml_content = format!(
r#"[model_arguments]
pretrained_model_name_or_path = "{}"

[additional_network_arguments]
network_module = "networks.lora"
network_dim = {}
network_alpha = {}

[optimizer_arguments]
optimizer_type = "AdamW8bit"
learning_rate = 1e-4

[dataset_arguments]
dataset_config = "{}"

[training_arguments]
output_dir = "{}"
output_name = "{}"
save_precision = "fp16"
save_model_as = "safetensors"
max_train_epochs = {}
train_batch_size = {}
xformers = true
mixed_precision = "fp16"
"#, 
        args.base_model_path.replace('\\', "/"), 
        args.network_dim, 
        args.network_alpha, 
        base_dir.join("dataset_config.toml").display().to_string().replace('\\', "/"),
        base_dir.join("model").display().to_string().replace('\\', "/"),
        args.lora_name,
        args.epochs,
        args.batch_size
    );

    let config_path = base_dir.join("config.toml");
    std::fs::write(&config_path, config_toml_content).map_err(|e| e.to_string())?;

    let sd_scripts_path = std::path::PathBuf::from(args.sd_scripts_path.clone());
    let python_exe = sd_scripts_path.join("venv").join("Scripts").join("python.exe");
    let script_path = sd_scripts_path.join("train_network.py");

    let app_handle = app.clone();
    
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};
        
        let mut cmd = Command::new(&python_exe);
        cmd.arg(&script_path)
           .arg("--config_file")
           .arg(&config_path);
           
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
           
        if let Ok(mut child) = cmd.spawn() {
            if let Some(stdout) = child.stdout.take() {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(l) = line {
                        let mut percent = None;
                        if let Some(idx) = l.find("%|") {
                            let start_idx = l[..idx].rfind(|c: char| !c.is_numeric()).map(|i| i + 1).unwrap_or(0);
                            let num_str = l[start_idx..idx].trim();
                            if let Ok(p) = num_str.parse::<u32>() {
                                percent = Some(p);
                            }
                        }
                        
                        let payload = serde_json::json!({
                            "status": l,
                            "percent": percent
                        });
                        let _ = app_handle.emit("lora-training-progress", payload);
                    }
                }
            }
            
            let status_code = child.wait().unwrap_or_else(|_| std::process::ExitStatus::default());
            let result_status = if status_code.success() { "FINISHED" } else { "ERROR" };
            
            let payload = serde_json::json!({
                "status": result_status,
                "percent": 100
            });
            let _ = app_handle.emit("lora-training-progress", payload);
        } else {
            let payload = serde_json::json!({
                "status": "ERROR",
                "message": "Failed to spawn Python process. Is sd-scripts setup properly?"
            });
            let _ = app_handle.emit("lora-training-progress", payload);
        }
    });

    Ok(ExportResponse {
        status: "success".to_string(),
        message: "Training started".to_string(),
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
fn ollama_generate(model: String, prompt: String, system: String, keep_alive: bool) -> Result<String, String> {
    let mut payload_map = serde_json::Map::new();
    payload_map.insert("model".to_string(), serde_json::json!(model));
    payload_map.insert("prompt".to_string(), serde_json::json!(prompt));
    payload_map.insert("system".to_string(), serde_json::json!(system));
    payload_map.insert("stream".to_string(), serde_json::json!(false));
    payload_map.insert("format".to_string(), serde_json::json!("json"));
    payload_map.insert("options".to_string(), serde_json::json!({ "temperature": 0.3 }));

    if keep_alive {
        payload_map.insert("keep_alive".to_string(), serde_json::json!(-1));
    }

    let payload = serde_json::Value::Object(payload_map);

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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_app_data,
            export_lora_dataset,
            start_lora_training,
            ollama_models,
            ollama_generate,
            save_history,
            get_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
