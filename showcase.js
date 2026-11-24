// ============================================================
// Fieldroom showcase settings: fill these in, then publish.
// ============================================================
const SHOWCASE = {
  teamName: "MK Engineering",
  organization: "Clemson University",
  // One entry per person: { name: "Full Name", role: "What they did" }
  members: [
    { name: "Kelsea Walker", role: "Developer" },
    { name: "Mackenzie Dilgard", role: "Developer" },
  ],

  // YouTube (Unlisted is fine), Google Drive, or Vimeo link to the demo video.
  demoVideo: "",

  // Published Google AI Studio link (usually ends in .run.app). Leave empty to hide the button.
  liveDemo: "",

  // Midterm feedback and lessons learned, and what changed because of each.
  // One entry per point: { feedback: "What we learned", change: "What we changed" }
  midtermFeedback: [
    { feedback: "Consider how the product will be used in the field. Some ideas work better on paper than on a jobsite.",
      change: "Replaced the glitchy drawing map with a searchable room list and focused on QR access and quick field updates." },
    { feedback: "Tracking progress is one of the most important tools project engineers look for.",
      change: "Made progress tracking by room and trade a core feature, with completion rolled up across trades and a CSV export." },
    { feedback: "Connecting the API key properly should be the first priority. Without it, the tool does not work.",
      change: "Moved the Gemini key into AI Studio’s Secrets panel so extraction works reliably and the key never appears in the code." },
    { feedback: "AI needs exact instructions. Leaving room for assumptions is where errors occur.",
      change: "Fieldroom’s instructions to the AI spell out exactly what to return, including a source citation for every item, and errors now explain what went wrong and how to fix it." },
    { feedback: "The model you choose greatly affects how much you can use the tool.",
      change: "Switched to Gemini 3.5 Flash Lite for about 500 free requests a day." },
  ],
};
// ============================================================

const fill = (key, value) => document.querySelectorAll(`[data-fill="${key}"]`).forEach(el => { el.textContent = value; });
fill("team-name", SHOWCASE.teamName);
fill("team-org", SHOWCASE.organization);

// Team members
const memberList = document.getElementById("team-members");
if (memberList) {
  for (const person of SHOWCASE.members) {
    const item = document.createElement("li");
    const initials = person.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
    item.innerHTML = `<span class="member-avatar"></span><span><b></b><small></small></span>`;
    item.querySelector(".member-avatar").textContent = initials;
    item.querySelector("b").textContent = person.name;
    item.querySelector("small").textContent = person.role || "";
    memberList.appendChild(item);
  }
  memberList.hidden = SHOWCASE.members.length === 0;
}

// Demo video: embed YouTube, Google Drive, or Vimeo links; otherwise show a link.
function embedUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
    if (host.endsWith("youtube.com")) {
      const id = u.searchParams.get("v") || u.pathname.split("/").filter(Boolean).pop();
      return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (host === "drive.google.com") {
      const match = u.pathname.match(/\/file\/d\/([^/]+)/);
      if (match) return `https://drive.google.com/file/d/${match[1]}/preview`;
    }
    if (host === "vimeo.com") return `https://player.vimeo.com/video/${u.pathname.split("/").filter(Boolean)[0]}`;
  } catch {}
  return "";
}
if (SHOWCASE.demoVideo) {
  const frame = document.getElementById("video-frame");
  const link = document.getElementById("video-link");
  const src = embedUrl(SHOWCASE.demoVideo);
  if (src) {
    frame.classList.add("has-video");
    frame.innerHTML = `<iframe src="${src}" title="Fieldroom product demo video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>`;
  } else {
    frame.querySelector(".video-placeholder p").textContent = "Watch the Fieldroom demo";
  }
  link.href = SHOWCASE.demoVideo;
  link.hidden = false;
}

// Live demo button
if (SHOWCASE.liveDemo) {
  const demo = document.getElementById("demo-link");
  demo.href = SHOWCASE.liveDemo;
  demo.hidden = false;
}

// Midterm feedback
const feedbackBox = document.getElementById("feedback");
if (feedbackBox) {
  if (SHOWCASE.midtermFeedback.length) {
    const list = document.createElement("ul");
    list.className = "feedback-list";
    for (const point of SHOWCASE.midtermFeedback) {
      const item = document.createElement("li");
      item.innerHTML = `<b>Lesson:</b> <span class="heard"></span><br><b>Change:</b> <span class="changed"></span>`;
      item.querySelector(".heard").textContent = point.feedback;
      item.querySelector(".changed").textContent = point.change;
      list.appendChild(item);
    }
    const body = feedbackBox.querySelector("p");
    body.querySelector('[data-fill="feedback"]').remove();
    body.appendChild(list);
  } else {
    feedbackBox.hidden = true;
  }
}
