# AI

## Configure a Provider

Open Settings and choose either Anthropic or OpenAI. Enter the API key and, if needed, override the model or HTTP(S) base URL. Each provider keeps a separate saved configuration; switching providers does not copy credentials between them.

The OpenAI provider uses the streaming Chat Completions-compatible protocol. Its
Base URL is an API root such as `https://api.openai.com/v1` (or a custom path
prefix), not the full `/chat/completions` endpoint. Docus appends that endpoint
itself. Chat workspace actions require OpenAI function/tool calling support;
some gateways support text generation but not the tools required for file
actions, and Docus reports that incompatibility instead of silently continuing
without tools.

API keys are sent only to the Docus server, encrypted before SQLite storage, and never returned to the browser. Provider environment variables such as `ANTHROPIC_API_KEY` are not supported configuration paths.

See [Deployment Security](../deployment/security.md) for the master-key model.

If provider credentials were encrypted with the auto-managed key and
`data/.docus-master-key` is unavailable, Docus reports that the master key is
required. It does not generate a replacement key or modify the encrypted
credentials. Restore the original file from backup, or configure the matching
key through `DOCUS_MASTER_KEY` or `DOCUS_MASTER_KEY_FILE`.

## Chat and Context

AI chat supports multiple persisted sessions. User messages, assistant replies, and tool-call records are stored in SQLite.

At Send time, Docus captures the active workspace view rather than assuming the route is current. The context can be:

- the live editor buffer, including unsaved text and external-conflict state;
- a History or diff view;
- a browser-local Recovery draft and, when relevant, the disk version.

You can attach additional vault documents from the composer. Attachments are path references; the model reads them with a server tool if needed. The live workspace snapshot is used for that request only and is not copied into the stored chat message.

## File Tools

The model can call `read_file`, `list_files`, `create_file`, `write_file`, `patch_file`, `delete_file`, `rename_file`, and `update_metadata`. Tool calls take effect when the server executes them; there is no transactional rollback for earlier successful calls if a later call fails or the response is stopped.

All paths are vault-relative and server validated. Mutation tools share the editor's atomic-write and lifecycle rules. When the active document is dirty, read-only, stale, externally conflicted, or no longer has the expected identity, the server rejects an unsafe mutation instead of applying it blindly.

Review tool-call cards and History changes after an AI-assisted edit. Create a Git version only after the result is acceptable.

## Troubleshooting

- **Not configured:** save a key for the active provider in Settings.
- **Master-key error:** restore the exact key that encrypted the stored credentials. If the key is permanently unavailable, use Settings → AI → Forget the affected provider API key and confirm the destructive action. This removes only that provider's encrypted credential; Docus never clears or replaces credentials automatically. After all unrecoverable provider credentials are explicitly cleared, a new API key can be saved and a new fallback key will be created.
- **Tool rejected:** save or resolve the active workspace state, then ask the model to re-read before retrying.
- **Provider error:** verify the selected model, network access, and API account. For OpenAI-compatible providers, verify that the Base URL is the API root (not `/chat/completions`) and that the endpoint supports streaming Chat Completions and tool/function calling.
