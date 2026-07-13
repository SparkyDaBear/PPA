from __future__ import annotations

from dataclasses import dataclass
import os


def _parse_origins(value: str) -> list[str]:
    return [item.strip() for item in value.split(',') if item.strip()]


def _parse_optional_bool(value: str | None) -> bool | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    if normalized in {'1', 'true', 'yes', 'on'}:
        return True
    if normalized in {'0', 'false', 'no', 'off'}:
        return False
    return None


@dataclass
class Settings:
    host: str = os.getenv('FEDERATED_SEARCH_HOST', '0.0.0.0')
    port: int = int(os.getenv('FEDERATED_SEARCH_PORT', '8787'))
    cors_origins: list[str] = None  # type: ignore[assignment]

    ppa_export_dir: str = os.getenv(
        'PPA_EXPORT_DIR',
        '/storage/group/epo2/default/ims86/git_repos/PerturbationAtlas/public/PPA/export',
    )
    ppa_export_base_url: str = os.getenv(
        'PPA_EXPORT_BASE_URL',
        'https://raw.githubusercontent.com/sparkydabear/PPA/main/export',
    )
    ppa_export_fetch_timeout_seconds: float = float(os.getenv('PPA_EXPORT_FETCH_TIMEOUT_SECONDS', '15'))

    enable_pride: bool = os.getenv('ENABLE_PRIDE', 'true').lower() == 'true'
    enable_proteomexchange: bool = os.getenv('ENABLE_PROTEOMEXCHANGE', 'true').lower() == 'true'
    enable_mcp_source: bool = False

    pride_api_key: str = os.getenv('PRIDE_API_KEY', '')
    proteomexchange_api_key: str = os.getenv('PROTEOMEXCHANGE_API_KEY', '')

    mcp_bridge_url: str = os.getenv('MCP_BRIDGE_URL', '')
    mcp_bridge_token: str = os.getenv('MCP_BRIDGE_TOKEN', '')
    mcp_chat_bridge_url: str = os.getenv('MCP_CHAT_BRIDGE_URL', '')

    # Optional direct model settings (currently unused by MCP-only chat path).
    openai_base_url: str = os.getenv('OPENAI_BASE_URL', 'https://api.openai.com/v1')
    openai_api_key: str = os.getenv('OPENAI_API_KEY', '')
    openai_model: str = os.getenv('OPENAI_MODEL', 'gpt-4o-mini')

    ppa_public_base_url: str = os.getenv('PPA_PUBLIC_BASE_URL', 'https://sparkydabear.github.io/PPA')

    def __post_init__(self) -> None:
        if self.cors_origins is None:
            raw = os.getenv('FEDERATED_SEARCH_CORS_ORIGINS', 'https://sparkydabear.github.io')
            self.cors_origins = _parse_origins(raw)

        # Keep existing explicit override behavior, but default to enabled when a bridge URL is configured.
        # This prevents silent fallback-only behavior when operators provide MCP endpoint URLs.
        env_enable_mcp = _parse_optional_bool(os.getenv('ENABLE_MCP_SOURCE'))
        if env_enable_mcp is not None:
            self.enable_mcp_source = env_enable_mcp
        else:
            self.enable_mcp_source = bool(self.mcp_chat_bridge_url or self.mcp_bridge_url)


settings = Settings()
