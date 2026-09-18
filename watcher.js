const { chromium } = require("playwright");
const fs = require("fs");

// ======================================================
// ONLY CHANGE THESE SETTINGS WHEN YOU WANT A NEW SEARCH
// ======================================================

const SETTINGS = {
  date: "2026-09-26",
  earliest: "7:00 AM",
  latest: "11:00 AM",
  players: 4,

  courses: [
    {
      name: "Gambler Ridge Golf Club",
      url: "https://www.golfnow.com/courses/1033768-gambler-ridge-golf-club-details"
    },
    {
      name: "Hanover Golf Club",
      url: "https://www.golfnow.com/courses/1033778-hanover-golf-club-details"
    },
    {
      name: "Cream Ridge Golf Course",
      url: "https://www.golfnow.com/courses/1033740-cream-ridge-golf-course-details"
    },
    {
      name: "Old Bridge Golf Club",
      url: "https://www.golfnow.com/courses/-6680-old-bridge-golf-club-details"
    },
    {
      name: "Cedar Creek Golf Course",
      url: "https://www.golfnow.com/courses/1033730-cedar-creek-golf-course-details"
    },
    {
      name: "Mercer Oaks West Golf Course",
      url: "https://www.golfnow.com/courses/1041704-mercer-oaks-west-golf-course-details"
    }
  ]
};

// ======================================================

function timeToMinutes(value) {
  const m = String(value)
    .trim()
    .toUpperCase()
    .match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);

  if (!m) return null;

  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = m[3];

  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  return hour * 60 + minute;
}

function normalizeTime(value) {
  const m = String(value)
    .trim()
    .toUpperCase()
    .match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);

  if (!m) return null;

  return `${Number(m[1])}:${m[2]} ${m[3]}`;
}

function formatTargetDateForGolfNow(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);

  const dt = new Date(Date.UTC(y, m - 1, d));

  const weekday = dt.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC"
  });

  const month = dt.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC"
  });

  return `${weekday}, ${month} ${d}`;
}

function parseGolfNowHeadingDate(text) {
  const match = text.match(
    /Showing Tee Times for:[\s\S]*?\bon\s+([A-Z][a-z]{2}),\s+([A-Z][a-z]{2})\s+(\d{1,2})/i
  );

  if (!match) return null;

  const year = Number(SETTINGS.date.slice(0, 4));

  const parsed = new Date(
    `${match[2]} ${match[3]}, ${year} 12:00:00`
  );

  if (Number.isNaN(parsed.getTime())) return null;

  return {
    display: `${match[1]}, ${match[2]} ${Number(match[3])}`,
    date: parsed
  };
}

function targetDateObject() {
  const [y, m, d] = SETTINGS.date.split("-").map(Number);

  return new Date(
    y,
    m - 1,
    d,
    12,
    0,
    0
  );
}

function dayDifference(a, b) {
  const oneDay = 24 * 60 * 60 * 1000;

  const aa = new Date(
    a.getFullYear(),
    a.getMonth(),
    a.getDate()
  );

  const bb = new Date(
    b.getFullYear(),
    b.getMonth(),
    b.getDate()
  );

  return Math.round((bb - aa) / oneDay);
}

function normalizeGolfNowPrice(raw) {
  if (!raw) return null;

  const cleaned = raw.replace(/[^\d.]/g, "");

  if (!cleaned) return null;

  if (cleaned.includes(".")) {
    const value = Number(cleaned);

    return Number.isFinite(value)
      ? `$${value.toFixed(2)}`
      : null;
  }

  // GolfNow sometimes renders $89.00 as $8900 in extracted text.
  if (cleaned.length >= 3) {
    const cents = cleaned.slice(-2);
    const dollars = cleaned.slice(0, -2);

    return `$${Number(dollars)}.${cents}`;
  }

  return `$${Number(cleaned).toFixed(2)}`;
}

async function dismissPrivacy(page) {
  const names = [
    /^continue$/i,
    /^accept all$/i,
    /^accept$/i,
    /^agree$/i
  ];

  for (const name of names) {
    try {
      const button = page
        .getByRole("button", { name })
        .first();

      if (
        await button.count() &&
        await button.isVisible()
      ) {
        await button.click();
        await page.waitForTimeout(800);
        return;
      }
    } catch (_) {}
  }
}

async function getPageText(page) {
  return await page
    .locator("body")
    .innerText();
}

async function getDisplayedDate(page) {
  const body = await getPageText(page);

  return parseGolfNowHeadingDate(body);
}

