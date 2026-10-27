import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const MEDIA = path.join(DATA, 'media');
const STATE_FILE = path.join(DATA, 'state.json');
const PORT = Number(process.env.PORT || 4173);
const CLOUD_MODE = process.env.CLOUD_MODE === 'true' || Boolean(process.env.K_SERVICE);
const AUTH_REQUIRED = CLOUD_MODE;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || '';
const DATA_PREFIX = (process.env.CLOUD_DATA_PREFIX || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
const STATE_PATH = process.env.FIRESTORE_STATE_PATH || 'fieldroomProjects/default/state/current';
const ALLOWED_EMAILS = new Set();
const ACCOUNT_TYPES = new Map();
for (const entry of (process.env.ALLOWED_EMAILS || '').split(',').map(value=>value.trim()).filter(Boolean)) {
  const separator=entry.lastIndexOf(':');
  const email=(separator<0?entry:entry.slice(0,separator)).trim().toLowerCase();
  const accountType=(separator<0?'project_manager':entry.slice(separator+1)).trim().toLowerCase().replace(/[ -]+/g,'_');
  if (!email) continue;
  if (!['project_manager','field_team'].includes(accountType)) throw new Error(`Unsupported account type for ${email}. Use project_manager or field_team.`);
  ALLOWED_EMAILS.add(email);
  ACCOUNT_TYPES.set(email,accountType);
}
// Managed web runtimes (AI Studio preview/Cloud Run) provide PORT and need
// the server bound to the container interface. Keep local startup loopback-only.
const HOST = process.env.HOST || (process.env.K_SERVICE || process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const MAX_FILE = 8 * 1024 * 1024;
const MAX_BODY = 36 * 1024 * 1024;
const FIRESTORE_FILE_CHUNK_BYTES = 600_000;
const FIRESTORE_FILE_BUDGET_BYTES = 500 * 1024 * 1024;
const MIME_BY_EXT = { '.pdf':'application/pdf', '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.txt':'text/plain', '.md':'text/markdown', '.csv':'text/csv', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp' };

let cloudApp, cloudAuth, cloudDb;
if (CLOUD_MODE) {
  if (!PROJECT_ID || !WEB_API_KEY || ALLOWED_EMAILS.size===0) throw new Error('Cloud mode requires FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY, and at least one ALLOWED_EMAILS entry.');
  const [{initializeApp,applicationDefault,getApps},{getAuth},{getFirestore}] = await Promise.all([
    import('firebase-admin/app'),import('firebase-admin/auth'),import('firebase-admin/firestore')
  ]);
  cloudApp=getApps().find(a=>a.name==='fieldroom')||initializeApp({credential:applicationDefault(),projectId:PROJECT_ID},'fieldroom');
  cloudAuth=getAuth(cloudApp);cloudDb=getFirestore(cloudApp);
} else {
  await fs.mkdir(UPLOADS, { recursive: true });
  await fs.mkdir(MEDIA, { recursive: true });
}

const initialState = { project: { id:'project-main', name:'New construction project', site:'', drawingVersion:'', updatedAt:'', rooms:[], mapConfig:{documentId:'',page:1} }, documents:[], suggestions:[], roomSuggestions:[] };
async function readState() {
  if (CLOUD_MODE) {
    const snapshot=await cloudDb.doc(STATE_PATH).get();
    return snapshot.exists?snapshot.data():structuredClone(initialState);
  }
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); }
  catch { await writeState(initialState); return structuredClone(initialState); }
}
async function writeState(nextState, expectedRevision=nextState.revision||0) {
  if (CLOUD_MODE) {
    const size=Buffer.byteLength(JSON.stringify(nextState));if(size>950000)throw new Error('Project state is approaching Firestore’s document size limit. Store more project data as separate records before continuing.');
    const ref=cloudDb.doc(STATE_PATH);
    return cloudDb.runTransaction(async tx=>{const snapshot=await tx.get(ref);const actual=snapshot.exists?Number(snapshot.get('revision')||0):0;if(actual!==Number(expectedRevision||0)){const err=new Error('This project changed in another browser. Reload the project before saving more changes.');err.code='STATE_CONFLICT';throw err}const saved={...nextState,revision:actual+1};tx.set(ref,saved);return saved});
  }
  await fs.writeFile(STATE_FILE, JSON.stringify(nextState, null, 2), 'utf8');return nextState;
}
async function saveStoredFile(kind,name,bytes,mimeType,metadata={}) {
  if(CLOUD_MODE){
    const namespace=cloudDb.collection('fieldroomFiles').doc(DATA_PREFIX);
    const files=namespace.collection('objects'),ref=files.doc(path.basename(name));
    const usageRef=namespace.collection('control').doc('usage');
    await cloudDb.runTransaction(async tx=>{const snapshot=await tx.get(usageRef);const used=Number(snapshot.get('bytes')||0);if(used+bytes.length>FIRESTORE_FILE_BUDGET_BYTES){const err=new Error('The free-tier project file budget is full. Export or archive project files before adding more.');err.status=413;throw err}tx.set(usageRef,{bytes:used+bytes.length,updatedAt:new Date().toISOString()})});
    try{
      const chunkCount=Math.ceil(bytes.length/FIRESTORE_FILE_CHUNK_BYTES),chunkRefs=[];
      for(let index=0;index<chunkCount;index++){const chunk=bytes.subarray(index*FIRESTORE_FILE_CHUNK_BYTES,(index+1)*FIRESTORE_FILE_CHUNK_BYTES);chunkRefs.push({index,data:chunk.toString('base64')})}
      for(let start=0;start<chunkRefs.length;start+=8){const batch=cloudDb.batch();for(const chunk of chunkRefs.slice(start,start+8))batch.set(ref.collection('chunks').doc(String(chunk.index).padStart(5,'0')),{data:chunk.data});await batch.commit()}
      await ref.set({kind,mimeType:mimeType||'application/octet-stream',size:bytes.length,chunkCount,metadata,createdAt:new Date().toISOString()});
    }catch(error){
      try{const snapshots=await ref.collection('chunks').get();for(let start=0;start<snapshots.docs.length;start+=450){const batch=cloudDb.batch();for(const snapshot of snapshots.docs.slice(start,start+450))batch.delete(snapshot.ref);await batch.commit()}await ref.delete()}catch{}
      try{await cloudDb.runTransaction(async tx=>{const snapshot=await tx.get(usageRef);tx.set(usageRef,{bytes:Math.max(0,Number(snapshot.get('bytes')||0)-bytes.length),updatedAt:new Date().toISOString()})})}catch{}
      throw error
    }
    return;
  }
  await fs.writeFile(path.join(kind==='uploads'?UPLOADS:MEDIA,name),bytes);
}
async function readStoredFile(kind,name) {
  if(CLOUD_MODE){
    const ref=cloudDb.collection('fieldroomFiles').doc(DATA_PREFIX).collection('objects').doc(path.basename(name));
    const metadata=await ref.get();if(!metadata.exists||metadata.get('kind')!==kind)throw new Error('Project file not found.');
    const chunks=[];const count=Number(metadata.get('chunkCount')||0);
    for(let start=0;start<count;start+=8){const refs=Array.from({length:Math.min(8,count-start)},(_,offset)=>ref.collection('chunks').doc(String(start+offset).padStart(5,'0')));const snapshots=await cloudDb.getAll(...refs);for(const snapshot of snapshots){if(!snapshot.exists)throw new Error('Project file is incomplete.');chunks.push(Buffer.from(snapshot.get('data'),'base64'))}}
    const bytes=Buffer.concat(chunks);if(bytes.length!==Number(metadata.get('size')))throw new Error('Project file size check failed.');return bytes;
  }
  return fs.readFile(path.join(kind==='uploads'?UPLOADS:MEDIA,path.basename(name)));
}
async function deleteStoredFile(kind,name) {
  const filename=path.basename(name);
  if(CLOUD_MODE){
    const namespace=cloudDb.collection('fieldroomFiles').doc(DATA_PREFIX),ref=namespace.collection('objects').doc(filename),snapshot=await ref.get();
    if(!snapshot.exists)return;
    if(snapshot.get('kind')!==kind)throw new Error('Stored file type does not match.');
    const size=Number(snapshot.get('size')||0),chunks=await ref.collection('chunks').get();
    for(let start=0;start<chunks.docs.length;start+=450){const batch=cloudDb.batch();for(const chunk of chunks.docs.slice(start,start+450))batch.delete(chunk.ref);await batch.commit()}
    await ref.delete();
    const usageRef=namespace.collection('control').doc('usage');
    await cloudDb.runTransaction(async tx=>{const usage=await tx.get(usageRef);tx.set(usageRef,{bytes:Math.max(0,Number(usage.get('bytes')||0)-size),updatedAt:new Date().toISOString()})});
    return;
  }
  try{await fs.unlink(path.join(kind==='uploads'?UPLOADS:MEDIA,filename))}catch(error){if(error.code!=='ENOENT')throw error}
}
let state = await readState();
function clientState(){return{...state,documents:(state.documents||[]).map(doc=>({...doc}))}}

function send(res, status, value, headers = {}) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  res.writeHead(status, { 'content-type': typeof value === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer', 'x-frame-options':'DENY', ...headers });
  res.end(body);
}
async function readBody(req) {
  const chunks=[]; let size=0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new Error('Request is too large.'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
function safeName(name) { return path.basename(String(name || 'upload')).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120) || 'upload'; }
function id() { return crypto.randomUUID(); }
function decodeXml(s) { return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))); }
function docxText(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if (eocd < 0) throw new Error('This DOCX file could not be opened.');
  const count=buf.readUInt16LE(eocd+10), cdOffset=buf.readUInt32LE(eocd+16); let p=cdOffset, xml='';
  for (let i=0;i<count;i++) {
    if (buf.readUInt32LE(p)!==0x02014b50) break;
    const method=buf.readUInt16LE(p+10), packed=buf.readUInt32LE(p+20), nameLen=buf.readUInt16LE(p+28), extraLen=buf.readUInt16LE(p+30), commentLen=buf.readUInt16LE(p+32), local=buf.readUInt32LE(p+42);
    const name=buf.subarray(p+46,p+46+nameLen).toString();
    if (name==='word/document.xml') {
      const start=local+30+buf.readUInt16LE(local+26)+buf.readUInt16LE(local+28), raw=buf.subarray(start,start+packed);
      xml=(method===8?zlib.inflateRawSync(raw):raw).toString('utf8'); break;
    }
    p+=46+nameLen+extraLen+commentLen;
  }
  if (!xml) throw new Error('No readable text was found in this DOCX file.');
  return decodeXml(xml.replace(/<w:tab[^>]*\/>/g,'\t').replace(/<w:br[^>]*\/>/g,'\n').replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
}
function stripFences(text) { return text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''); }

