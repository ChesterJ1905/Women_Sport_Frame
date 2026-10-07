import { leagues, getJSON } from "./games.js";

export default async function handler(req, res) {
  const league = leagues.find(
    item => item.id === req.query.league
  );

  if (!league) {
    return res.status(400).json({
      error: "Unknown league"
    });
  }

  if (!league.path && !league.paths) {
    return res.status(200).json({
      teams: []
    });
  }

  try {
    const paths = league.paths || [league.path];

    const results = await Promise.allSettled(
      paths.map(path =>
        getJSON(
          "https://site.api.espn.com/apis/site/v2/sports/" +
          path +
          "/teams?limit=1000"
        )
      )
    );

    const teams = new Map();

    for (const result of results) {
      if (result.status !== "fulfilled") continue;

      for (const sport of result.value.sports || []) {
        for (const competition of sport.leagues || []) {
          for (const entry of competition.teams || []) {
            const team = entry.team || entry;
            const name = team.displayName || team.name;

            if (!name) continue;

            teams.set(name, {
              key: league.id + "|" + name,
              league: league.id,
              name,
              short: team.abbreviation || "",
              logo: team.logos?.[0]?.href || ""
            });
          }
        }
      }
    }

    if (results.every(result => result.status === "rejected")) {
      throw new Error("Team catalog unavailable");
    }

    res.setHeader(
      "Cache-Control",
      "s-maxage=86400, stale-while-revalidate=86400"
    );

    return res.status(200).json({
      teams: [...teams.values()]
    });
  } catch {
    return res.status(503).json({
      error: "Team catalog unavailable"
    });
  }
}