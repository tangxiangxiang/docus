# AI

## Configure a Provider

Open Settings and choose either Anthropic or OpenAI. Enter the API key and, if needed, override the model or HTTP(S) base URL. Each provider keeps a separate saved configuration; switching providers does not copy credentials between them.

API keys are sent only to the Docus server, encrypted before SQLite storage, and never returned to the browser. Provider environment variables such as `ANTHROPIC_API_KEY` are not supported configuration paths.

See [Deployment Security](../deployment/security.md) for the master-key model.

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
- **Master-key error:** restore the key that encrypted the stored credentials or clear and re-enter the provider key.
- **Tool rejected:** save or resolve the active workspace state, then ask the model to re-read before retrying.
- **Provider error:** verify the selected model, base URL, network access, and API account.