function singleRoomHintFromSetup(projectProfile={},documents=[]) {
  const scope=String(projectProfile.description||'');
  if(!/\b(?:one|single|1)\b.{0,60}\brooms?\b/i.test(scope))return null;
  const roomRefs=new Map();
  for(const doc of documents){
    const name=String(doc.name||'');
    for(const match of name.matchAll(/(?:^|[^a-z])room[\s_-]*(\d{1,5})(?!\d)/ig)){
      const number=String(match[1]);
      const descriptive=name.replace(/[_-]+/g,' ');
      const roomName=/consultation\s+room/i.test(descriptive)?'Consultation Room':/conference\s+room/i.test(descriptive)?'Conference Room':`Room ${number}`;
      roomRefs.set(number,{number,name:roomName,level:/\bfirst\s+floor\b/i.test(descriptive)?'First Floor':''});
    }
  }
  return roomRefs.size===1?[...roomRefs.values()][0]:null;
}

async function extractWithGemini(documents, options={}) {
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini extraction is not configured. Set GEMINI_API_KEY on the server, or add rooms and deliverables manually.');
  const mapDoc = documents.find(d=>d.id===options.mapDocumentId);
  const mapPage = Number(options.mapPage || 1);
  const knownRooms = Array.isArray(options.knownRooms) ? options.knownRooms : [];
  const inferredSingleRoom=knownRooms.length===0?singleRoomHintFromSetup(options.projectProfile,documents):null;
  const roomInventory=inferredSingleRoom?[inferredSingleRoom]:knownRooms;
  const parts = [{ text: `You are extracting candidate room requirements and construction deliverables from the uploaded project documents. Every deliverable must be traceable to documentary evidence. Return only JSON matching {"rooms":[{"number":"","name":"","level":"","planPage":1,"mapBox":null,"deliverables":[{"title":"","scope":"room","trade":"","sourceDocument":"","sourcePage":1,"sourceReference":"","notes":""}]}],"generalDeliverables":[{"title":"","scope":"general","trade":"","sourceDocument":"","sourcePage":1,"sourceReference":"","notes":""}],"warnings":[""]}. Put room-specific work in that room’s deliverables. Put project-wide requirements that do not belong to one room (including submittals, shop drawing packages, product data/samples, closeout, O&M manuals, warranties, training, commissioning, and project schedules) in generalDeliverables and never repeat these as room items. For every item, populate sourceDocument (exact filename), sourcePage (1-based), and sourceReference (printed contract/spec section and subsection, drawing sheet/detail, or schedule/table heading). Read the actual cited page; do not invent section, document, or page. Use the concise printed section heading only as sourceReference (for example, “§ 1.3 Submittals and quality control”); this cited section is the traceable basis for the item. Do not require or fabricate a verbatim line-item quotation. If the source has no printed section number, use its heading, sheet/detail, or schedule title. If no supporting requirement exists in uploaded documents, do not present it as extracted; include it in warnings as unverified. IMPORTANT: create one item per responsible vendor/work package whenever a source requirement covers multiple disciplines. Consolidate repeated mentions of the same obligation within the same room/project-wide scope and responsible trade into one candidate; do not duplicate a deliverable solely because it appears on multiple pages or in multiple uploaded documents. Preserve separate, independently actionable requirements as separate candidates, and retain additional supporting citations in notes when useful. Each item title must be a short, direct action that names only one package, such as “Submit millwork shop drawings” or “Submit ceiling device coordination plan.” Never combine several trades or comma-separated scopes in one title. Put only that package scope in its notes. Use a specific vendor/trade such as Drywall Contractor, Modular Room Vendor, Glazing Contractor, Millwork Vendor, Ceiling Contractor, AV/Low Voltage Vendor, Furniture Vendor, or Electrical Contractor, rather than broad labels like Architectural. Split multi-trade shop drawing/submittal requirements into separate items and cite the real section/page for each. For meeting or coordination requirements, preserve every named attendee role/person in the item notes using a clear “Participants:” list so the project checklist can assign each attendee. For reflected ceiling or ceiling-device coordination, preserve the disciplines actually named in the source; the project checklist will also include typical MEP/fire/lighting/AV/data/ceiling coordination trades for review. For closeout/as-built requirements, keep the source’s trade-specific record documents and responsible parties clear so closeout can be tracked for every project subcontractor. Do not turn coordination assumptions into claimed contract requirements. Do not invent requirements. Set every room’s mapBox to null; the user will place and adjust room markers directly on the uploaded floor plan during room confirmation. planPage is 1-based. Designated map drawing: ${mapDoc?`${mapDoc.name}, page ${mapPage}`:'not specified'}. Uploaded documents: ${documents.map(d=>d.name).join('; ')}.` }];
  parts[0].text += ` Extend the returned JSON with two top-level fields: projectInformation (an object with type, squareFeet, number, site, owner, architect, engineer, contractor, drawingVersion, startDate, targetCompletion, and description) and subcontractors (an array of {company, trade, scope, sourceDocument, sourcePage, sourceReference}). Project Setup information already entered by the user is authoritative; use it as context and repeat it in projectInformation, without changing it. Fill missing projectInformation fields only from clear evidence in the uploaded documents, otherwise leave them empty. Return dates as YYYY-MM-DD. In subcontractors, include one row per distinct vendor/trade package supported by the documents, with a concise general scope and exact source filename/page/section when available. Consolidate related work into one package and one vendor row whenever the source shows it is a shared scope: for example, glazing/storefront with doors/hardware on the same assembly; electrical with lighting/lighting controls when the same package covers both; and AV with data/network/low-voltage cabling when it is one integrated package. Do not create separate vendors just because one shared scope mentions multiple related trades. Keep separate rows only when the source clearly describes separately awarded or separate packages. Also collapse repeated/near-identical scope descriptions that were extracted under multiple trade labels into the single appropriate shared package. Copy company/vendor names only when a source explicitly identifies them; leave company empty when only a trade is supported. When Project Setup names a general contractor, use that name on a General Contractor package if the extracted work includes that role. Do not turn meeting attendees, the owner, architect, or engineer into subcontractors unless a source identifies a relevant trade package for them. Do not invent project facts, trade packages, company names, dates, or scopes. Project Setup context: ${JSON.stringify(options.projectProfile||{})}.`;
  if (roomInventory.length === 1) {
    const room = roomInventory[0];
    parts[0].text += ` THIS PROJECT HAS EXACTLY ONE ROOM: ${JSON.stringify({number:room.number,name:room.name,level:room.level})}. Return exactly that one room in rooms and assign room-specific requirements only to it when supported by the documents. Do not create additional rooms from adjacent spaces, floor labels, narrative room mentions, or other drawing features. Put project-wide requirements in generalDeliverables.`;
  } else if (roomInventory.length > 1) {
    const rooms = roomInventory.map(room=>({number:room.number,name:room.name,level:room.level}));
    parts[0].text += ` THIS PROJECT HAS ${roomInventory.length} ROOMS: ${JSON.stringify(rooms)}. Use these existing room identities; do not create duplicate rooms or add rooms outside this project inventory. Assign a requirement to a room only when the documents support that association, and keep project-wide requirements in generalDeliverables.`;
  }
  for (const d of documents) {
    const bytes = await readStoredFile('uploads',d.storageName);
    const ext = path.extname(d.name).toLowerCase();
    if (ext === '.docx') parts.push({ text:`DOCUMENT ${d.name}\n${docxText(bytes).slice(0,90000)}` });
    else if (['.txt','.md','.csv'].includes(ext)) parts.push({ text:`DOCUMENT ${d.name}\n${bytes.toString('utf8').slice(0,90000)}` });
    else parts.push({ inline_data:{ mime_type:d.mimeType || MIME_BY_EXT[ext] || 'application/octet-stream', data:bytes.toString('base64') } });
  }
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const requestBody = JSON.stringify({ contents:[{parts}], generationConfig:{ responseMimeType:'application/json' } });
  let response, payload={};
  for (let attempt=0; attempt<4; attempt++) {
    response = await fetch(endpoint, { method:'POST', headers:{'content-type':'application/json'}, body:requestBody });
    payload = await response.json().catch(()=>({}));
    if (response.ok) break;
    const message = payload.error?.message || `Gemini returned ${response.status}.`;
    const overloaded = response.status===503 || /high demand|overloaded|temporarily unavailable/i.test(message);
    if (!overloaded || attempt===3) throw new Error(message);
    await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
  }
  const raw=payload.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('');
  if (!raw) throw new Error('Gemini returned no extractable content.');
  const extracted=JSON.parse(stripFences(raw));
  if (!Array.isArray(extracted.rooms)) throw new Error('Extraction response did not contain a room list.');
  if(roomInventory.length===1){
    const only=roomInventory[0];
    const match=extracted.rooms.find(room=>String(room.number||'').trim().toLowerCase()===String(only.number||'').trim().toLowerCase());
    extracted.rooms=[{...(match||{}),number:String(only.number||''),name:String(only.name||match?.name||`Room ${only.number}`),level:String(only.level||match?.level||''),mapBox:null,deliverables:Array.isArray(match?.deliverables)?match.deliverables:[]}];
  }else if(roomInventory.length>1){
    const allowed=new Set(roomInventory.map(room=>String(room.number||'').trim().toLowerCase()));
    extracted.rooms=extracted.rooms.filter(room=>allowed.has(String(room.number||'').trim().toLowerCase()));
  }
  return extracted;
}

