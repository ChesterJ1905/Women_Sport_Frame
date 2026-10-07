const BUILD_NUMBER = "2.00";

const LEAGUES = [
  ["wnba", "WNBA"],
  ["unrivaled", "Unrivaled"],
  ["nwsl", "NWSL"],
  ["pwhl", "PWHL"],
  ["wsl", "Women’s Super League"],
  ["uwcl", "Women’s Champions League"],
  ["national", "Women’s national teams"],
  ["march", "Women’s March Madness"],
  ["softball", "NCAA Softball"],
  ["volleyball", "NCAA Volleyball"],
  ["college-soccer", "NCAA Soccer"],
  ["lacrosse", "NCAA Lacrosse"],
  ["college-hockey", "NCAA Hockey"],
  ["college-other", "Other NCAA championships"]
];

const DEFAULT_SETTINGS = {
  leagues: Object.fromEntries(
    LEAGUES.map(([id]) => [id, true])
  ),
  teams: [],
  backgroundColor: "#0b1117",
  brightness: 100,
  slideDuration: 20000
};

const el = id => document.getElementById(id);

const slideRoot = el("slideRoot");
const settingsPanel = el("settingsPanel");
const playStateIcon = el("playStateIcon");
const settingsHotspot = el("settingsHotspot");
const backgroundColorInput = el("backgroundColor");
const backgroundColorValue = el("backgroundColorValue");
const brightnessSlider = el("brightnessSlider");
const brightnessValue = el("brightnessValue");
const slideDuration = el("slideDuration");
const buildNumber = el("buildNumber");

let data = null;
let settings = loadSettings();
let slideQueue = [];
let slideIndex = 0;
let paused = false;
let slideTimer = null;
let iconTimer = null;
let draftTeams = [...settings.teams];
let catalog = {};
let catalogRequests = new Set();
let fetching = false;
let offline = false;

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value = "") {
  return escapeHTML(value);
}

function loadSettings() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("sportsFrameSettings") || "{}"
    );

    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      leagues: {
        ...DEFAULT_SETTINGS.leagues,
        ...saved.leagues
      },
      teams: Array.isArray(saved.teams) ? saved.teams : []
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }
}

function saveSettings() {
  try {
    localStorage.setItem(
      "sportsFrameSettings",
      JSON.stringify(settings)
    );
  } catch {}
}

function stamp(date, options) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    ...options
  }).format(new Date(date));
}

function image(url) {
  try {
    return new URL(url).protocol === "https:"
      ? escapeAttribute(url)
      : "";
  } catch {
    return "";
  }
}

function gameOrder(a, b) {
  const priority = game =>
    game.status === "live"
      ? 0
      : game.status === "scheduled"
        ? 1
        : 2;

  return (
    priority(a) - priority(b) ||
    (
      a.status === "final" && b.status === "final"
        ? Date.parse(b.date) - Date.parse(a.date)
        : Date.parse(a.date) - Date.parse(b.date)
    )
  );
}

function allTeams() {
  const map = new Map();

  for (const list of Object.values(catalog)) {
    for (const team of list) {
      map.set(team.key, team);
    }
  }

  for (const game of data?.games || []) {
    for (const team of [game.home, game.away]) {
      const key = game.league + "|" + team.name;

      if (!map.has(key)) {
        map.set(key, {
          ...team,
          key,
          league: game.league
        });
      }
    }
  }

  for (const key of settings.teams) {
    if (!map.has(key)) {
      map.set(key, {
        key,
        league: key.split("|")[0],
        name: key.split("|").slice(1).join("|")
      });
    }
  }

  return [...map.values()];
}

function buildSlideQueue() {
  slideQueue = [];

  if (!data) return;

  for (const [id, name] of LEAGUES) {
    if (!settings.leagues[id]) continue;

    const games = data.games
      .filter(game => game.league === id)
      .sort(gameOrder);

    if (games.length) {
      for (let i = 0; i < games.length; i += 3) {
        slideQueue.push({
          id: id + ":" + i,
          league: id,
          name,
          games: games.slice(i, i + 3),
          page: i / 3 + 1,
          pages: Math.ceil(games.length / 3)
        });
      }
    } else {
      slideQueue.push({
        id,
        league: id,
        name,
        games: []
      });
    }
  }

  for (const key of settings.teams) {
    const team = allTeams().find(team => team.key === key);

    if (!team) continue;

    const games = data.games
      .filter(game =>
        game.league === team.league &&
        (
          game.home.name === team.name ||
          game.away.name === team.name
        )
      )
      .sort(gameOrder);

    if (games.length) {
      for (let i = 0; i < games.length; i += 3) {
        slideQueue.push({
          id: key + ":" + i,
          league: team.league,
          name: team.name,
          team,
          games: games.slice(i, i + 3),
          page: i / 3 + 1,
          pages: Math.ceil(games.length / 3)
        });
      }
    } else {
      slideQueue.push({
        id: key,
        league: team.league,
        name: team.name,
        team,
        games: []
      });
    }
  }
}

