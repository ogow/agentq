# Files API & Vision Capabilities

Manage large files and multimodal inputs (Images/PDFs) efficiently via the Files API and specialized content blocks.

## Files API

Upload once, reference many times. Ideal for datasets, long documents, and avoiding payload bloat in multi-turn runs.

- **Upload**: `POST /v1/files` (Returns `file_id`).
- **Use**: Reference by `file_id` in `document` or `image` blocks.
- **Scope**: Scoped to workspace; can be scoped to session for outputs.
- **Limits**: 500 MB per file, 500 GB organization-wide.

## Vision (Images & PDFs)

Claude can analyze visual content in JPEG, PNG, GIF, WebP, and PDF formats.

### PDF Requirements
- **Max Request**: 32 MB.
- **Max Pages**: 600 (100 for some models).
- **Processing**: Each page is converted to an image and extracted as text.

### Implementation Patterns
1. **Base64**: Quick for small, one-off images.
2. **URL**: Reference hosted assets directly.
3. **Files API**: **Recommended** for multi-turn sessions to keep payloads lean (avoids resending bytes).

### Cost & Optimization
- **Costs**: Tokenized based on resolution. `tokens = (width * height) / 750`.
- **Placement**: Best practice is to place Images/PDFs **before** text instructions in the prompt.
- **Caching**: Use Prompt Caching for large PDFs used across multiple turns.
