from __future__ import annotations

import pytest

from onestep_web.credentials import CredentialCipher, interpolate_env_vars


def test_cipher_encrypts_and_decrypts_json() -> None:
    cipher = CredentialCipher()
    encrypted = cipher.encrypt_json({"url": "amqp://user:pass@host/"})

    assert "pass" not in encrypted
    assert cipher.decrypt_json(encrypted) == {"url": "amqp://user:pass@host/"}


def test_env_interpolation_replaces_config_placeholders() -> None:
    value = interpolate_env_vars(
        "amqp://user:${PASSWORD}@host:5672/",
        {"PASSWORD": "secret"},
    )

    assert value == "amqp://user:secret@host:5672/"


def test_env_interpolation_requires_defined_vars() -> None:
    with pytest.raises(KeyError, match="PASSWORD"):
        interpolate_env_vars("amqp://user:${PASSWORD}@host:5672/", {})