function gameMarkup(game) {
  const showScore =
    game.status === "live" ||
    game.status === "final";

  const status =
    game.status === "live"
      ? "LIVE · " + (game.detail || "In progress")
      : game.status === "final"
        ? "FINAL"
        : game.status === "scheduled"
          ? stamp(game.date, {
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short"
            })
          : game.status.toUpperCase();

  return `
    <article class="sports-game ${escapeAttribute(game.status)}">
      <div class="game-label">
        <span>
          ${escapeHTML(stamp(game.date, {
            weekday: "short",
            month: "short",
            day: "numeric"
          }))}
        </span>
        <span>${escapeHTML(status)}</span>
      </div>

      ${[game.away, game.home].map(team => `
        <div class="sports-team">
          ${image(team.logo)
            ? `<img src="${image(team.logo)}" alt="">`
            : ""
          }

          <span class="sports-team-name">
            ${escapeHTML(team.name)}
          </span>

          <strong class="sports-score">
            ${showScore ? escapeHTML(team.score ?? "—") : ""}
          </strong>
        </div>
      `).join("")}

      ${game.round || game.broadcast
        ? `
          <div class="game-note">
            ${escapeHTML(
              [game.round, game.broadcast]
                .filter(Boolean)
                .join(" · ")
            )}
          </div>
        `
        : ""
      }
    </article>
  `;
}

function showSlide(index) {
  clearTimeout(slideTimer);

  if (!slideQueue.length) {
    slideRoot.innerHTML = `
      <div class="empty-slide">
        <div>
          <h1>Women’s Sports</h1>
          <p>
            Choose leagues or favorite teams in settings
            to start the frame.
          </p>
        </div>
      </div>
    `;
    return;
  }

  slideIndex =
    ((index % slideQueue.length) + slideQueue.length) %
    slideQueue.length;

  const slide = slideQueue[slideIndex];

  const coverage =
    data.coverage.find(item => item.league === slide.league)
      ?.status || "unavailable";

  const leagueName =
    LEAGUES.find(([id]) => id === slide.league)?.[1] ||
    slide.league;

  const logo = image(slide.team?.logo);

  const college =
    data.leagues?.find(league => league.id === slide.league)
      ?.college;

  const monogram =
    slide.team?.short ||
    ({
      wnba: "WNBA",
      nwsl: "NWSL",
      pwhl: "PWHL",
      wsl: "WSL",
      uwcl: "UWCL",
      national: "INTL",
      march: "NCAA",
      unrivaled: "UR"
    }[slide.league] || "NCAA");

  const emptyMessage =
    coverage === "not-connected"
      ? "This league’s scores aren’t connected yet."
      : coverage === "unavailable"
        ? "Scores are temporarily unavailable."
        : college
          ? "No NCAA championship games scheduled."
          : "No games listed this week.";

  slideRoot.innerHTML = `
    <section class="sports-slide ${
      slide.games.length > 2 ? "compact" : ""
    }">
      <div class="sports-identity">
        <p class="eyebrow">
          ${slide.team ? "YOUR TEAM" : "YOUR LEAGUE"}
        </p>

        ${logo
          ? `<img class="identity-logo" src="${logo}" alt="">`
          : `
            <div class="identity-monogram">
              ${escapeHTML(monogram)}
            </div>
          `
        }

        <h1 class="sports-title">
          ${escapeHTML(slide.name)}
        </h1>

        <p class="sports-subtitle">
          ${escapeHTML(
            slide.team
              ? leagueName
              : college
                ? "NCAA championships only"
                : "Scores & upcoming games"
          )}
        </p>
      </div>

      <div class="scoreboard">
        <div class="board-heading">
          <span>
            ${escapeHTML(stamp(new Date(), {
              weekday: "long",
              month: "short",
              day: "numeric"
            }))}
          </span>

          <span>
            ${slide.pages > 1
              ? slide.page + " / " + slide.pages
              : ""
            }
          </span>
        </div>

        ${slide.games.length
          ? slide.games.map(gameMarkup).join("")
          : `
            <div class="quiet-board">
              ${escapeHTML(emptyMessage)}
              <small>
                ${coverage === "connected"
                  ? "Schedules refresh automatically."
                  : "Other selected leagues and teams will continue to rotate."
                }
              </small>
            </div>
          `
        }

        <div class="feed-note">
          ${offline ? "Offline · Saved scores from " : "Updated "}
          ${escapeHTML(stamp(data.updatedAt, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
          }))}
          ${coverage === "partial" ? " · Partial coverage" : ""}
        </div>
      </div>
    </section>
  `;

  scheduleNextSlide();
}