async function authenticateRequest(req) {
  if(!AUTH_REQUIRED)return null;
  const match=String(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i);
  if(!match){const err=new Error('Sign in to access this project.');err.status=401;throw err}
  let decoded;
  try{decoded=await cloudAuth.verifyIdToken(match[1])}catch{const err=new Error('Your sign-in expired. Sign in again.');err.status=401;throw err}
  const email=String(decoded.email||'').toLowerCase();
  if(!decoded.email_verified){const err=new Error('Verify your email address before using Fieldroom.');err.status=403;throw err}
  if(!ALLOWED_EMAILS.has(email)){const err=new Error('This account is not on the project access list. Ask the project administrator to add your email.');err.status=403;throw err}
  return {uid:decoded.uid,email,accountType:ACCOUNT_TYPES.get(email)||'project_manager'};
}

function preserveManagerSetup(current,incoming) {
  const project={...incoming.project};
  for (const field of ['id','name','type','squareFeet','number','site','owner','architect','engineer','contractor','drawingVersion','startDate','targetCompletion','description','mapConfig','subcontractors','subcontractorsConfirmed']) {
    project[field]=current.project?.[field];
  }
  return {...incoming,project,documents:current.documents,suggestions:current.suggestions,roomSuggestions:current.roomSuggestions,reviewProgress:current.reviewProgress,projectLibrary:current.projectLibrary};
}

