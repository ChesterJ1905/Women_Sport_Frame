import { leagues, getJSON } from "./games.js";

export default async function handler(req, res) {
  const league = leagues.find(
    item =>
      item.id === req.query.league &&
      !item.college &&
      item.path
  );

  if (!league) {
    return res.status(400).json({
      error: "Standings are not connected for this competition."
    });
  }

  try {
    const data = await getJSON(
      "https://site.api.espn.com/apis/v2/sports/" +
      league.path +
      "/standings"
    );

    const rows = [];

    function walk(node) {
      for (const entry of node.standings?.entries || []) {
        function stat(...names) {
          return entry.stats?.find(
            item => names.includes(item.name)
          )?.displayValue ?? "—";
        }

        rows.push({
          name: entry.team?.displayName || "TBD",
          logo: entry.team?.logos?.[0]?.href || "",
          rank: stat("rank", "playoffSeed"),
          wins: stat("wins"),
          losses: stat("losses"),
          ties: stat("ties", "draws"),
          points: stat("points"),
          pct: stat("winPercent"),
          gb: stat("gamesBehind"),
          group: node.name || "Standings"
        });
      }

      for (const child of node.children || []) {
        walk(child);
      }
    }

    walk(data);

    res.setHeader(
      "Cache-Control",
      "s-maxage=600, stale-while-revalidate=1800"
    );

    return res.status(200).json({
      rows,
      updatedAt: new Date().toISOString()
    });
  } catch {
    return res.status(503).json({
      error: "Standings are temporarily unavailable."
    });
  }
}