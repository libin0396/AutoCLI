use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonCommand {
    pub id: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub op: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_limit: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clear: Option<bool>,
}

impl DaemonCommand {
    pub fn new(action: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            action: action.into(),
            code: None,
            url: None,
            workspace: None,
            tab_id: None,
            format: None,
            op: None,
            pattern: None,
            body_limit: None,
            clear: None,
        }
    }

    pub fn with_code(mut self, code: impl Into<String>) -> Self {
        self.code = Some(code.into());
        self
    }

    pub fn with_url(mut self, url: impl Into<String>) -> Self {
        self.url = Some(url.into());
        self
    }

    pub fn with_workspace(mut self, workspace: impl Into<String>) -> Self {
        self.workspace = Some(workspace.into());
        self
    }

    pub fn with_tab_id(mut self, tab_id: u64) -> Self {
        self.tab_id = Some(tab_id);
        self
    }

    pub fn with_format(mut self, format: impl Into<String>) -> Self {
        self.format = Some(format.into());
        self
    }

    pub fn with_op(mut self, op: impl Into<String>) -> Self {
        self.op = Some(op.into());
        self
    }

    pub fn with_pattern(mut self, pattern: impl Into<String>) -> Self {
        self.pattern = Some(pattern.into());
        self
    }

    pub fn with_body_limit(mut self, body_limit: usize) -> Self {
        self.body_limit = Some(body_limit);
        self
    }

    pub fn with_clear(mut self, clear: bool) -> Self {
        self.clear = Some(clear);
        self
    }
}

/// Article payload returned by the extension's read-article action.
///
/// Mirrors the shape produced by Mozilla Readability (@mozilla/readability).
/// All string fields default to empty when absent so the CLI can format
/// safely without repeated `Option::as_deref().unwrap_or("")`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadArticle {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub byline: Option<String>,
    #[serde(default)]
    pub dir: Option<String>,
    #[serde(default)]
    pub lang: Option<String>,
    /// Cleaned article HTML (Readability output).
    #[serde(default)]
    pub content: String,
    /// Plain-text version of content.
    #[serde(default)]
    pub text_content: String,
    #[serde(default)]
    pub length: u64,
    #[serde(default)]
    pub excerpt: String,
    #[serde(default)]
    pub site_name: Option<String>,
    #[serde(default)]
    pub published_time: Option<String>,
    /// Final URL after redirects (as seen by the extension).
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonResult {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl DaemonResult {
    pub fn success(id: String, data: Value) -> Self {
        Self {
            id,
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn failure(id: String, error: String) -> Self {
        Self {
            id,
            ok: false,
            data: None,
            error: Some(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::DaemonCommand;
    use serde_json::json;

    #[test]
    fn daemon_command_serializes_tab_id_as_camel_case() {
        let value = serde_json::to_value(
            DaemonCommand::new("exec")
                .with_workspace("site:test")
                .with_tab_id(42),
        )
        .expect("command should serialize");

        assert_eq!(
            value,
            json!({
                "id": value.get("id").and_then(|v| v.as_str()).expect("id should exist"),
                "action": "exec",
                "workspace": "site:test",
                "tabId": 42
            })
        );
        assert!(value.get("tab_id").is_none(), "tab_id should not be serialized");
    }

    #[test]
    fn daemon_command_serializes_network_capture_fields_as_camel_case() {
        let value = serde_json::to_value(
            DaemonCommand::new("network-capture")
                .with_workspace("site:goofish")
                .with_op("start")
                .with_pattern("mtop.taobao.idlemtopsearch.pc.search")
                .with_body_limit(4096),
        )
        .expect("command should serialize");

        assert_eq!(value.get("bodyLimit").and_then(|v| v.as_u64()), Some(4096));
        assert_eq!(
            value.get("pattern").and_then(|v| v.as_str()),
            Some("mtop.taobao.idlemtopsearch.pc.search")
        );
        assert!(value.get("body_limit").is_none(), "body_limit should not be serialized");
    }
}
