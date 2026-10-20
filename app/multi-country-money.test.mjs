import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(path.join(tmpdir(), "tripboogie-currencies-"));
test.after(() => rm(dir, { recursive: true, force: true }));
for (const name of [
  "money",
  "countries",
  "trip-destinations",
  "pdf-preview-support",
]) {
  const source = (
    await readFile(new URL("./" + name + ".ts", import.meta.url), "utf8")
  ).replaceAll('"./countries"', '"./countries.mjs"');
  await writeFile(
    path.join(dir, name + ".mjs"),
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText,
  );
}
const { paidExpenseTotals, expenseBaseTotal, recordedRate, convert } =
    await import(pathToFileURL(path.join(dir, "money.mjs"))),
  { tripCurrencies, tripCountries, countryGroups, currencyForDate } =
    await import(pathToFileURL(path.join(dir, "trip-destinations.mjs")));
const expense = (
  tripCurrency,
  baseCurrency,
  paidCurrency,
  tripAmount,
  baseAmount,
) => ({
  data: {
    model: 2,
    tripCurrency,
    baseCurrency,
    paidCurrency,
    tripAmount,
    baseAmount,
    exchangeRate: 10,
  },
});
test("currency rows contain only actual tender amounts while the heading sums saved counterparts", () => {
  const rows = [
    expense("JPY", "KRW", "JPY", "2", "20"),
    expense("NZD", "KRW", "KRW", "0.04", "30"),
    expense("NZD", "KRW", "NZD", "5", "4000"),
  ];
  assert.deepEqual(paidExpenseTotals(rows, "NZD"), [
    { currency: "JPY", amount: "2" },
    { currency: "KRW", amount: "30" },
    { currency: "NZD", amount: "5" },
  ]);
  assert.deepEqual(expenseBaseTotal(rows, "KRW"), {
    amount: "4050",
    missing: [],
    live: false,
  });
  assert.equal(
    expenseBaseTotal([expense("JPY", "KRW", "JPY", "2", "23")], "KRW").amount,
    "23",
  );
});
test("missing historical base amounts never appear as zero and can convert through the saved former base", () => {
  const rows = [expense("JPY", "USD", "JPY", "2", "0.015")];
  assert.deepEqual(expenseBaseTotal(rows, "KRW").missing, ["USD"]);
  assert.deepEqual(expenseBaseTotal(rows, "KRW", { USD: "1400" }), {
    amount: "21",
    missing: [],
    live: true,
  });
  assert.equal(recordedRate("2", "20"), "10");
  assert.equal(convert("2", "10"), "20");
});
test("countries without cities derive all legal tender choices, deduplicate and retain old trips", () => {
  const trip = {
    currency: "JPY",
    settings: { countries: ["NZ", "JP", "BT"], cities: [] },
  };
  assert.deepEqual(tripCurrencies(trip), ["NZD", "JPY", "BTN", "INR"]);
  assert.deepEqual(tripCurrencies({ currency: "JPY", settings: {} }), ["JPY"]);
  assert.deepEqual(tripCountries(trip), ["NZ", "JP", "BT"]);
});
test("date and selected country choose the local currency without a transit stop taking priority", () => {
  const cities = [
      {
        id: "a",
        name: "환승",
        countryCode: "JP",
        currency: "JPY",
        startDate: "2026-11-01",
        endDate: "2026-11-05",
        transit: true,
      },
      {
        id: "b",
        name: "오클랜드",
        countryCode: "NZ",
        currency: "NZD",
        startDate: "2026-11-01",
        endDate: "2026-11-05",
      },
    ],
    trip = { currency: "JPY", settings: { cities } };
  assert.equal(currencyForDate(trip, "2026-11-02"), "NZD");
  assert.equal(currencyForDate(trip, "2026-11-02", "JP"), "JPY");
  assert.deepEqual(
    countryGroups(cities).map((g) => [g.code, g.cities.map((c) => c.name)]),
    [
      ["JP", ["환승"]],
      ["NZ", ["오클랜드"]],
    ],
  );
});

const { pdfBrowserError } = await import(
  pathToFileURL(path.join(dir, "pdf-preview-support.mjs"))
);
test("unsupported PDF browser versions explain the required update instead of an endless loader", () => {
  assert.match(pdfBrowserError("Android Chrome/113.0.0 Mobile"), /업데이트/);
  assert.equal(pdfBrowserError("Android Chrome/125.0.0 Mobile"), null);
  assert.match(
    pdfBrowserError(
      "iPhone; CPU iPhone OS 17_5 like Mac OS X AppleWebKit Safari/605.1",
    ),
    /업데이트/,
  );
  assert.equal(
    pdfBrowserError(
      "iPhone; CPU iPhone OS 18_1 like Mac OS X AppleWebKit Safari/605.1",
    ),
    null,
  );
  assert.match(
    pdfBrowserError("Macintosh Version/17.0 Safari/605.1"),
    /업데이트/,
  );
  assert.equal(pdfBrowserError("Macintosh Version/18.0 Safari/605.1"), null);
});