function scheduleNextSlide() {
  clearTimeout(slideTimer);

  if (
    paused ||
    !settingsPanel.classList.contains("hidden")
  ) return;

  slideTimer = setTimeout(
    () => showSlide(slideIndex + 1),
    settings.slideDuration
  );
}

async function loadData() {
  if (fetching) return;

  fetching = true;

  try {
    const response = await fetch("/api/games", {
      cache: "no-store"
    });

    if (!response.ok) throw new Error();

    const nextData = await response.json();

    if (!Array.isArray(nextData.games)) {
      throw new Error();
    }

    const current = slideQueue[slideIndex]?.id;

    data = nextData;
    offline = false;

    try {
      localStorage.setItem(
        "sportsFrameCache",
        JSON.stringify(data)
      );
    } catch {}

    buildSlideQueue();

    showSlide(
      Math.max(
        0,
        slideQueue.findIndex(slide => slide.id === current)
      )
    );
  } catch {
    offline = true;

    if (!data) {
      try {
        data = JSON.parse(
          localStorage.getItem("sportsFrameCache")
        );
      } catch {}
    }

    if (data) {
      buildSlideQueue();
      showSlide(slideIndex);
    } else {
      slideRoot.innerHTML = `
        <div class="empty-slide">
          <div>
            <h1>Connecting to scores…</h1>
            <p>
              Check the frame’s internet connection.
              Scores retry automatically.
            </p>
          </div>
        </div>
      `;
    }
  } finally {
    fetching = false;
    renderCoverage();
  }
}

function renderCoverage() {
  el("coverageStatus").innerHTML =
    (data?.coverage || []).map(item =>
      escapeHTML(
        LEAGUES.find(([id]) => id === item.league)?.[1] ||
        item.league
      ) +
      " — " +
      escapeHTML(item.status.replaceAll("-", " "))
    ).join("<br>") || "Waiting for feeds…";
}

function renderTeamChoices() {
  const league = el("teamLeague").value;
  const query = el("teamSearch").value.toLowerCase();

  const teams = allTeams()
    .filter(team =>
      team.league === league &&
      team.name.toLowerCase().includes(query)
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  el("teamChoices").innerHTML = teams.map(team => `
    <label class="toggle-row">
      <span>${escapeHTML(team.name)}</span>

      <input
        type="checkbox"
        data-team="${escapeAttribute(team.key)}"
        ${draftTeams.includes(team.key) ? "checked" : ""}
      >
    </label>
  `).join("");

  el("teamChoices")
    .querySelectorAll("input")
    .forEach(checkbox => {
      checkbox.onchange = () => {
        draftTeams = draftTeams.filter(
          key => key !== checkbox.dataset.team
        );

        if (checkbox.checked) {
          draftTeams.push(checkbox.dataset.team);
        }
      };
    });

  el("teamStatus").textContent = teams.length
    ? draftTeams.length + " favorite teams selected."
    : "No teams loaded for this league yet.";
}

async function loadTeamCatalog() {
  const id = el("teamLeague").value;

  if (catalog[id] || catalogRequests.has(id)) {
    renderTeamChoices();
    return;
  }

  catalogRequests.add(id);
  el("teamStatus").textContent = "Loading teams…";

  try {
    const response = await fetch(
      "/api/teams?league=" + encodeURIComponent(id)
    );

    if (!response.ok) throw new Error();

    const result = await response.json();
    catalog[id] = result.teams;
  } catch {
    if (el("teamLeague").value === id) {
      el("teamStatus").textContent =
        "Team list unavailable. Teams with published games remain selectable.";
    }
  } finally {
    catalogRequests.delete(id);

    if (el("teamLeague").value === id) {
      renderTeamChoices();
    }
  }
}

function togglePause() {
  if (!settingsPanel.classList.contains("hidden")) return;

  paused = !paused;
  clearTimeout(slideTimer);

  if (paused) {
    showPlayStateIcon("⏸", false);
  } else {
    showPlayStateIcon("▶", true);
    scheduleNextSlide();
  }
}

function showPlayStateIcon(icon, autoHide) {
  clearTimeout(iconTimer);

  playStateIcon.textContent = icon;
  playStateIcon.classList.remove("hidden");

  if (autoHide) {
    iconTimer = setTimeout(
      () => playStateIcon.classList.add("hidden"),
      1800
    );
  }
}

function openSettings() {
  clearTimeout(slideTimer);

  settingsPanel.classList.remove("hidden");
  settingsPanel.style.display = "flex";
  settingsPanel.style.visibility = "visible";
  settingsPanel.style.opacity = "1";
  settingsPanel.style.zIndex = "2147483647";

  populateSettingsUI();

  draftTeams = [...settings.teams];

  renderTeamChoices();
  loadTeamCatalog();
}

function closeSettings() {
  applyVisualSettings();

  settingsPanel.classList.add("hidden");
  settingsPanel.style.display = "none";

  if (!paused) {
    scheduleNextSlide();
  }
}

function populateSettingsUI() {
  document.querySelectorAll("[data-league]")
    .forEach(checkbox => {
      checkbox.checked =
        !!settings.leagues[checkbox.dataset.league];
    });

  backgroundColorInput.value = settings.backgroundColor;

  backgroundColorValue.textContent =
    settings.backgroundColor.toUpperCase();

  brightnessSlider.value = settings.brightness;
  brightnessValue.textContent = settings.brightness + "%";
  slideDuration.value = String(settings.slideDuration);
  buildNumber.textContent = BUILD_NUMBER;
}

function readSettingsFromUI() {
  const leagues = {};

  document.querySelectorAll("[data-league]")
    .forEach(checkbox => {
      leagues[checkbox.dataset.league] = checkbox.checked;
    });

  settings = {
    leagues,
    teams: [...draftTeams],
    backgroundColor: backgroundColorInput.value,
    brightness: Number(brightnessSlider.value),
    slideDuration: Number(slideDuration.value)
  };

  saveSettings();
  applyVisualSettings();

  if (data) {
    buildSlideQueue();
    showSlide(0);
  }
}

function getContrastTextColor(hex) {
  const value = hex.replace("#", "");

  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);

  const luminance =
    0.299 * r +
    0.587 * g +
    0.114 * b;

  return luminance > 160 ? "#111111" : "#ffffff";
}

