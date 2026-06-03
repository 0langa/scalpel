"""
Configuration and Settings Module
Scalpel Reliability Test Suite - Large Python File

This file tests patch, insert, delete_range, and replace_between_markers
on Python syntax with indentation, docstrings, and marker regions.
"""

import json
import os
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# BEGIN CONFIG BLOCK
# ---------------------------------------------------------------------------
APP_NAME = "ScalpelReliabilitySuite"
APP_VERSION = "1.0.0"
DEFAULT_TIMEOUT = 30
MAX_RETRIES = 3
# ---------------------------------------------------------------------------
# END CONFIG BLOCK
# ---------------------------------------------------------------------------


class Config:
    """Base configuration class."""

    def __init__(self, path: str):
        self.path = path
        self.data: Dict[str, Any] = {}

    def load(self) -> None:
        """Load configuration from file."""
        with open(self.path, "r") as f:
            self.data = json.load(f)

    def save(self) -> None:
        """Save configuration to file."""
        with open(self.path, "w") as f:
            json.dump(self.data, f, indent=2)

    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value."""
        return self.data.get(key, default)

    def set(self, key: str, value: Any) -> None:
        """Set a configuration value."""
        self.data[key] = value


class DatabaseConfig(Config):
    """Database-specific configuration."""

    def __init__(self, path: str):
        super().__init__(path)
        self.host = "localhost"
        self.port = 5432
        self.user = "admin"
        self.password = "secret"

    def connect_string(self) -> str:
        """Build a database connection string."""
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/db"


class CacheConfig(Config):
    """Cache-specific configuration."""

    def __init__(self, path: str):
        super().__init__(path)
        self.backend = "redis"
        self.ttl = 3600
        self.max_size = 10000

    def get_ttl(self) -> int:
        """Get cache TTL in seconds."""
        return self.ttl


class LoggingConfig(Config):
    """Logging-specific configuration."""

    def __init__(self, path: str):
        super().__init__(path)
        self.level = "INFO"
        self.format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        self.handlers = ["console", "file"]

    def get_level(self) -> str:
        """Get logging level."""
        return self.level


# ---------------------------------------------------------------------------
# BEGIN API BLOCK
# ---------------------------------------------------------------------------

def validate_config(config: Dict[str, Any]) -> bool:
    """Validate configuration dictionary."""
    required_keys = ["name", "version"]
    return all(key in config for key in required_keys)


def merge_configs(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Deep merge two configuration dictionaries."""
    result = base.copy()
    for key, value in override.items():
        if isinstance(value, dict) and key in result:
            result[key] = merge_configs(result[key], value)
        else:
            result[key] = value
    return result


def load_config_from_env(prefix: str = "APP_") -> Dict[str, Any]:
    """Load configuration from environment variables."""
    config: Dict[str, Any] = {}
    for key, value in os.environ.items():
        if key.startswith(prefix):
            config[key[len(prefix):].lower()] = value
    return config

# ---------------------------------------------------------------------------
# END API BLOCK
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# BEGIN GENERATED SECTION
# ---------------------------------------------------------------------------
# The following functions are auto-generated. Do not edit manually.
# Region ID: generated-py-001

def generated_func_001() -> str:
    return "generated-func-001"


def generated_func_002() -> str:
    return "generated-func-002"


def generated_func_003() -> str:
    return "generated-func-003"


def generated_func_004() -> str:
    return "generated-func-004"


def generated_func_005() -> str:
    return "generated-func-005"

# Region ID: generated-py-001
# ---------------------------------------------------------------------------
# END GENERATED SECTION
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# BEGIN GENERATED SECTION
# ---------------------------------------------------------------------------
# The following functions are auto-generated. Do not edit manually.
# Region ID: generated-py-002

def generated_func_006() -> str:
    return "generated-func-006"


def generated_func_007() -> str:
    return "generated-func-007"


def generated_func_008() -> str:
    return "generated-func-008"


def generated_func_009() -> str:
    return "generated-func-009"


def generated_func_010() -> str:
    return "generated-func-010"

# Region ID: generated-py-002
# ---------------------------------------------------------------------------
# END GENERATED SECTION
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Utility Functions
# ---------------------------------------------------------------------------

def chunk_list(items: List[Any], size: int) -> List[List[Any]]:
    """Split a list into chunks of a given size."""
    return [items[i:i + size] for i in range(0, len(items), size)]


def flatten_list(nested: List[List[Any]]) -> List[Any]:
    """Flatten a nested list."""
    return [item for sublist in nested for item in sublist]


def unique_items(items: List[Any]) -> List[Any]:
    """Return unique items preserving order."""
    seen = set()
    result = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def truncate_string(value: str, max_length: int = 80) -> str:
    """Truncate a string to a maximum length."""
    if len(value) <= max_length:
        return value
    return value[:max_length] + "..."


def truncate_string_left(value: str, max_length: int = 80) -> str:
    """Truncate a string from the left side."""
    if len(value) <= max_length:
        return value
    return "..." + value[-max_length:]


def truncate_string_center(value: str, max_length: int = 80) -> str:
    """Truncate a string from the center."""
    if len(value) <= max_length:
        return value
    half = max_length // 2
    return value[:half] + "..." + value[-half:]


# ---------------------------------------------------------------------------
# File Operations
# ---------------------------------------------------------------------------

def read_file(path: str) -> str:
    """Read the contents of a file."""
    with open(path, "r") as f:
        return f.read()


def write_file(path: str, contents: str) -> None:
    """Write contents to a file."""
    with open(path, "w") as f:
        f.write(contents)


def append_file(path: str, contents: str) -> None:
    """Append contents to a file."""
    with open(path, "a") as f:
        f.write(contents)


def file_exists(path: str) -> bool:
    """Check if a file exists."""
    return os.path.exists(path)


# ---------------------------------------------------------------------------
# Validation Functions
# ---------------------------------------------------------------------------

def is_valid_name(name: str) -> bool:
    """Check if a name is valid."""
    return bool(name) and name.isidentifier()


def is_valid_email(email: str) -> bool:
    """Check if an email is valid."""
    return "@" in email and "." in email.split("@")[-1]


def is_valid_port(port: int) -> bool:
    """Check if a port number is valid."""
    return 0 <= port <= 65535


def is_valid_timeout(timeout: int) -> bool:
    """Check if a timeout value is valid."""
    return timeout > 0


# ---------------------------------------------------------------------------
# Retry Decorator
# ---------------------------------------------------------------------------

from functools import wraps


def retry(max_attempts: int = 3, delay: float = 1.0):
    """Decorator to retry a function on failure."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_attempts - 1:
                        raise
                    import time
                    time.sleep(delay * (attempt + 1))
        return wrapper
    return decorator


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

__all__ = [
    "Config",
    "DatabaseConfig",
    "CacheConfig",
    "LoggingConfig",
    "validate_config",
    "merge_configs",
    "load_config_from_env",
    "chunk_list",
    "flatten_list",
    "unique_items",
    "truncate_string",
    "truncate_string_left",
    "truncate_string_center",
    "read_file",
    "write_file",
    "append_file",
    "file_exists",
    "is_valid_name",
    "is_valid_email",
    "is_valid_port",
    "is_valid_timeout",
    "retry",
]
