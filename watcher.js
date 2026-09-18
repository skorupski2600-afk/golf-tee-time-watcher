const { chromium } = require("playwright");
const fs = require("fs");

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
// TIME HELPERS
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

// ======================================================
// DATE HELPERS
// ======================================================

function targetDateObject() {
  const [year, month, day] = SETTINGS.date.split("-").map(Number);

  return new Date(
    year,
    month - 1,
    day,
    12,
    0,
    0
  );
}

function expectedDateText() {
  const d = targetDateObject();

  const weekday = d.toLocaleDateString("en-US", {
    weekday: "short"
  });

  const month = d.toLocaleDateString("en-US", {
    month: "short"
  });

  return `${weekday}, ${month} ${d.getDate()}`;
}

function parseDisplayedDate(text) {
  const match = text.match(
    /Showing\s+(?:Hot Deals|Tee Times)\s+for:[\s\S]*?\bon\s+([A-Z][a-z]{2}),\s+([A-Z][a-z]{2})\s+(\d{1,2})/i
  );

  if (!match) return null;

  return `${match[1]}, ${match[2]} ${Number(match[3])}`;
}

function parsedDisplayedDateObject(text) {
  const match = text.match(
    /Showing\s+(?:Hot Deals|Tee Times)\s+for:[\s\S]*?\bon\s+([A-Z][a-z]{2}),\s+([A-Z][a-z]{2})\s+(\d{1,2})/i
  );

  if (!match) return null;

  const targetYear = targetDateObject().getFullYear();

  const parsed = new Date(
    `${match[2]} ${match[3]}, ${targetYear} 12:00:00`
  );

  return Number.isNaN(parsed.getTime())
    ? null
    : parsed;
}

function dayDifference(fromDate, toDate) {
  const a = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    fromDate.getDate()
  );

  const b = new Date(
    toDate.getFullYear(),
    toDate.getMonth(),
    toDate.getDate()
  );

  return Math.round(
    (b - a) / (24 * 60 * 60 * 1000)
  );
}

// ======================================================
// BASIC PAGE HELPERS
// ======================================================

async function getPageText(page) {
  return await page.locator("body").innerText();
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
      const button = page.getByRole("button", { name }).first();

      if (
        await button.count() &&
        await button.isVisible()
      ) {
        await button.click();
        await page.waitForTimeout(700);
        return;
      }
    } catch (_) {}
  }
}

// ======================================================
// READ CURRENT DATE
// ======================================================

async function getDisplayedDate(page) {
  const text = await getPageText(page);
  return parseDisplayedDate(text);
}

async function getDisplayedDateObject(page) {
  const text = await getPageText(page);
  return parsedDisplayedDateObject(text);
}

// ======================================================
// FIND DATE NAVIGATION ROW
// ======================================================

async function findDateNavigationContainer(page) {
  const currentText = await getDisplayedDate(page);

  if (!currentText) {
    console.log("  Could not detect current GolfNow tee-sheet date.");
    return null;
  }

  console.log(`  Current GolfNow date: ${currentText}`);

  const dateLabel = page.getByText(
    currentText,
    { exact: true }
  ).first();

  if (!(await dateLabel.count())) {
    console.log("  Could not find current date label on page.");
    return null;
  }

  let container = dateLabel.locator("..");

  for (let level = 0; level < 6; level++) {
    try {
      const clickable = container.locator(
        'button, a, [role="button"]'
      );

      const count = await clickable.count();

      if (count >= 2) {
        console.log(
          `  Found date navigation container with ${count} clickable control(s).`
        );

        return container;
      }

      container = container.locator("..");

    } catch (_) {}
  }

  console.log("  Could not find date-arrow controls.");
  return null;
}

// ======================================================
// CLICK LEFT / RIGHT DATE ARROW
// ======================================================