function applyVisualSettings() {
  document.documentElement.style.setProperty(
    "--frame-background",
    settings.backgroundColor
  );

  document.documentElement.style.setProperty(
    "--frame-brightness",
    settings.brightness / 100
  );

  document.documentElement.style.setProperty(
    "--frame-text",
    getContrastTextColor(settings.backgroundColor)
  );
}

backgroundColorInput.addEventListener("input", () => {
  backgroundColorValue.textContent =
    backgroundColorInput.value.toUpperCase();

  document.documentElement.style.setProperty(
    "--frame-background",
    backgroundColorInput.value
  );

  document.documentElement.style.setProperty(
    "--frame-text",
    getContrastTextColor(backgroundColorInput.value)
  );
});

brightnessSlider.addEventListener("input", () => {
  brightnessValue.textContent = brightnessSlider.value + "%";
});

el("saveSettings").addEventListener("click", () => {
  readSettingsFromUI();
  closeSettings();
});

el("closeSettings").addEventListener("click", closeSettings);

el("resetSettings").addEventListener("click", () => {
  settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  draftTeams = [];

  saveSettings();
  applyVisualSettings();
  populateSettingsUI();
  renderTeamChoices();

  if (data) {
    buildSlideQueue();
    showSlide(0);
  }
});

function handleSettingsTouch(event) {
  if (!settingsPanel.classList.contains("hidden")) return;

  event.preventDefault();
  event.stopPropagation();

  openSettings();
}

settingsHotspot.addEventListener(
  "touchstart",
  handleSettingsTouch,
  { passive: false }
);

settingsHotspot.addEventListener(
  "pointerdown",
  handleSettingsTouch,
  true
);

settingsHotspot.addEventListener(
  "mousedown",
  handleSettingsTouch,
  true
);

settingsHotspot.addEventListener("click", event => {
  event.preventDefault();
  event.stopPropagation();
});

el("display").addEventListener("click", event => {
  if (event.target === settingsHotspot) return;
  togglePause();
});

document.addEventListener("contextmenu", event => {
  event.preventDefault();
});

el("leagueChoices").innerHTML = LEAGUES.map(([id, name]) => `
  <label class="toggle-row">
    <span>${escapeHTML(name)}</span>
    <input type="checkbox" data-league="${id}">
  </label>
`).join("");

el("teamLeague").innerHTML = LEAGUES.map(([id, name]) => `
  <option value="${id}">${escapeHTML(name)}</option>
`).join("");

el("teamLeague").onchange = () => {
  renderTeamChoices();
  loadTeamCatalog();
};

el("teamSearch").oninput = renderTeamChoices;

el("homeBuildNumber").textContent = "Build " + BUILD_NUMBER;
buildNumber.textContent = BUILD_NUMBER;

document.addEventListener("keydown", event => {
  if (
    event.key === "Escape" &&
    !settingsPanel.classList.contains("hidden")
  ) {
    closeSettings();
  }

  if (
    event.key.toLowerCase() === "s" &&
    !["INPUT", "SELECT"].includes(event.target.tagName)
  ) {
    openSettings();
  }
});

applyVisualSettings();
loadData();

setInterval(loadData, 60000);