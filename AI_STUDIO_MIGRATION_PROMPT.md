# Prompt for Google AI Studio Build mode

Import the Fieldroom source from its GitHub repository in Build mode, then paste this prompt. Do not include `.env`, `data/`, uploaded drawings, contracts, specifications, photos, logs, or local project backups.

```text
Adapt this existing Fieldroom construction room-matrix app to run as a full-stack web app in Google AI Studio Build mode and its no-billing Cloud Starter Tier. Preserve the existing interface and all working features. Do not replace it with a new simplified app.

Keep the current Node server and static frontend where possible. Make only the changes needed for AI Studio's runtime, sign-in, Gemini secret, and persistent shared storage. Use the runtime-provided PORT and bind to 0.0.0.0. Keep ordinary local development loopback-only when no managed runtime PORT is provided.

Keep Gemini as the only extraction provider and use the server-side GEMINI_API_KEY secret. Never put API keys in browser code, source files, prompts, or logs. Preserve the extraction, human review, deduplication, and project setup behavior.

Use AI Studio's Firebase integration for persistent Firestore storage and Google sign-in. Verify Firebase ID tokens on every project data, upload, photo, and document request. Keep an explicit server-side email allowlist: signed-out and non-allowlisted users must not read or edit project data. Assign allowlisted accounts a server-controlled account type (`project_manager` or `field_team`); the login selector only confirms the assigned type and must never grant privileges by itself. Group Project Setup and Project Overview under a Project Manager Backend menu, show that menu only to Project Manager accounts, and enforce manager-only setup operations on the server. Field Team accounts can work in the room matrix, project deliverables, and progress views but cannot change project profile/subcontractor setup, upload/extract/delete source documents, or reset a project. Do not make Firestore or uploaded files publicly readable. Preserve the shared-project behavior for approved users. Do not add paid services or Firebase Cloud Storage.

Preserve the full Fieldroom experience and data model: project setup, source document upload/removal, extraction, subcontractor confirmation and deduplication, room confirmation, project-wide and room deliverables, per-trade completion, progress, drawing markers, sorting/filtering, expandable descriptions, notes/photos, CSV, QR, and reset-project. Preserve all project-review requirements represented in the source code. Do not silently drop features or import local project/sample data.

Store project state and private uploaded files/photos durably in Firestore using the existing bounded chunk approach or a safer Firestore-compatible equivalent. Keep each upload at or below 8 MB and aggregate stored files at or below 500 MB. Never rely on the container filesystem for persistent user data. Handle concurrent edits with a clear conflict message instead of overwriting newer state.

First inspect the imported code and explain the smallest migration plan. Then implement it, preview the app, and fix build/runtime errors. Before publishing, confirm that Firebase Auth, private Firestore access, the server-side allowlist, and the Gemini Free Tier secret are configured. Do not publish if the Publish flow asks to link billing, provide payment details, or upgrade to a paid tier. Stop and report that requirement instead.

Show a concise notice that Gemini Free Tier content may be used to improve Google products. Advise users not to upload confidential documents unless their project policy permits it.
```

## Publish without billing

AI Studio's documented existing-code import path is **Build mode → Add files (+) → Import from GitHub**. This local folder is not connected to GitHub yet, so it must first be placed in a private GitHub repository. Do not put `.env`, `data/`, or construction documents in that repository.

AI Studio documents a no-billing Starter Tier for eligible accounts, limited to two published apps. Eligibility is not guaranteed. If the Publish flow asks for billing or payment information, cancel rather than continuing. The app has not been imported or published, and local project data/files are not migrated automatically.
