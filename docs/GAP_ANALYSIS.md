# Gap Analysis Against Plan Awal

Updated after this handoff pass.

## Fixed In This Pass

- Activity now has `district_id` at database/API/UI level, so event district is not confused with creator district.
- Dashboard create/edit flow supports event district selection.
- Dashboard district filter now uses `activities.district_id`.
- Spline runtime was removed from the web app and replaced with lightweight interactive canvas background.
- Route-level code splitting was added to reduce initial JavaScript load.
- Audit CSV/PDF export buttons exist in UI and backend routes exist.
- Archive/unarchive UI exists. Hard delete remains SUPER_ADMIN-only.
- `.gitignore`, root scripts, sanitized env examples, README, Mermaid diagrams, OpenAPI spec, and handoff notes were added.
- Docker Compose no longer hardcodes local credentials.

## Still Missing Or Needs Production Hardening

| Area | Status | Notes |
| --- | --- | --- |
| Desktop app camera offload | Not implemented | Needs Tauri app, robocopy integration on Windows, SQLite queue, SHA-256 verification, tus resumable upload. |
| Media processing pipeline | Partial | Queue files exist, but large video processing and thumbnail/quality variant generation need end-to-end validation. |
| Public quality selector | Blocked by processing variants | Public UI can only be correct after reliable preview/original variants exist. |
| API docs auto-generation | Manual | `docs/openapi.yaml` exists, but should be generated from Fastify schemas before production. |
| Access-token storage | Prototype level | Refresh token is HttpOnly cookie, but access token is still stored by Zustand persist. Consider memory-only access token plus startup refresh for stricter environments. |
| Production observability | Planned | Follow `Plan Awal/implementasi_realserver.md` for PM2 logs, Nginx logs, disk alerts, backup checks, and monitoring. |
| Automated tests | Minimal | Build and lint pass, but there is no automated integration test suite for auth/upload/export/sharing. |

## Recommended Next Work Order

1. Implement and verify Desktop App offload.
2. Add integration tests for auth, archive/hard delete, activity district filter, audit export, public QR, and export streams.
3. Harden token storage by moving access token to memory and refreshing session on app bootstrap.
4. Complete media worker verification with real camera photo/video samples.
5. Auto-generate OpenAPI from route schemas.
6. Run production rehearsal following `implementasi_realserver.md`.
