// Interactive "How Fieldroom is built and how it works" diagram.
(() => {
  const DETAILS = {
    claude: ['Claude Code', 'An AI coding assistant that fixed bugs and built features such as accountability tracking and the accuracy checks. Every change was tested automatically and in a real browser before it was proposed.'],
    github: ['GitHub', 'Each change arrives as a pull request: a reviewable package that is approved and merged into the main code. GitHub keeps every version, so any change can be traced or undone.'],
    studio: ['Google AI Studio', 'AI Studio imports the code from GitHub and runs Fieldroom. The Gemini API key lives in its Secrets panel, so it never appears in the code or the browser. Code only flows one way, from GitHub into AI Studio, to avoid overwrites.'],
    demo: ['Live Fieldroom demo', 'AI Studio publishes the app to a public link. The demo uses fictional sample documents and resets from time to time; licensed workspaces add sign-in and permanent storage.'],
    upload: ['1. Upload documents', 'The project manager uploads the floor plan and specifications (PDF, Word, text, or images, up to 8 MB each). The server stores them and warns if a file goes missing.'],
    gemini: ['2. Gemini Flash Lite reads them', 'Fieldroom sends the documents to Google\u2019s Gemini 3.5 Flash Lite with precise instructions. Gemini returns structured results: rooms, trades, room deliverables, project-wide requirements, and the document, page, and section behind each item.'],
    checks: ['3. Accuracy checks', 'A second completeness pass looks only for requirements the first pass missed. Every citation is checked: the document must be an upload, the page must exist, and the section must appear in the text. Doubtful items are flagged for the reviewer.'],
    review: ['4. A person reviews every item', 'A guided review confirms the subcontractors, then each room, then each requirement. Nothing reaches the room matrix until a person approves it, and every approval is recorded.'],
    matrix: ['5. Room matrix and progress', 'Approved items become the room matrix. Crews open a room by QR code, mark work complete, and add notes and photos. Progress rolls up by room and trade, and the activity log shows who did what and when.'],
  };
  const root = document.getElementById('how-it-works');
  if (!root) return;
  const nodes = [...root.querySelectorAll('.dg-node')];
  const detail = document.getElementById('dg-detail');
  const play = document.getElementById('dg-play');
  const flow = ['upload', 'gemini', 'checks', 'review', 'matrix'];
  let timer = null;

  function select(step) {
    for (const n of nodes) { const on = n.dataset.step === step; n.classList.toggle('is-active', on); n.setAttribute('aria-pressed', String(on)); }
    const [title, text] = DETAILS[step] || ['', ''];
    detail.innerHTML = '<span class="dg-detail-title"></span><span class="dg-detail-text"></span>';
    detail.querySelector('.dg-detail-title').textContent = title;
    detail.querySelector('.dg-detail-text').textContent = text;
  }
  function stop() { clearInterval(timer); timer = null; play.setAttribute('aria-pressed', 'false'); play.innerHTML = '<span aria-hidden="true">\u25B6</span> Play the flow'; }
  function start() {
    let i = 0; select(flow[i]);
    play.setAttribute('aria-pressed', 'true'); play.innerHTML = '<span aria-hidden="true">\u275A\u275A</span> Pause';
    timer = setInterval(() => { i += 1; if (i >= flow.length) { stop(); return; } select(flow[i]); }, 3200);
  }
  for (const n of nodes) n.addEventListener('click', () => { stop(); select(n.dataset.step); });
  play.addEventListener('click', () => (timer ? stop() : start()));
})();