async function tryNativeDateInputs(page) {
  const selectors = [
    'input[type="date"]',
    'input[name*="date" i]',
    'input[id*="date" i]'
  ];

  for (const selector of selectors) {
    const inputs = page.locator(selector);

    const count = Math.min(
      await inputs.count(),
      6
    );

    for (let i = 0; i < count; i++) {
      try {
        const input = inputs.nth(i);

        if (!(await input.isVisible())) {
          continue;
        }

        await input.fill(SETTINGS.date);
        await input.dispatchEvent("input");
        await input.dispatchEvent("change");

        await page.waitForTimeout(3000);

        const shown =
          await getDisplayedDate(page);

        if (
          shown &&
          shown.display ===
            formatTargetDateForGolfNow(SETTINGS.date)
        ) {
          return true;
        }
      } catch (_) {}
    }
  }

  return false;
}

async function tryTopDatePicker(page) {
  const target = targetDateObject();

  const targetDay = target.getDate();

  const longLabel =
    target.toLocaleDateString(
      "en-US",
      {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
      }
    );

  const monthDay =
    target.toLocaleDateString(
      "en-US",
      {
        month: "long",
        day: "numeric"
      }
    );

  const dateControlCandidates = [
    page.getByText(
      /^[A-Z]{3}\s+\d{1,2}$/
    ).first(),

    page.locator(
      'input[placeholder*="date" i]'
    ).first(),

    page.locator("button")
      .filter({
        hasText:
          /^[A-Z]{3}\s+\d{1,2}$/
      })
      .first()
  ];

  for (const control of dateControlCandidates) {
    try {
      if (
        !(await control.count()) ||
        !(await control.isVisible())
      ) {
        continue;
      }

      await control.click();
      await page.waitForTimeout(700);

      const exactDateSelectors = [
        `[data-date="${SETTINGS.date}"]`,
        `[datetime="${SETTINGS.date}"]`,
        `[aria-label*="${longLabel}" i]`,
        `[aria-label*="${monthDay}" i]`
      ];

      for (const selector of exactDateSelectors) {
        try {
          const candidate =
            page.locator(selector).first();

          if (
            await candidate.count() &&
            await candidate.isVisible()
          ) {
            await candidate.click();

            await page.waitForTimeout(2500);

            const search =
              page
                .getByRole(
                  "button",
                  { name: /^search$/i }
                )
                .first();

            if (
              await search.count() &&
              await search.isVisible()
            ) {
              await search.click();

              await page.waitForTimeout(3000);
            }

            const shown =
              await getDisplayedDate(page);

            if (
              shown &&
              shown.display ===
                formatTargetDateForGolfNow(
                  SETTINGS.date
                )
            ) {
              return true;
            }
          }
        } catch (_) {}
      }

      const calendars = page.locator(
        '[role="dialog"], [class*="calendar" i], [class*="datepicker" i], [class*="date-picker" i]'
      );

      const calCount = Math.min(
        await calendars.count(),
        5
      );

      for (let c = 0; c < calCount; c++) {
        const cal = calendars.nth(c);

        try {
          if (!(await cal.isVisible())) {
            continue;
          }

          const dayButton =
            cal
              .getByRole(
                "button",
                {
                  name:
                    new RegExp(
                      `^${targetDay}$`
                    )
                }
              )
              .last();

          if (
            await dayButton.count() &&
            await dayButton.isVisible()
          ) {
            await dayButton.click();

            await page.waitForTimeout(1000);

            const search =
              page
                .getByRole(
                  "button",
                  { name: /^search$/i }
                )
                .first();

            if (
              await search.count() &&
              await search.isVisible()
            ) {
              await search.click();
            }

            await page.waitForTimeout(3000);

            const shown =
              await getDisplayedDate(page);

            if (
              shown &&
              shown.display ===
                formatTargetDateForGolfNow(
                  SETTINGS.date
                )
            ) {
              return true;
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  return false;
}

async function clickDateArrow(
  page,
  direction
) {
  const shown =
    await getDisplayedDate(page);

  if (!shown) return false;

  const dateText =
    page
      .getByText(
        shown.display,
        { exact: true }
      )
      .first();

  if (!(await dateText.count())) {
    return false;
  }

  let container =
    dateText.locator("..");

  for (let level = 0; level < 4; level++) {
    try {
      const buttons =
        container.locator("button");

      const count =
        await buttons.count();

      if (count >= 2) {
        const button =
          direction === "next"
            ? buttons.nth(count - 1)
            : buttons.nth(0);

        if (await button.isVisible()) {
          await button.click();

          await page.waitForTimeout(2200);

          return true;
        }
      }

      const links =
        container.locator("a");

      const linkCount =
        await links.count();

      if (linkCount >= 2) {
        const link =
          direction === "next"
            ? links.nth(linkCount - 1)
            : links.nth(0);

        if (await link.isVisible()) {
          await link.click();

          await page.waitForTimeout(2200);

          return true;
        }
      }

      container =
        container.locator("..");
    } catch (_) {}
  }

  return false;
}

async function setGolfNowDate(page) {
  const target = targetDateObject();

  const wanted =
    formatTargetDateForGolfNow(
      SETTINGS.date
    );

  let shown =
    await getDisplayedDate(page);

  if (
    shown &&
    shown.display === wanted
  ) {
    return true;
  }

  if (
    await tryNativeDateInputs(page)
  ) {
    return true;
  }

  if (
    await tryTopDatePicker(page)
  ) {
    return true;
  }

  shown =
    await getDisplayedDate(page);

  if (!shown) {
    console.log(
      "Could not detect GolfNow's current date."
    );

    return false;
  }

  let diff =
    dayDifference(
      shown.date,
      target
    );

  if (Math.abs(diff) > 31) {
    console.log(
      "Target date is too far away."
    );

    return false;
  }

  console.log(
    `Moving tee sheet ${diff} day(s) to ${wanted}...`
  );

  let safety = 0;

  while (
    diff !== 0 &&
    safety < 35
  ) {
    const direction =
      diff > 0
        ? "next"
        : "previous";

    const clicked =
      await clickDateArrow(
        page,
        direction
      );

    if (!clicked) break;

    shown =
      await getDisplayedDate(page);

    if (!shown) break;

    diff =
      dayDifference(
        shown.date,
        target
      );

    safety++;
  }

  shown =
    await getDisplayedDate(page);

  return Boolean(
    shown &&
    shown.display === wanted
  );
}

function parseTeeTimesFromBody(bodyText) {
  const lines =
    bodyText
      .split(/\r?\n/)
      .map(line =>
        line
          .replace(/\u00a0/g, " ")
          .trim()
      )
      .filter(Boolean);

  const earliest =
    timeToMinutes(
      SETTINGS.earliest
    );

  const latest =
    timeToMinutes(
      SETTINGS.latest
    );

  const timeLineRegex =
    /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

  const rawTimes = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const match =
      lines[i].match(
        timeLineRegex
      );

    if (!match) continue;

    const time =
      normalizeTime(
        lines[i]
      );

    const minutes =
      timeToMinutes(time);

    const block = [];

    for (
      let j = i + 1;
      j < lines.length &&
      j < i + 12;
      j++
    ) {
      if (
        timeLineRegex.test(
          lines[j]
        )
      ) {
        break;
      }

      if (
        /^More Hot Deals$/i.test(
          lines[j]
        ) ||
        /Tee Times at .* Golf/i.test(
          lines[j]
        )
      ) {
        break;
      }

      block.push(lines[j]);
    }

    const blockText =
      block.join(" | ");

    if (/SOLD/i.test(blockText)) {
      continue;
    }

    const priceMatch =
      blockText.match(
        /\$\s*[\d.,]+/
      );

    const pricePerPerson =
      normalizeGolfNowPrice(
        priceMatch
          ? priceMatch[0]
          : null
      );

    const detailMatch =
      blockText.match(
        /\b(9|18)\s*\/\s*(\d)(?:\s*-\s*(\d))?\b/
      );

    let holes = null;
    let minGolfers = null;
    let maxGolfers = null;

    if (detailMatch) {
      holes =
        Number(
          detailMatch[1]
        );

      minGolfers =
        Number(
          detailMatch[2]
        );

      maxGolfers =
        Number(
          detailMatch[3] ||
          detailMatch[2]
        );
    }

    const inWindow =
      minutes !== null &&
      earliest !== null &&
      latest !== null &&
      minutes >= earliest &&
      minutes <= latest;

    const enoughGolfers =
      maxGolfers !== null &&
      SETTINGS.players >=
        minGolfers &&
      SETTINGS.players <=
        maxGolfers;

    if (
      inWindow &&
      enoughGolfers &&
      pricePerPerson &&
      detailMatch
    ) {
      rawTimes.push({
        time,
        pricePerPerson,
        minGolfers,
        maxGolfers,
        holes,
        context: blockText
      });
    }
  }

  const seen =
    new Set();

  return rawTimes.filter(
    tee => {
      const key =
        `${tee.time}|${tee.pricePerPerson}|${tee.maxGolfers}|${tee.holes}`;

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);

      return true;
    }
  );
}

async function checkCourse(
  browser,
  course
) {
  console.log("");
  console.log(
    "=================================="
  );
  console.log(course.name);
  console.log(
    "=================================="
  );

  const context =
    await browser.newContext({
      viewport: {
        width: 1440,
        height: 1000
      },

      locale: "en-US",

      timezoneId:
        "America/New_York"
    });

  const page =
    await context.newPage();

  try {
    console.log(
      "Opening GolfNow..."
    );

    await page.goto(
      course.url,
      {
        waitUntil:
          "domcontentloaded",
        timeout: 60000
      }
    );

    await page.waitForTimeout(
      5000
    );

    await dismissPrivacy(
      page
    );

    const dateWorked =
      await setGolfNowDate(
        page
      );

    if (!dateWorked) {
      console.log(
        `ERROR: GolfNow did not switch to ${SETTINGS.date}.`
      );

      console.log(
        "This course will not be reported to avoid false alerts."
      );
    } else {
      console.log(
        "Confirmed date:",
        formatTargetDateForGolfNow(
          SETTINGS.date
        )
      );
    }

    await page.waitForTimeout(
      2500
    );

    const body =
      await getPageText(
        page
      );

    const safeName =
      course.name
        .replace(
          /[^a-z0-9]/gi,
          "_"
        )
        .toLowerCase();

    await page.screenshot({
      path:
        `${safeName}.png`,
      fullPage: true
    });

    fs.writeFileSync(
      `${safeName}.txt`,
      body,
      "utf8"
    );

    if (!dateWorked) {
      return {
        course:
          course.name,
        url:
          page.url(),
        dateConfirmed:
          false,
        matches: []
      };
    }

    const matches =
      parseTeeTimesFromBody(
        body
      );

    if (!matches.length) {
      console.log(
        `No available tee times for ${SETTINGS.players} golfer(s) between ${SETTINGS.earliest} and ${SETTINGS.latest}.`
      );
    } else {
      console.log(
        `FOUND ${matches.length} qualifying tee time(s):`
      );

      for (
        const tee of matches
      ) {
        console.log(
          `⛳ ${tee.time} | ${tee.pricePerPerson} per person | ${tee.holes} holes | golfers ${tee.minGolfers}-${tee.maxGolfers}`
        );
      }
    }

    return {
      course:
        course.name,

      url:
        page.url(),

      dateConfirmed:
        true,

      matches
    };
  } catch (error) {
    console.log(
      "ERROR:",
      error.message
    );

    return {
      course:
        course.name,

      url:
        course.url,

      dateConfirmed:
        false,

      error:
        error.message,

      matches: []
    };
  } finally {
    await context.close();
  }
}

async function main() {
  console.log("");
  console.log(
    "GOLF TEE TIME WATCHER"
  );
  console.log("");

  console.log(
    "Date:",
    SETTINGS.date
  );

  console.log(
    "Time:",
    SETTINGS.earliest,
    "-",
    SETTINGS.latest
  );

  console.log(
    "Golfers:",
    SETTINGS.players
  );

  console.log(
    "Courses:",
    SETTINGS.courses.length
  );

  const browser =
    await chromium.launch({
      headless: true
    });

  const courseResults =
    [];

  try {
    for (
      const course of SETTINGS.courses
    ) {
      courseResults.push(
        await checkCourse(
          browser,
          course
        )
      );
    }
  } finally {
    await browser.close();
  }

  const allMatches =
    courseResults.flatMap(
      result =>
        result.matches.map(
          match => ({
            course:
              result.course,

            bookingUrl:
              result.url,

            date:
              SETTINGS.date,

            ...match
          })
        )
    );

  console.log("");
  console.log(
    "=================================="
  );
  console.log(
    "FINAL RESULTS"
  );
  console.log(
    "=================================="
  );

  if (!allMatches.length) {
    console.log(
      "No qualifying available tee times detected."
    );
  } else {
    for (
      const tee of allMatches
    ) {
      console.log(
        `${tee.course} | ${tee.time} | ${tee.pricePerPerson} per person | ${tee.holes} holes | golfers ${tee.minGolfers}-${tee.maxGolfers}`
      );
    }
  }

  const output = {
    checkedAt:
      new Date().toISOString(),

    settings:
      SETTINGS,

    courses:
      courseResults,

    matches:
      allMatches
  };

  fs.writeFileSync(
    "results.json",
    JSON.stringify(
      output,
      null,
      2
    ),
    "utf8"
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
