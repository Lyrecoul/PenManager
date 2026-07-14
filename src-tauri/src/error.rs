use std::io;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("尚未连接设备")]
    NotConnected,
    #[error("连接配置无效：{0}")]
    InvalidProfile(String),
    #[error("设备命令失败：{0}")]
    Device(String),
    #[error("插件包无效：{0}")]
    Archive(String),
    #[error("网络请求失败：{0}")]
    Network(String),
    #[error("{0}")]
    Other(String),
}

impl From<io::Error> for AppError {
    fn from(value: io::Error) -> Self {
        Self::Other(value.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::Other(value.to_string())
    }
}

impl From<ssh2::Error> for AppError {
    fn from(value: ssh2::Error) -> Self {
        Self::Device(value.to_string())
    }
}

impl From<zip::result::ZipError> for AppError {
    fn from(value: zip::result::ZipError) -> Self {
        Self::Archive(value.to_string())
    }
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
