// Replace these with the team's actual public destinations before publishing.
const links = {
  github: "https://github.com/mdilgar-commits/Fieldroom-Showcase",
  aiStudio: "https://aistudio.google.com/",
  demoVideo: "",
};

document.getElementById("project-link").href = links.github;
document.getElementById("studio-link").href = links.aiStudio;

// When a recorded video URL is available, turn the demo panel into a video link.
if (links.demoVideo) {
  const video = document.querySelector(".video-placeholder");
  video.innerHTML = `<a class="play-button" href="${links.demoVideo}" target="_blank" rel="noreferrer" aria-label="Play Fieldroom demo">▶</a><div class="video-label">PRODUCT WALKTHROUGH</div><p>Watch the Fieldroom demo</p><small>Opens the team's recorded product walkthrough.</small>`;
}
