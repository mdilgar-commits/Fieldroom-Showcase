# Fieldroom — Construction Room Matrix Prototype

Fieldroom is a phone-friendly web app for organizing room-level construction and closeout deliverables. It follows the project concepts in the presentations in this folder: room/trade scope, document version visibility, human review before release, QR/map navigation, item status, field notes, and photos. It runs locally by default and includes an opt-in Firebase/Cloud Run mode for hosted use.

The custom vector logo is in `public/fieldroom-logo.svg`; `public/fieldroom-logo-reversed.svg` is the light version for the dark sidebar, and `public/fieldroom-mark.svg` is the app/favicon mark.

## Start the server

1. Install Node.js 22 or later if it is not already installed.
2. In this folder, run `npm start` or `node server.mjs`.
3. Open `http://127.0.0.1:4173` in a browser.

The server binds to `127.0.0.1` by default and stores project state, uploaded source files, and field photos under `data/`. Back up that folder yourself. Local mode is for development and does not require a sign-in.

## Main workflow

- Drag PDF, DOCX, text, CSV, or image files onto the Documents page. Files up to 8 MB are saved on this computer.
- Choose an uploaded PDF or image as the floor plan. PDF pages render in the browser as the map background. Use **Generate from drawing** to propose room labels, deliverables, and approximate room marker extents; review each proposed room before adding it. Drag markers to correct their positions against the drawing.
- Gemini-based extraction is optional. Copy `.env.example` to `.env` or set `GEMINI_API_KEY` in the server environment before launch. `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`, which is optimized for document parsing, accepts PDF/image inputs, and has a Free Tier. The API key stays server-side. This starter server does not automatically load `.env`; set the variables in your terminal/session or configure your environment manager.
- Extracted items remain pending in Pre-check review. Confirm the room, trade, reference, and work before adding each candidate to the room matrix.
- Add rooms manually, position them over the selected plan drawing, and manage deliverables from the selected room. Open **Room list** to pull out the searchable room directory. Filter and sort rooms/deliverables by trade. Mark items complete, add field notes, and attach photos.
- Open a room QR from its room detail. Scanning uses the browser's BarcodeDetector API where supported; manual room code/link lookup is available as a fallback.
- Export the matrix to CSV from the Rooms & deliverables page.

## Current limits

- The map displays an uploaded PDF page or image as its background. AI-suggested room boxes/locations are approximate and must be checked and adjusted by a person against the drawing. The app does not currently derive exact room boundaries, walls, scale, or navigable geometry from CAD/BIM.
- Extraction accuracy depends on document quality and the configured Gemini model. It has not been validated against actual project drawings, specifications, or contracts. Every suggestion needs human review and comparison with its cited source.
- Supported input extensions are PDF, DOCX, TXT, MD, CSV, PNG, JPG/JPEG, and WEBP. This prototype sends PDFs/images as Gemini file parts and converts DOCX to text. It does not yet parse DWG, DGN, XLSX, scanned PDFs without model vision/OCR support, or Procore data.
- PDF page rendering uses the locally bundled PDF.js viewer. Camera scanning requires browser camera permission and a secure context (HTTPS or localhost). A QR link only works from another device when that device can reach the server. This prototype's generated QR library is loaded from a public CDN.
- Local mode has no authentication. Keep the local server bound to loopback; do not expose local mode to a public or shared network.
- Google AI Studio supports full-stack web app development, but this local Node server is not a one-click AI Studio deployment. Prompt 6 in `Room_Matrix_App_Prompts.md` describes the adaptation work; the UI and schema are kept portable.

## Configuration

Environment variables:

| Name | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4173` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address; keep loopback until access control is added |
| `GEMINI_API_KEY` | unset | Enables server-side document extraction |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Gemini model for extraction |

## Prepare a hosted deployment

The hosted mode is designed to use AI Studio's no-billing Google Cloud Starter Tier and Firestore's free quota. It stores shared project data and private document/photo chunks in Firestore; it does not require Cloud Storage for Firebase. Firebase Cloud Storage now requires Blaze pay-as-you-go billing, even when storage use fits within its no-cost allowance. Account types are assigned server-side in `ALLOWED_EMAILS` (for example, `manager@example.com:project_manager,field@example.com:field_team`). Project Manager accounts see Project Setup and Project Overview under Project Manager Backend; Field Team accounts use the field views and cannot upload, extract, delete source documents, reset a project, or change project setup data.

1. Follow `AI_STUDIO_MIGRATION_PROMPT.md` to import the code into AI Studio Build mode and adapt its Firebase integration. Do not attach construction drawings, contracts, specifications, or local files from `data/` as build context.
2. Configure Firebase Authentication with Email/Password and create/verify accounts. Set `ALLOWED_EMAILS` server-side as comma-separated `email:account_type` entries, using `project_manager` or `field_team`. An entry without a role remains a Project Manager for backward compatibility. Public self-registration is disabled; the login selector only verifies the administrator-assigned type.
3. Use the app's Firestore database and publish the deny-all rule from `firebase/firestore.rules`. The server uses the Admin SDK; its runtime identity must have Firestore access. Do not create a Firebase Storage bucket.
4. Keep Gemini API access on its Free Tier and store its key as a server-side secret. Free quotas may be rate-limited. Never put keys in browser code or prompts.
5. Publish only through AI Studio's Cloud Starter Tier if it is offered without linking billing. Eligible accounts can publish up to two apps without a Google Cloud billing account. If the UI asks to enable billing, switch to a paid tier, or enter payment information, cancel publication. Direct standard Cloud Run deployment is not part of this no-billing setup.

### Direct Cloud Run deployment

The included `Dockerfile` builds the Node server without copying local project data, uploads, environment files, or presentations into the image. Direct Cloud Run deployment may require a Google Cloud billing account and can incur charges; do not enable billing unless that is approved for this project.

Before deployment, create a Firebase project, enable Email/Password sign-in, create the Firestore database, add verified users, and publish `firebase/firestore.rules`. Create a Cloud Run runtime service account with Firestore access (`roles/datastore.user`) and access to the Gemini secret (`roles/secretmanager.secretAccessor`). Copy `cloud-run.env.yaml.example` to the ignored file `cloud-run.env.yaml`, then replace its Firebase values and the comma-separated `ALLOWED_EMAILS`. Store the Gemini API key in Secret Manager as `fieldroom-gemini-key`; do not put it in the environment file or container image.

From this directory, deploy with the prepared runtime configuration:

```powershell
gcloud run deploy fieldroom `
  --source . `
  --region YOUR_REGION `
  --service-account YOUR_RUNTIME_SERVICE_ACCOUNT `
  --allow-unauthenticated `
  --env-vars-file cloud-run.env.yaml `
  --set-secrets GEMINI_API_KEY=fieldroom-gemini-key:latest
```

Cloud Run's public endpoint serves the sign-in page; Firebase sign-in and the server-side email allowlist protect project data and file APIs. Only verified, allowlisted users can edit. Local `data/` files are not copied to Cloud Run; use a separate, reviewed migration if the current local project must be moved.

Google AI Studio's Gemini Free Tier may use submitted content to improve Google products. Do not send confidential construction documents to Gemini unless the project's data-handling policy permits that use. Always review extracted requirements against the source.

### Hosted-mode behavior and limits

- Hosted mode starts in cloud mode when `CLOUD_MODE=true` or when it detects the Cloud Run environment. It fails to start unless the Firebase project ID, Web API key, and at least one allowlisted email are configured.
- Firestore stores the shared project state as one document. An optimistic revision check detects stale concurrent saves; it does not merge simultaneous edits. Very large projects may need the data split into room-level records.
- A hosted deployment starts with an empty Firestore project state. Local files in `data/` are not copied automatically.
- Hosted documents and photos are stored as Firestore chunk records and streamed only after token/allowlist checks. Hosted uploads are limited to 8 MB each and 500 MB raw bytes per project to leave headroom under Firestore's 1 GiB free data quota; base64 adds storage overhead.
- Firestore's free quota includes 1 GiB stored data, 50,000 document reads per day, 20,000 writes/deletes per day, and 10 GiB monthly outbound transfer. The app's file budget is a guardrail, not a billing guarantee for all read/egress usage.
- Authentication is currently an email allowlist, not role-based access. Every allowed user can edit the shared matrix. Review the project’s privacy, backup, retention, and account recovery policies before using it as an official project record.
- Do not commit `.env`, `cloud-run.env.yaml`, Cloud credentials, `data/`, or construction documents to source control. The hosted service is public at the HTTP layer to serve the sign-in page, but project APIs require a verified allowlisted Firebase token.

The project concept leaves permission roles, retention, current-version definition, and formal release authority open. Resolve those before treating Fieldroom as the authoritative project record.