async function clickDateArrow(page, direction) {
  const beforeText = await getDisplayedDate(page);

  if (!beforeText) {
    return false;
  }

  const beforeDate = await getDisplayedDateObject(page);

  if (!beforeDate) {
    return false;
  }

  const container = await findDateNavigationContainer(page);

  if (!container) {
    return false;
  }

  const clickable = container.locator(
    'button, a, [role="button"]'
  );

  const count = await clickable.count();

  if (count < 2) {
    return false;
  }

  const candidates = [];

  for (let i = 0; i < count; i++) {
    try {
      const item = clickable.nth(i);

      if (!(await item.isVisible())) {
        continue;
      }

      const aria = await item.getAttribute("aria-label");
      const title = await item.getAttribute("title");
      const text = await item.innerText().catch(() => "");

      candidates.push({
        item,
        aria: aria || "",
        title: title || "",
        text: text || "",
        index: i
      });
    } catch (_) {}
  }

  let chosen = null;

  /*
    Prefer explicit previous/next labels if GolfNow exposes them.
  */

  for (const candidate of candidates) {
    const label =
      `${candidate.aria} ${candidate.title} ${candidate.text}`.toLowerCase();

    if (
      direction === "next" &&
      /(next|right|forward)/i.test(label)
    ) {
      chosen = candidate.item;
      break;
    }

    if (
      direction === "previous" &&
      /(previous|prev|left|back)/i.test(label)
    ) {
      chosen = candidate.item;
      break;
    }
  }

  /*
    Fallback:
    first control = previous
    last control = next
  */

  if (!chosen) {
    chosen =
      direction === "next"
        ? candidates[candidates.length - 1]?.item
        : candidates[0]?.item;
  }

  if (!chosen) {
    return false;
  }

  console.log(
    `  Clicking ${direction} date arrow...`
  );

  try {
    await chosen.click({
      force: true,
      timeout: 4000
    });
  } catch (error) {
    console.log(
      `  Date-arrow click failed: ${error.message}`
    );

    return false;
  }

  /*
    Wait until GolfNow's date actually changes.
  */

  const deadline = Date.now() + 7000;

  while (Date.now() < deadline) {
    await page.waitForTimeout(500);

    const afterText = await getDisplayedDate(page);

    if (
      afterText &&
      afterText !== beforeText
    ) {
      console.log(
        `  Date changed: ${beforeText} -> ${afterText}`
      );

      return true;
    }
  }

  console.log(
    "  Arrow was clicked but the displayed date did not change."
  );

  return false;
}

// ======================================================
// MOVE COURSE PAGE TO TARGET DATE
// ======================================================

async function setCourseDateWithArrows(page) {
  const target = targetDateObject();

  let current = await getDisplayedDateObject(page);

  if (!current) {
    return false;
  }

  let diff = dayDifference(
    current,
    target
  );

  console.log(
    `  Need to move ${diff} day(s) to ${expectedDateText()}.`
  );

  if (diff === 0) {
    console.log(
      "  Correct date is already loaded."
    );

    return true;
  }

  if (Math.abs(diff) > 31) {
    console.log(
      "  Requested date is more than 31 days from the displayed date."
    );

    return false;
  }

  let safety = 0;

  while (
    diff !== 0 &&
    safety < 35
  ) {
    const direction =
      diff > 0
        ? "next"
        : "previous";

    const moved = await clickDateArrow(
      page,
      direction
    );

    if (!moved) {
      console.log(
        "  Could not advance GolfNow's date."
      );

      return false;
    }

    await page.waitForTimeout(
      1200
    );

    current = await getDisplayedDateObject(page);

    if (!current) {
      return false;
    }

    diff = dayDifference(
      current,
      target
    );

    safety++;
  }

  const finalText = await getDisplayedDate(page);

  const success =
    finalText === expectedDateText();

  console.log(
    `  Final GolfNow date: ${finalText || "not detected"}`
  );

  if (success) {
    console.log(
      `  SUCCESS: reached ${expectedDateText()}.`
    );
  } else {
    console.log(
      `  FAILED: wanted ${expectedDateText()}.`
    );
  }

  return success;
}

// ======================================================
// PRICE
// ======================================================

