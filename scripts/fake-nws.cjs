/* Stand-in for api.weather.gov in end-to-end runs: node scripts/fake-nws.cjs 9200
 * Phoenix-like site (America/Phoenix, UTC-7). Every day: 9 hourly observations 14:00Z–22:00Z, temps 15→31 °C,
 * wind 16 km/h, gust 56 km/h at 20:00Z (35 mph), 3 mm rain at 18:00Z. POST /__mode {"mode":"error"|"ok"} switches to 500s. */
const http = require("http");
const port = Number(process.argv[2] || 9200);
let mode = "ok";
const base = `http://127.0.0.1:${port}`;
const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/geo+json" });
  res.end(JSON.stringify(body));
};
const day = d => d.toISOString().slice(0, 10);
http
  .createServer((req, res) => {
    const u = new URL(req.url, base);
    if (req.method === "POST" && u.pathname === "/__mode") {
      let b = "";
      req.on("data", c => (b += c));
      req.on("end", () => {
        mode = JSON.parse(b || "{}").mode || "ok";
        json(res, 200, { mode });
      });
      return;
    }
    if (mode === "error") return json(res, 500, { title: "Unexpected Problem" });
    if (u.pathname.startsWith("/points/"))
      return json(res, 200, {
        properties: { timeZone: "America/Phoenix", forecastHourly: `${base}/gridpoints/PSR/1,1/forecast/hourly`, observationStations: `${base}/gridpoints/PSR/1,1/stations` },
      });
    if (u.pathname.endsWith("/stations")) return json(res, 200, { features: [{ properties: { stationIdentifier: "KFAK" } }] });
    if (u.pathname.startsWith("/stations/KFAK/observations")) {
      const start = new Date(u.searchParams.get("start"));
      const end = new Date(u.searchParams.get("end"));
      const features = [];
      for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
        for (let h = 14; h <= 22; h++) {
          const ts = new Date(`${day(d)}T${String(h).padStart(2, "0")}:00:00Z`);
          if (ts > new Date()) continue;
          features.push({
            properties: {
              timestamp: ts.toISOString(),
              textDescription: h === 18 ? "Light Rain" : "Partly Cloudy",
              temperature: { unitCode: "wmoUnit:degC", value: 15 + (h - 14) * 2 },
              windSpeed: { unitCode: "wmoUnit:km_h-1", value: 16 },
              windGust: { unitCode: "wmoUnit:km_h-1", value: h === 20 ? 56 : null },
              precipitationLastHour: { unitCode: "wmoUnit:mm", value: h === 18 ? 3 : 0 },
            },
          });
        }
      }
      return json(res, 200, { features });
    }
    if (u.pathname.endsWith("/forecast/hourly")) {
      const periods = [];
      const now = new Date();
      for (let i = 0; i < 24 * 7; i++) {
        const t = new Date(now.getTime() + i * 3600e3 - 7 * 3600e3); // shift to UTC-7 wall clock
        const local = t.toISOString().slice(0, 13);
        periods.push({ startTime: `${local}:00:00-07:00`, temperature: 70, temperatureUnit: "F", windSpeed: "10 to 22 mph", windGust: null, probabilityOfPrecipitation: { value: 20 }, shortForecast: "Breezy" });
      }
      return json(res, 200, { properties: { periods } });
    }
    json(res, 404, { title: "Not Found" });
  })
  .listen(port, () => console.log(`fake NWS on ${port}`));
