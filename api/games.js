export const leagues = [
  {
    id: "wnba",
    name: "WNBA",
    sport: "Basketball",
    path: "basketball/wnba"
  },
  {
    id: "unrivaled",
    name: "Unrivaled",
    sport: "Basketball",
    env: "UNRIVALED_FEED_URL"
  },
  {
    id: "nwsl",
    name: "NWSL",
    sport: "Soccer",
    path: "soccer/usa.nwsl"
  },
  {
    id: "pwhl",
    name: "PWHL",
    sport: "Hockey",
    env: "PWHL_FEED_URL"
  },
  {
    id: "wsl",
    name: "Women’s Super League",
    sport: "Soccer",
    path: "soccer/eng.w.1"
  },
  {
    id: "uwcl",
    name: "Women’s Champions League",
    sport: "Soccer",
    path: "soccer/uefa.wchampions"
  },
  {
    id: "national",
    name: "National teams",
    sport: "Soccer",
    paths: [
      "soccer/fifa.friendly.w",
      "soccer/fifa.wwc",
      "soccer/uefa.weuro",
      "soccer/concacaf.w.gold"
    ]
  },
  {
    id: "march",
    name: "March Madness",
    sport: "Basketball",
    path: "basketball/womens-college-basketball",
    college: true
  },
  {
    id: "softball",
    name: "NCAA Softball",
    sport: "Softball",
    path: "baseball/college-softball",
    college: true
  },
  {
    id: "volleyball",
    name: "NCAA Volleyball",
    sport: "Volleyball",
    path: "volleyball/womens-college-volleyball",
    college: true
  },
  {
    id: "college-soccer",
    name: "NCAA Soccer",
    sport: "Soccer",
    path: "soccer/usa.ncaa.w.1",
    college: true
  },
  {
    id: "lacrosse",
    name: "NCAA Lacrosse",
    sport: "Lacrosse",
    path: "lacrosse/womens-college-lacrosse",
    college: true
  },
  {
    id: "college-hockey",
    name: "NCAA Hockey",
    sport: "Hockey",
    path: "hockey/womens-college-hockey",
    college: true
  },
  {
    id: "college-other",
    name: "Other NCAA championships",
    sport: "College",
    college: true,
    env: "NCAA_CHAMPIONSHIPS_FEED_URL"
  }
];

export async function getJSON(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(7500),
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(
      "Feed returned HTTP " + response.status
    );
  }

  return response.json();
}

export function isChampionship(event, league) {
  const competitions = event.competitions || [];

  const text = [
    event.name,
    event.season?.slug,
    ...competitions.flatMap(competition => [
      competition.type?.text,
      competition.type?.abbreviation,
      ...(competition.notes || []).map(
        note => note.headline
      )
    ])
  ]
    .filter(Boolean)
    .join(" ");

  if (league.id === "march") {
    return (
      /NCAA (Women.s )?(Tournament|Championship)|March Madness|Women.s (Final Four|NCAA Tournament)/i.test(text) &&
      !/NIT|conference tournament/i.test(text)
    );
  }

  return (
    /NCAA.*(Tournament|Championship)|College (World|Cup)|Women.s College World Series|WCWS|Frozen Four/i.test(text) &&
    !/conference tournament/i.test(text)
  );
}

export function normalize(event, league) {
  const competition = event.competitions?.[0];

  if (
    !competition ||
    competition.competitors?.length !== 2
  ) {
    return null;
  }

  if (
    league.college &&
    !isChampionship(event, league)
  ) {
    return null;
  }

  function getTeam(side) {
    const competitor = competition.competitors.find(
      item => item.homeAway === side
    );

    if (!competitor) return null;

    return {
      name:
        competitor.team?.displayName ||
        competitor.team?.name ||
        "TBD",

      short:
        competitor.team?.abbreviation ||
        "TBD",

      logo: competitor.team?.logo || "",

      score:
        competitor.score == null
          ? null
          : String(competitor.score)
    };
  }

  const home = getTeam("home");
  const away = getTeam("away");

  if (!home || !away) return null;

  const state =
    competition.status?.type ||
    event.status?.type ||
    {};

  const status = state.completed
    ? "final"
    : state.state === "in"
      ? "live"
      : state.name === "STATUS_POSTPONED"
        ? "postponed"
        : state.name === "STATUS_CANCELED"
          ? "cancelled"
          : "scheduled";

  return {
    id: league.id + "-" + event.id,
    league: league.id,
    leagueName: league.name,
    sport: league.sport,
    college: !!league.college,
    date: competition.date || event.date,
    home,
    away,
    status,
    detail: state.shortDetail || state.detail || "",

    round: (competition.notes || [])
      .map(note => note.headline)
      .join(" · "),

    broadcast: (competition.broadcasts || [])
      .flatMap(broadcast => broadcast.names || [])
      .join(", "),

    source: "ESPN",

    url:
      event.links?.find(link =>
        link.href?.startsWith("https://")
      )?.href || ""
  };
}