function normalizePrice(raw) {
  if (!raw) return null;

  const cleaned = raw.replace(
    /[^\d.]/g,
    ""
  );

  if (!cleaned) return null;

  if (cleaned.includes(".")) {
    const n = Number(cleaned);

    return Number.isFinite(n)
      ? `$${n.toFixed(2)}`
      : null;
  }

  /*
    GolfNow can expose superscript cents as:
    $7900 instead of $79.00
  */

  if (cleaned.length >= 3) {
    const dollars = cleaned.slice(0, -2);
    const cents = cleaned.slice(-2);

    return `$${Number(dollars)}.${cents}`;
  }

  return `$${Number(cleaned).toFixed(2)}`;
}

// ======================================================
// TEE TIME PARSER
// ======================================================

function parseTeeTimes(text) {
  const lines = text
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

  const timeRegex =
    /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

  const matches = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    if (!timeRegex.test(lines[i])) {
      continue;
    }

    const teeTime =
      normalizeTime(lines[i]);

    const teeMinutes =
      timeToMinutes(teeTime);

    if (
      teeMinutes === null ||
      teeMinutes < earliest ||
      teeMinutes > latest
    ) {
      continue;
    }

    const detailLines = [];

    for (
      let j = i + 1;
      j < lines.length &&
      j <= i + 16;
      j++
    ) {
      if (timeRegex.test(lines[j])) {
        break;
      }

      if (
        /^(More|More Hot Deals|Tee Details)$/i.test(
          lines[j]
        )
      ) {
        break;
      }

      detailLines.push(
        lines[j]
      );
    }

    const details =
      detailLines.join(" | ");

    /*
      Ignore sold-out slots.
    */

    if (/\bSOLD\b/i.test(details)) {
      continue;
    }

    /*
      GolfNow examples from your earlier results:
      18 / 1-4
      18 / 1-2
    */

    const playerMatch =
      details.match(
        /\b(9|18)\s*\/\s*(\d)(?:\s*-\s*(\d))?\b/
      );

    if (!playerMatch) {
      continue;
    }

    const holes =
      Number(playerMatch[1]);

    const minGolfers =
      Number(playerMatch[2]);

    const maxGolfers =
      Number(
        playerMatch[3] ||
        playerMatch[2]
      );

    if (
      SETTINGS.players < minGolfers ||
      SETTINGS.players > maxGolfers
    ) {
      continue;
    }

    const priceMatch =
      details.match(
        /\$\s*[\d.,]+/
      );

    const pricePerPerson =
      normalizePrice(
        priceMatch
          ? priceMatch[0]
          : null
      );

    if (!pricePerPerson) {
      continue;
    }

    matches.push({
      time: teeTime,
      pricePerPerson,
      holes,
      minGolfers,
      maxGolfers,
      context: details
    });
  }

  const seen =
    new Set();

  return matches.filter(
    tee => {
      const key =
        `${tee.time}|${tee.pricePerPerson}|${tee.holes}|${tee.maxGolfers}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    }
  );
}

// ======================================================
// CHECK ONE COURSE
// ======================================================

async function checkCourse(
  browser,
  course
) {
  console.log("");
  console.log(
    "========================================"
  );
  console.log(course.name);
  console.log(
    "========================================"
  );

  const context =
    await browser.newContext({
      viewport: {
        width: 1440,
        height: 1100
      },

      locale: "en-US",

      timezoneId:
        "America/New_York"
    });

  const page =
    await context.newPage();

  const safeName =
    course.name
      .replace(
        /[^a-z0-9]/gi,
        "_"
      )
      .toLowerCase();

  try {
    console.log(
      "  Opening GolfNow course page..."
    );

    await page.goto(
      course.url,
      {
        waitUntil:
          "domcontentloaded",

        timeout:
          60000
      }
    );

    await page.waitForTimeout(
      5000
    );

    await dismissPrivacy(
      page
    );

    const dateConfirmed =
      await setCourseDateWithArrows(
        page
      );

    await page.waitForTimeout(
      2000
    );

    const text =
      await getPageText(
        page
      );

    await page.screenshot({
      path:
        `${safeName}.png`,

      fullPage:
        true
    });

    fs.writeFileSync(
      `${safeName}.txt`,
      text,
      "utf8"
    );

    /*
      Safety:
      never report tee times unless the
      requested date is confirmed.
    */

    if (!dateConfirmed) {
      console.log(
        "  DATE NOT CONFIRMED."
      );

      console.log(
        "  Ignoring this course to prevent false alerts."
      );

      return {
        course:
          course.name,

        url:
          page.url(),

        dateConfirmed:
          false,

        matches:
          []
      };
    }

    /*
      Extra protection against generic search pages.
    */

    if (
      page.url().includes(
        "/tee-times/search"
      )
    ) {
      console.log(
        "  Generic GolfNow search page detected."
      );

      console.log(
        "  Ignoring this course."
      );

      return {
        course:
          course.name,

        url:
          page.url(),

        dateConfirmed:
          false,

        matches:
          []
      };
    }

    const matches =
      parseTeeTimes(
        text
      );

    if (!matches.length) {
      console.log(
        `  No available tee times for ${SETTINGS.players} golfers between ${SETTINGS.earliest} and ${SETTINGS.latest}.`
      );

    } else {
      console.log(
        `  FOUND ${matches.length} qualifying tee time(s):`
      );

      for (const tee of matches) {
        console.log(
          `  ⛳ ${tee.time} | ${tee.pricePerPerson} per person | ${tee.holes} holes | golfers ${tee.minGolfers}-${tee.maxGolfers}`
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
      "  ERROR:",
      error.message
    );

    try {
      const text =
        await getPageText(
          page
        );

      fs.writeFileSync(
        `${safeName}.txt`,
        text,
        "utf8"
      );

      await page.screenshot({
        path:
          `${safeName}.png`,

        fullPage:
          true
      });

    } catch (_) {}

    return {
      course:
        course.name,

      url:
        page.url() ||
        course.url,

      dateConfirmed:
        false,

      error:
        error.message,

      matches:
        []
    };

  } finally {
    await context.close();
  }
}

// ======================================================
// MAIN
// ======================================================

async function main() {
  console.log("");
  console.log(
    "========================================"
  );
  console.log(
    "GOLF TEE TIME WATCHER"
  );
  console.log(
    "========================================"
  );

  console.log(
    `Date:    ${SETTINGS.date}`
  );

  console.log(
    `Time:    ${SETTINGS.earliest} - ${SETTINGS.latest}`
  );

  console.log(
    `Golfers: ${SETTINGS.players}`
  );

  console.log(
    `Courses: ${SETTINGS.courses.length}`
  );

  const browser =
    await chromium.launch({
      headless: true
    });

  const courseResults = [];

  try {
    for (
      const course of SETTINGS.courses
    ) {
      const result =
        await checkCourse(
          browser,
          course
        );

      courseResults.push(
        result
      );
    }

  } finally {
    await browser.close();
  }

  const matches =
    courseResults.flatMap(
      result =>
        result.matches.map(
          tee => ({
            course:
              result.course,

            date:
              SETTINGS.date,

            bookingUrl:
              result.url,

            ...tee
          })
        )
    );

  console.log("");
  console.log(
    "========================================"
  );
  console.log(
    "FINAL RESULTS"
  );
  console.log(
    "========================================"
  );

  if (!matches.length) {
    console.log(
      "No qualifying available tee times detected."
    );

  } else {
    for (const tee of matches) {
      console.log("");

      console.log(
        `⛳ ${tee.course}`
      );

      console.log(
        `   ${tee.date} at ${tee.time}`
      );

      console.log(
        `   ${tee.pricePerPerson} per person`
      );

      console.log(
        `   ${tee.holes} holes`
      );

      console.log(
        `   golfers ${tee.minGolfers}-${tee.maxGolfers}`
      );

      console.log(
        `   ${tee.bookingUrl}`
      );
    }
  }

  fs.writeFileSync(
    "results.json",

    JSON.stringify(
      {
        checkedAt:
          new Date().toISOString(),

        settings:
          SETTINGS,

        courseResults,

        matches
      },

      null,
      2
    ),

    "utf8"
  );

  console.log("");
  console.log(
    "Saved results.json"
  );
}

main().catch(
  error => {
    console.error(
      "FATAL ERROR:",
      error
    );

    process.exit(1);
  }
);
