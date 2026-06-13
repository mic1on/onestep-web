from __future__ import annotations

import json
import re
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from onestep_web.settings import Settings


ENV_VAR_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")
MASKED_SECRET = "********"


class CredentialCipher:
    def __init__(self, key: str | None = None) -> None:
        self.key = key or Fernet.generate_key().decode("ascii")
        self._fernet = Fernet(self.key.encode("ascii"))

    def encrypt_json(self, value: dict[str, Any]) -> str:
        payload = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
        return self._fernet.encrypt(payload).decode("ascii")

    def decrypt_json(self, value: str) -> dict[str, Any]:
        try:
            payload = self._fernet.decrypt(value.encode("ascii"))
        except InvalidToken as exc:
            raise ValueError("credential payload cannot be decrypted with the configured key") from exc
        data = json.loads(payload.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("credential payload must decrypt to an object")
        return data


def interpolate_env_vars(value: str, env_vars: dict[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in env_vars:
            raise KeyError(f"missing env var {name}")
        return env_vars[name]

    return ENV_VAR_PATTERN.sub(replace, value)


def mask_env_vars(env_vars: dict[str, str]) -> dict[str, str]:
    return {key: MASKED_SECRET if value else "" for key, value in env_vars.items()}


def merge_masked_env_vars(
    incoming: dict[str, str],
    existing: dict[str, str],
) -> dict[str, str]:
    merged: dict[str, str] = {}
    for key, value in incoming.items():
        if value == MASKED_SECRET and key in existing:
            merged[key] = existing[key]
        else:
            merged[key] = value
    return merged


def load_or_create_cipher(settings: Settings) -> CredentialCipher:
    if settings.fernet_key:
        return CredentialCipher(settings.fernet_key)
    key_path = settings.data_dir / "fernet.key"
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    if key_path.exists():
        return CredentialCipher(key_path.read_text(encoding="utf-8").strip())
    key = Fernet.generate_key().decode("ascii")
    key_path.write_text(key, encoding="utf-8")
    return CredentialCipher(key)
