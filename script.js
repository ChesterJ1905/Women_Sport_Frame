const BUILD_NUMBER = "2.03";

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
let standingsData = {};
let standingsFetching = false;

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
      ? escapeHTML(url)
      : "";
  } catch {
    return "";
  }
}

function leagueName(id) {
  return LEAGUES.find(([key]) => key === id)?.[1] || id;
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
    Date.parse(a.date) - Date.parse(b.date)
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

function addGameSlides(id, league, name, games, team) {
  if (!games.length) {
    slideQueue.push({
      id,
      league,
      name,
      team,
      games: []
    });
    return;
  }

  for (let i = 0; i < games.length; i += 3) {
    slideQueue.push({
      id: id + ":" + i,
      league,
      name,
      team,
      games: games.slice(i, i + 3),
      page: i / 3 + 1,
      pages: Math.ceil(games.length / 3)
    });
  }
}

function buildSlideQueue() {
  slideQueue = [];

  if (!data) return;

  const games = data.games.filter(game =>
    !["final", "cancelled"].includes(game.status)
  );

  for (const [id, name] of LEAGUES) {
    if (!settings.leagues[id]) continue;

    const leagueGames = games
      .filter(game => game.league === id)
      .sort(gameOrder);

    addGameSlides(id, id, name, leagueGames);
  }

  for (const key of settings.teams) {
    const team = allTeams().find(team => team.key === key);

    if (!team) continue;

    const teamGames = games
      .filter(game =>
        game.league === team.league &&
        (
          game.home.name === team.name ||
          game.away.name === team.name
        )
      )
      .sort(gameOrder);

    addGameSlides(
      key,
      team.league,
      team.name,
      teamGames,
      team
    );
  }

  for (const [league, table] of Object.entries(standingsData)) {
    if (
      !settings.leagues[league] ||
      !table.rows?.length
    ) continue;

    const groups = [
      ...new Set(
        table.rows.map(row => row.group || "Standings")
      )
    ];

    for (const group of groups) {
      const rows = table.rows.filter(row =>
        (row.group || "Standings") === group
      );

      for (let i = 0; i < rows.length; i += 7) {
        slideQueue.push({
          id: league + ":standings:" + group + ":" + i,
          league,
          name: leagueName(league),
          type: "standings",
          rows: rows.slice(i, i + 7),
          offset: i,
          group,
          updatedAt: table.updatedAt,
          page: i / 7 + 1,
          pages: Math.ceil(rows.length / 7)
        });
      }
    }
  }
}

function gameMarkup(game) {
  const status =
    game.status === "live"
      ? "LIVE · " + (game.detail || "In progress")
      : game.status === "scheduled"
        ? stamp(game.date, {
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short"
          })
        : game.status.toUpperCase();

  return `
    <article class="sports-game ${escapeHTML(game.status)}">
      <div class="game-label">
        <span>
          ${escapeHTML(stamp(game.date, {
            weekday: "short",
            month: "short",
            day: "numeric"
          }))}
        </span>

        <span class="game-status">
          ${escapeHTML(status)}
        </span>
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
            ${game.status === "live"
              ? escapeHTML(team.score ?? "—")
              : ""
            }
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

function tableMarkup(slide) {
  const soccer = ["nwsl", "wsl", "uwcl"].includes(
    slide.league
  );

  return `
    <table class="league-table">
      <thead>
        <tr>
          <th>Pos</th>
          <th>Team</th>
          <th>W</th>
          <th>L</th>
          ${soccer
            ? "<th>D</th><th>PTS</th>"
            : "<th>PCT</th><th>GB</th>"
          }
        </tr>
      </thead>

      <tbody>
        ${slide.rows.map((row, index) => {
          const rank =
            row.rank && row.rank !== "—"
              ? row.rank
              : slide.offset + index + 1;

          return `
            <tr>
              <td>${escapeHTML(rank)}</td>

              <td>
                ${image(row.logo)
                  ? `<img src="${image(row.logo)}" alt="">`
                  : ""
                }
                ${escapeHTML(row.name)}
              </td>

              <td>${escapeHTML(row.wins)}</td>
              <td>${escapeHTML(row.losses)}</td>

              ${soccer
                ? `
                  <td>${escapeHTML(row.ties)}</td>
                  <td>${escapeHTML(row.points)}</td>
                `
                : `
                  <td>${escapeHTML(row.pct)}</td>
                  <td>${escapeHTML(row.gb)}</td>
                `
              }
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function showSlide(index) {
  clearTimeout(slideTimer);

  if (!slideQueue.length) {
    slideRoot.innerHTML = `
      <div class="empty-slide">
        <div>
          <h1>Women’s Sports</h1>
          <p>Choose leagues or favorite teams in settings.</p>
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
    data.coverage?.find(
      item => item.league === slide.league
    )?.status || "unavailable";

  const college =
    data.leagues?.find(
      league => league.id === slide.league
    )?.college;

  const isTable = slide.type === "standings";

  const tournament =
    college ||
    slide.league === "uwcl" ||
    (slide.games || []).some(game =>
      /playoff|semifinal|quarterfinal|finals|round of/i.test(
        game.round || ""
      )
    );

  const label = isTable
    ? "CURRENT STANDINGS"
    : tournament
      ? "TOURNAMENT MATCHUPS"
      : "LIVE & UPCOMING";

  const emptyMessage =
    coverage === "not-connected"
      ? "This league’s feed is not connected yet."
      : coverage === "unavailable"
        ? "Scores are temporarily unavailable."
        : "No live or upcoming games listed.";

  const body = isTable
    ? tableMarkup(slide)
    : slide.games.length
      ? `
        <div class="schedule-grid">
          ${slide.games.map(gameMarkup).join("")}
        </div>
      `
      : `
        <div class="quiet-board">
          ${escapeHTML(emptyMessage)}
          <small>
            ${college ? "NCAA postseason only. " : ""}
            Finished games are hidden.
          </small>
        </div>
      `;

  slideRoot.innerHTML = `
    <section class="league-slide">
      <header class="league-header">
        <div>
          <p class="eyebrow">
            ${slide.team
              ? escapeHTML(leagueName(slide.league))
              : "WOMEN’S SPORTS"
            }
          </p>

          <h1>${escapeHTML(slide.name)}</h1>
        </div>

        <span class="league-date">
          ${escapeHTML(stamp(new Date(), {
            weekday: "long",
            month: "short",
            day: "numeric"
          }))}
        </span>
      </header>

      <div class="league-panel">
        <div class="panel-heading">
          <span>
            ${label}
            ${isTable ? " · " + escapeHTML(slide.group) : ""}
          </span>

          <span>
            ${slide.pages > 1
              ? slide.page + " / " + slide.pages
              : ""
            }
          </span>
        </div>

        ${body}

        <div class="feed-note">
          ${offline ? "Offline · Saved data from " : "Updated "}

          ${escapeHTML(stamp(
            slide.updatedAt || data.updatedAt,
            {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit"
            }
          ))}

          ${coverage === "partial" && !isTable
            ? " · Partial coverage"
            : ""
          }

          ${tournament && !isTable
            ? " · Published rounds; full bracket unavailable"
            : ""
          }
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

async function loadStandings() {
  if (standingsFetching) return;

  standingsFetching = true;

  await Promise.all(
    ["wnba", "nwsl", "wsl", "uwcl"].map(async league => {
      try {
        const response = await fetch(
          "/api/standings?league=" +
          encodeURIComponent(league)
        );

        if (!response.ok) return;

        const table = await response.json();

        if (Array.isArray(table.rows)) {
          standingsData[league] = table;
        }
      } catch {}
    })
  );

  standingsFetching = false;

  if (data) {
    const current = slideQueue[slideIndex]?.id;

    buildSlideQueue();

    showSlide(
      Math.max(
        0,
        slideQueue.findIndex(slide => slide.id === current)
      )
    );
  }
}

function renderCoverage() {
  el("coverageStatus").innerHTML =
    (data?.coverage || []).map(item =>
      escapeHTML(leagueName(item.league)) +
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
        data-team="${escapeHTML(team.key)}"
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

    catalog[id] = Array.isArray(result.teams)
      ? result.teams
      : [];
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
  brightnessValue.textContent =
    brightnessSlider.value + "%";
});

el("saveSettings").addEventListener("click", () => {
  readSettingsFromUI();
  closeSettings();
});

el("closeSettings").addEventListener(
  "click",
  closeSettings
);

el("resetSettings").addEventListener("click", () => {
  settings = JSON.parse(
    JSON.stringify(DEFAULT_SETTINGS)
  );

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

el("leagueChoices").innerHTML =
  LEAGUES.map(([id, name]) => `
    <label class="toggle-row">
      <span>${escapeHTML(name)}</span>
      <input type="checkbox" data-league="${id}">
    </label>
  `).join("");

el("teamLeague").innerHTML =
  LEAGUES.map(([id, name]) => `
    <option value="${id}">
      ${escapeHTML(name)}
    </option>
  `).join("");

el("teamLeague").onchange = () => {
  renderTeamChoices();
  loadTeamCatalog();
};

el("teamSearch").oninput = renderTeamChoices;

el("homeBuildNumber").textContent =
  "Build " + BUILD_NUMBER;

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
loadStandings();

setInterval(loadData, 60000);
setInterval(loadStandings, 600000);