function customGames(data, league) {
  if (!Array.isArray(data.games)) {
    throw new Error("Invalid feed");
  }

  return data.games
    .filter(game =>
      game.id &&
      Number.isFinite(Date.parse(game.date)) &&
      game.home?.name &&
      game.away?.name &&
      [
        "live",
        "scheduled",
        "final",
        "postponed",
        "cancelled"
      ].includes(game.status) &&
      (
        !league.college ||
        (
          game.postseason === true &&
          (
            league.id !== "march" ||
            game.tournament === "NCAA"
          )
        )
      )
    )
    .map(game => ({
      ...game,
      id: league.id + "-" + game.id,
      league: league.id,
      leagueName: league.name,
      sport: league.sport,
      college: !!league.college,
      source: data.source || "Connected feed"
    }));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const now = new Date();
  const dayLength = 86400000;

  const start = new Date(
    now.getTime() - 3 * dayLength
  );

  const end = new Date(
    now.getTime() + 8 * dayLength
  );

  function dateKey(date) {
    return date
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", "");
  }

  const dates = Array.from(
    { length: 11 },
    (_, index) =>
      dateKey(
        new Date(
          now.getTime() + (index - 3) * dayLength
        )
      )
  );

  const results = await Promise.all(
    leagues.map(async league => {
      if (
        league.env &&
        !process.env[league.env]
      ) {
        return {
          league: league.id,
          status: "not-connected",
          games: []
        };
      }

      try {
        if (league.env) {
          const url = process.env[league.env];

          if (!url.startsWith("https://")) {
            throw new Error("Feed must use HTTPS");
          }

          const feed = await getJSON(url);

          return {
            league: league.id,
            status: "connected",
            games: customGames(feed, league)
          };
        }

        const paths = league.paths || [league.path];

        const feeds = await Promise.allSettled(
          paths.flatMap(path =>
            dates.map(date =>
              getJSON(
                "https://site.api.espn.com/apis/site/v2/sports/" +
                path +
                "/scoreboard?limit=200&dates=" +
                date
              )
            )
          )
        );

        const succeeded = feeds.filter(
          feed => feed.status === "fulfilled"
        );

        if (!succeeded.length) {
          const failure = feeds.find(
            feed => feed.status === "rejected"
          );

          throw new Error(
            failure?.reason?.message ||
            "No feed response"
          );
        }

        const games = succeeded.flatMap(feed =>
          (feed.value.events || [])
            .map(event => normalize(event, league))
            .filter(Boolean)
        );

        return {
          league: league.id,
          status:
            succeeded.length === feeds.length
              ? "connected"
              : "partial",
          games
        };
      } catch (error) {
        return {
          league: league.id,
          status: "unavailable",
          error: error.message || "Feed request failed",
          games: []
        };
      }
    })
  );

  const games = [
    ...new Map(
      results
        .flatMap(result => result.games)
        .filter(game =>
          Date.parse(game.date) >= start.getTime() &&
          Date.parse(game.date) <= end.getTime()
        )
        .map(game => [game.id, game])
    ).values()
  ].sort(
    (a, b) => Date.parse(a.date) - Date.parse(b.date)
  );

  res.setHeader(
    "Cache-Control",
    "s-maxage=45, stale-while-revalidate=90"
  );

  return res.status(200).json({
    updatedAt: now.toISOString(),
    games,

    coverage: results.map(
      ({ league, status, error }) => ({
        league,
        status,
        ...(error ? { error } : {})
      })
    ),

    leagues: leagues.map(
      ({ path, paths, env, ...league }) => league
    )
  });
}