const server = http.createServer(async (req,res)=>{
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method==='GET' && url.pathname==='/api/config') return send(res,200,{authRequired:AUTH_REQUIRED,firebaseApiKey:AUTH_REQUIRED?WEB_API_KEY:'',firebaseAuthDomain:AUTH_REQUIRED?(process.env.FIREBASE_AUTH_DOMAIN||`${PROJECT_ID}.firebaseapp.com`):''});
    if (req.method==='GET' && url.pathname==='/api/health') return send(res,200,{ok:true,geminiConfigured:Boolean(process.env.GEMINI_API_KEY),cloudMode:CLOUD_MODE,authRequired:AUTH_REQUIRED});
    const needsAuth=(url.pathname.startsWith('/api/')&&!['/api/config','/api/health'].includes(url.pathname))||url.pathname.startsWith('/media/');
    if(needsAuth&&AUTH_REQUIRED){try{req.user=await authenticateRequest(req)}catch(e){return send(res,e.status||401,{error:e.message})}state=await readState()}
    if (req.method==='GET' && url.pathname==='/api/account') return send(res,200,{email:req.user?.email||'',accountType:req.user?.accountType||'project_manager'});
    const managerOnly=(req.method==='POST'&&['/api/upload','/api/extract','/api/project/reset'].includes(url.pathname))||(req.method==='DELETE'&&url.pathname.startsWith('/api/document/'));
    if (managerOnly&&req.user?.accountType==='field_team') return send(res,403,{error:'This action is reserved for Project Manager accounts.'});
    if (req.method==='GET' && url.pathname==='/api/state') return send(res,200,clientState());
    if (req.method==='PUT' && url.pathname==='/api/state') {
      let incoming=JSON.parse(await readBody(req));
      if (!incoming || typeof incoming!=='object' || !incoming.project || !Array.isArray(incoming.project.rooms)) return send(res,400,{error:'Project state is not valid.'});
      if (req.user?.accountType==='field_team') incoming=preserveManagerSetup(state,incoming);
      const storageById=new Map((state.documents||[]).map(d=>[d.id,d.storageName]));
      const merged={...state,...incoming,documents:(incoming.documents||[]).map(d=>({...d,storageName:d.storageName||storageById.get(d.id)}))};
      try{state=await writeState(merged,incoming.revision||0)}catch(e){if(e.code==='STATE_CONFLICT')return send(res,409,{error:e.message});throw e}return send(res,200,{ok:true,revision:state.revision||0});
    }
    if (req.method==='POST' && url.pathname==='/api/upload') {
      const body=JSON.parse(await readBody(req)); const name=safeName(body.name); const ext=path.extname(name).toLowerCase();
      if (!MIME_BY_EXT[ext]) return send(res,415,{error:'Supported files: PDF, DOCX, TXT, MD, CSV, PNG, JPG, and WEBP.'});
      const bytes=Buffer.from(String(body.data||''),'base64'); if (!bytes.length || bytes.length>MAX_FILE) return send(res,413,{error:'File is empty or exceeds the 8 MB free-tier limit.'});
      const doc={id:id(),name,mimeType:body.mimeType||MIME_BY_EXT[ext],category:body.category==='floorplan'?'floorplan':'supporting',size:bytes.length,uploadedAt:new Date().toISOString(),status:'uploaded',storageName:`${crypto.randomUUID()}${ext}`};
      await saveStoredFile('uploads',doc.storageName,bytes,doc.mimeType,{uploadedBy:req.user?.uid||'local'}); state.documents.push(doc);state.project.updatedAt=new Date().toISOString();state=await writeState(state,state.revision||0);
      return send(res,201,{document:{...doc,storageName:undefined},state:clientState()});
    }
    if (req.method==='POST' && url.pathname==='/api/extract') {
      const body=JSON.parse(await readBody(req)); const docs=state.documents.filter(d=>(body.documentIds||[]).includes(d.id));
      if (!docs.length) return send(res,400,{error:'Choose at least one uploaded document.'});
      const mapDoc=state.documents.find(d=>d.id===body.mapDocumentId);
      if (!mapDoc || (mapDoc.category!=='floorplan' && state.project.mapConfig?.documentId!==mapDoc.id) || !['application/pdf','image/png','image/jpeg','image/webp'].includes(mapDoc.mimeType)) return send(res,400,{error:'Upload and select a full floor plan before extracting room requirements.'});
      const extracted=await extractWithGemini(docs,{mapDocumentId:body.mapDocumentId,mapPage:body.mapPage,knownRooms:state.project.rooms||[],projectProfile:state.project||{}});
      const sourceNames=docs.map(d=>d.name);
      const newRoomSuggestions=(extracted.rooms||[]).map(room=>({id:id(),roomNumber:String(room.number||'').trim(),roomName:String(room.name||'').trim(),level:String(room.level||'').trim(),planPage:Number(room.planPage||body.mapPage||1),mapBox:room.mapBox&&typeof room.mapBox==='object'?room.mapBox:null,mapDocumentId:body.mapDocumentId||null,sources:sourceNames,status:'pending'})).filter(room=>room.roomNumber||room.roomName);
      state.roomSuggestions=state.roomSuggestions||[];state.roomSuggestions.push(...newRoomSuggestions);
      const makeSuggestion=(item,room=null,scope='room')=>({id:id(),scope,roomNumber:String(room?.number||'').trim(),roomName:String(room?.name||'').trim(),level:String(room?.level||'').trim(),title:String(item.title||'').trim(),trade:String(item.trade||'').trim(),sourceDocument:String(item.sourceDocument||'').trim(),sourcePage:Number(item.sourcePage)||null,sourceReference:String(item.sourceReference||'').trim(),notes:String(item.notes||'').trim(),sources:sourceNames,status:'pending',planPage:Number(room?.planPage||body.mapPage||1),mapBox:room?.mapBox&&typeof room.mapBox==='object'?room.mapBox:null,mapDocumentId:scope==='room'?body.mapDocumentId||null:null});
      const roomSuggestions=(extracted.rooms||[]).flatMap(room=>(room.deliverables||[]).map(item=>makeSuggestion(item,room,'room'))).filter(s=>s.title);
      const generalSuggestions=(extracted.generalDeliverables||[]).map(item=>makeSuggestion(item,null,'general')).filter(s=>s.title);
      const newSuggestions=[...generalSuggestions,...roomSuggestions];
      state.suggestions.push(...newSuggestions);
      for (const d of docs) d.status='extracted';state.project.updatedAt=new Date().toISOString();state=await writeState(state,state.revision||0);
      return send(res,200,{suggestions:newSuggestions,roomSuggestions:newRoomSuggestions,warnings:extracted.warnings||[],projectInformation:extracted.projectInformation||{},subcontractors:Array.isArray(extracted.subcontractors)?extracted.subcontractors:[],state:clientState()});
    }
    if (req.method==='POST' && url.pathname==='/api/project/reset') {
      const currentProject=state.project||{},project={id:currentProject.id||id(),name:currentProject.name||'New project',updatedAt:new Date().toISOString(),rooms:[],mapConfig:{documentId:'',page:1}},documents=state.documents||[],media=new Set();
      const deliverables=[...(currentProject.generalDeliverables||[]),...(currentProject.rooms||[]).flatMap(room=>room.deliverables||[])];
      for(const deliverable of deliverables)for(const photo of deliverable.photos||[]){try{const pathname=new URL(photo.url,'http://localhost').pathname;if(pathname.startsWith('/media/'))media.add(path.basename(pathname.slice('/media/'.length)))}catch{}}
      const nextState={project,documents:[],suggestions:[],roomSuggestions:[],revision:state.revision||0};
      if(state.projectLibrary?.projects){const library=state.projectLibrary;nextState.projectLibrary={...library,activeId:project.id,projects:library.projects.map(entry=>entry.id===project.id?{id:project.id,name:project.name,data:{...nextState,project,revision:state.revision||0}}:entry)}}
      state=await writeState(nextState,state.revision||0);let cleanupFailed=false;
      for(const doc of documents)if(doc.storageName)try{await deleteStoredFile('uploads',doc.storageName)}catch{cleanupFailed=true}
      for(const filename of media)try{await deleteStoredFile('media',filename)}catch{cleanupFailed=true}
      return send(res,200,{ok:true,warning:cleanupFailed?'The project was reset, but some uploaded files could not be removed from storage.':undefined,state:clientState()});
    }
    if (req.method==='GET' && url.pathname.startsWith('/api/document/')) {
      const docId=path.basename(url.pathname.slice('/api/document/'.length)); const doc=state.documents.find(d=>d.id===docId);
      if (!doc) return send(res,404,{error:'Document not found.'});
      const bytes=await readStoredFile('uploads',doc.storageName);
      res.writeHead(200,{'content-type':doc.mimeType||'application/octet-stream','content-length':bytes.length,'cache-control':CLOUD_MODE?'private, no-store':'private, max-age=3600','x-content-type-options':'nosniff','content-disposition':`inline; filename="${safeName(doc.name)}"`});return res.end(bytes);
    }
    if (req.method==='DELETE' && url.pathname.startsWith('/api/document/')) {
      const docId=path.basename(url.pathname.slice('/api/document/'.length)),doc=state.documents.find(d=>d.id===docId);
      if(!doc)return send(res,404,{error:'Document not found.'});
      const nextState={...state,documents:state.documents.filter(d=>d.id!==docId),project:{...state.project,updatedAt:new Date().toISOString()}};
      if(nextState.project.mapConfig?.documentId===docId)nextState.project.mapConfig={documentId:'',page:1};
      for(const room of nextState.project.rooms||[])if(room.mapDocumentId===docId)room.mapDocumentId=null;
      state=await writeState(nextState,state.revision||0);
      let warning='';try{await deleteStoredFile('uploads',doc.storageName)}catch(error){warning='The document was removed from the project, but its stored file could not be cleaned up.';console.error(`Upload cleanup failed for ${doc.id}:`,error)}
      return send(res,200,{ok:true,documentId:docId,warning,state:clientState()});
    }
    if (req.method==='POST' && url.pathname==='/api/photo') {
      const body=JSON.parse(await readBody(req)); const ext=String(body.mimeType||'image/jpeg').includes('png')?'.png':String(body.mimeType||'').includes('webp')?'.webp':'.jpg';
      const bytes=Buffer.from(String(body.data||''),'base64'); if (!bytes.length || bytes.length>MAX_FILE) return send(res,413,{error:'Photo is empty or exceeds the upload limit.'});
      const mediaId=crypto.randomUUID(); await saveStoredFile('media',mediaId+ext,bytes,body.mimeType||'image/jpeg',{uploadedBy:req.user?.uid||'local'});
      return send(res,201,{id:mediaId,url:`/media/${mediaId}${ext}`});
    }
    if (req.method==='GET' && url.pathname.startsWith('/media/')) {
      const filename=path.basename(url.pathname.slice(7)); const target=path.join(MEDIA,filename);
      try { const bytes=await readStoredFile('media',filename); const type=MIME_BY_EXT[path.extname(filename).toLowerCase()]||'application/octet-stream'; res.writeHead(200,{'content-type':type,'cache-control':CLOUD_MODE?'private, no-store':'private, max-age=3600','x-content-type-options':'nosniff'}); return res.end(bytes); }
      catch { return send(res,404,'Not found'); }
    }
    if (req.method==='GET') {
      const relative=url.pathname==='/'?'index.html':url.pathname.slice(1); const target=path.resolve(ROOT,'public',relative);
      if (!target.startsWith(path.resolve(ROOT,'public')+path.sep)) return send(res,403,'Forbidden');
      try { const bytes=await fs.readFile(target); const ext=path.extname(target).toLowerCase();const type=ext==='.css'?'text/css; charset=utf-8':(['.js','.mjs'].includes(ext))?'text/javascript; charset=utf-8':ext==='.svg'?'image/svg+xml':ext==='.webmanifest'?'application/manifest+json':'text/html; charset=utf-8'; res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY'}); return res.end(bytes); }
      catch { return send(res,404,'Not found'); }
    }
    return send(res,404,{error:'Not found'});
  } catch(error) { return send(res,error.status||(error.code==='STATE_CONFLICT'?409:500),{error:error.message||'Unexpected server error.'}); }
});
server.listen(PORT,HOST,()=>console.log(`Room Matrix server running at http://${HOST}:${PORT}`));
