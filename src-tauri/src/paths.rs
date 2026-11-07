use directories::ProjectDirs;
use std::path::PathBuf;

pub fn project_dirs() -> ProjectDirs {
    ProjectDirs::from("ai", "LocalFlow", "LocalFlow")
        .expect("could not resolve LocalFlow project directories")
}

pub fn data_dir() -> PathBuf {
    let dir = project_dirs().data_dir().to_path_buf();
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn models_dir() -> PathBuf {
    let dir = data_dir().join("models");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn db_path() -> PathBuf {
    data_dir().join("localflow.db")
}

pub fn settings_path() -> PathBuf {
    data_dir().join("settings.json")
}

pub fn dictionary_path() -> PathBuf {
    data_dir().join("dictionary.json")
}

pub fn snippets_path() -> PathBuf {
    data_dir().join("snippets.json")
}
