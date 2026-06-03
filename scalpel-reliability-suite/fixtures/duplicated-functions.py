"""
Duplicated Functions Test File
This module contains intentionally similar function definitions
with slight variations to test patch ambiguity handling.
"""


def process(data):
    """Process data."""
    return data.upper()


def process_item(data):
    """Process data."""
    return data.upper()


def process_record(data):
    """Process data."""
    return data.upper()


def validate(data):
    """Validate data."""
    return len(data) > 0


def validate_input(data):
    """Validate data."""
    return len(data) > 0


def validate_record(data):
    """Validate data."""
    return len(data) > 0


def transform(data):
    """Transform data."""
    return data.strip()


def transform_value(data):
    """Transform data."""
    return data.strip()


def transform_record(data):
    """Transform data."""
    return data.strip()


def serialize(data):
    """Serialize data."""
    return str(data)


def serialize_item(data):
    """Serialize data."""
    return str(data)


def serialize_record(data):
    """Serialize data."""
    return str(data)
