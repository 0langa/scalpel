# API Documentation

This document describes the API endpoints.

## Authentication

All endpoints require a valid API key.

## Endpoints

### GET /health

Returns the health status of the service.

### GET /files

Lists all files in the workspace.

### GET /files/:path

Reads the contents of a specific file.

### PATCH /files/:path

Applies a patch to a specific file.

### POST /batch

Applies multiple edits atomically.

## Generated Regions

<!-- BEGIN API BLOCK -->
### POST /generated/001

Auto-generated endpoint 001.
Parameters: id, name, value.

### POST /generated/002

Auto-generated endpoint 002.
Parameters: id, name, value.

### POST /generated/003

Auto-generated endpoint 003.
Parameters: id, name, value.
<!-- END API BLOCK -->

## Another Generated Region

<!-- BEGIN API BLOCK -->
### POST /legacy/001

Legacy endpoint 001.
Parameters: id, name.

### POST /legacy/002

Legacy endpoint 002.
Parameters: id, name.
<!-- END API BLOCK -->

## Notes

- Rate limiting: 100 requests per minute
- Max payload size: 10MB
- Timeout: 30 seconds
