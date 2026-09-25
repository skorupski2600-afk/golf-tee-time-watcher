const { chromium } = require("playwright");
const fs = require("fs");

const SETTINGS = {
  date: "2026-9-25",
  earliest: "7:00 AM",
  latest: "9:00 AM",
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
    },
    {
      name: "Lakewood Country Club",
      url: "https://www.golfnow.com/courses/1033804-lakewood-country-club-details"
    }
  ]
};

const SEEN_FILE = "seen-alerts.json";

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

function targetDateObject() {
  const [year, month, day] = SETTINGS.date
    .split("-")
    .map(Number);

  return new Date(year, month - 1, day, 12, 0, 0);
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

function expectedLongDateText() {
  return targetDateObject().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
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

  const year = targetDateObject().getFullYear();

  const parsed = new Date(
    `${match[2]} ${match[3]}, ${year} 12:00:00`
  );

  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
      const button = page
        .getByRole("button", { name })
        .first();

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

async function getDisplayedDate(page) {
  return parseDisplayedDate(
    await getPageText(page)
  );
}

async function getDisplayedDateObject(page) {
  return parsedDisplayedDateObject(
    await getPageText(page)
  );
}

async function findDateNavigationContainer(page) {
  const currentText =
    await getDisplayedDate(page);

  if (!currentText) return null;

  const label = page
    .getByText(currentText, { exact: true })
    .first();

  if (!(await label.count())) {
    return null;
  }

  let container = label.locator("..");

  for (let level = 0; level < 7; level++) {
    try {
      const controls =
        container.locator(
          'button, a, [role="button"]'
        );

      if ((await controls.count()) >= 2) {
        return container;
      }

      container = container.locator("..");
    } catch (_) {}
  }

  return null;
}

async function clickDateArrow(page, direction) {
  const before =
    await getDisplayedDate(page);

  if (!before) return false;

  const container =
    await findDateNavigationContainer(page);

  if (!container) return false;

  const controls =
    container.locator(
      'button, a, [role="button"]'
    );

  const count =
    await controls.count();

  const visible = [];

  for (let i = 0; i < count; i++) {
    try {
      const item =
        controls.nth(i);

      if (!(await item.isVisible())) {
        continue;
      }

      const aria =
        (await item.getAttribute("aria-label")) || "";

      const title =
        (await item.getAttribute("title")) || "";

      const text =
        await item.innerText().catch(() => "");

      visible.push({
        item,
        label:
          `${aria} ${title} ${text}`
            .trim()
            .toLowerCase()
      });
    } catch (_) {}
  }

  let chosen = null;

  for (const candidate of visible) {
    if (
      direction === "next" &&
      /(next|right|forward)/i.test(candidate.label)
    ) {
      chosen = candidate.item;
      break;
    }

    if (
      direction === "previous" &&
      /(previous|prev|left|back)/i.test(candidate.label)
    ) {
      chosen = candidate.item;
      break;
    }
  }

  if (!chosen) {
    chosen =
      direction === "next"
        ? visible[visible.length - 1]?.item
        : visible[0]?.item;
  }

  if (!chosen) return false;

  try {
    await chosen.click({
      force: true,
      timeout: 4000
    });
  } catch (error) {
    console.log(
      "Arrow click failed:",
      error.message
    );

    return false;
  }

  const deadline =
    Date.now() + 7000;

  while (Date.now() < deadline) {
    await page.waitForTimeout(500);

    const after =
      await getDisplayedDate(page);

    if (
      after &&
      after !== before
    ) {
      console.log(
        `${before} -> ${after}`
      );

      return true;
    }
  }

  return false;
}

async function setCourseDateWithArrows(page) {
  const target =
    targetDateObject();

  let current =
    await getDisplayedDateObject(page);

  if (!current) return false;

  let diff =
    dayDifference(current, target);

  console.log(
    `Moving ${diff} day(s) to ${expectedDateText()}`
  );

  if (diff === 0) return true;

  if (Math.abs(diff) > 31) {
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

    const moved =
      await clickDateArrow(
        page,
        direction
      );

    if (!moved) return false;

    await page.waitForTimeout(900);

    current =
      await getDisplayedDateObject(page);

    if (!current) return false;

    diff =
      dayDifference(
        current,
        target
      );

    safety++;
  }

  const final =
    await getDisplayedDate(page);

  return final === expectedDateText();
}

async function clickViewTeeTimes(
  page,
  course
) {
  console.log(
    "Opening full tee-time inventory..."
  );

  const candidates = [
    page.getByRole(
      "button",
      { name: /^view tee times$/i }
    ),

    page.getByRole(
      "link",
      { name: /^view tee times$/i }
    ),

    page.getByText(
      "View Tee Times",
      { exact: true }
    )
  ];

  for (const locator of candidates) {
    const count =
      Math.min(
        await locator.count(),
        8
      );

    for (let i = 0; i < count; i++) {
      try {
        const item =
          locator.nth(i);

        if (!(await item.isVisible())) {
          continue;
        }

        await item.click({
          force: true,
          timeout: 5000
        });

        await page.waitForTimeout(5000);

        const text =
          await getPageText(page);

        const courseWords =
          course.name
            .toLowerCase()
            .replace(
              /\bgolf\b|\bclub\b|\bcourse\b|\bcountry\b/g,
              ""
            )
            .split(/\s+/)
            .filter(
              word =>
                word.length >= 4
            );

        const lower =
          text.toLowerCase();

        const courseStillPresent =
          courseWords.length === 0 ||
          courseWords.some(
            word =>
              lower.includes(word)
          );

        if (!courseStillPresent) {
          return false;
        }

        return true;
      } catch (_) {}
    }
  }

  return false;
}

async function validateFullTeeSheet(
  page,
  course
) {
  const text =
    await getPageText(page);

  const lower =
    text.toLowerCase();

  const importantCourseWords =
    course.name
      .toLowerCase()
      .replace(
        /\bgolf\b|\bclub\b|\bcourse\b|\bcountry\b/g,
        ""
      )
      .split(/\s+/)
      .filter(
        word =>
          word.length >= 4
      );

  const coursePresent =
    importantCourseWords.length === 0 ||
    importantCourseWords.some(
      word =>
        lower.includes(word)
    );

  const shortDate =
    expectedDateText().toLowerCase();

  const longDate =
    expectedLongDateText().toLowerCase();

  const datePresent =
    lower.includes(shortDate) ||
    lower.includes(longDate) ||
    lower.includes(
      SETTINGS.date
    );

  console.log(
    `Full sheet course check: ${
      coursePresent ? "PASS" : "FAIL"
    }`
  );

  console.log(
    `Full sheet date check: ${
      datePresent ? "PASS" : "NOT VISIBLE"
    }`
  );

  return coursePresent;
}

function normalizePrice(raw) {
  if (!raw) return null;

  const cleaned =
    raw.replace(/[^\d.]/g, "");

  if (!cleaned) return null;

  if (cleaned.includes(".")) {
    const value =
      Number(cleaned);

    return Number.isFinite(value)
      ? `$${value.toFixed(2)}`
      : null;
  }

  if (cleaned.length >= 3) {
    const dollars =
      cleaned.slice(0, -2);

    const cents =
      cleaned.slice(-2);

    return `$${Number(dollars)}.${cents}`;
  }

  return `$${Number(cleaned).toFixed(2)}`;
}

function parseTeeTimes(text) {
  const lines =
    text
      .split(/\r?\n/)
      .map(
        line =>
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

  const results = [];

  for (let i = 0; i < lines.length; i++) {
    if (!timeRegex.test(lines[i])) {
      continue;
    }

    const teeTime =
      normalizeTime(lines[i]);

    const minutes =
      timeToMinutes(teeTime);

    if (
      minutes === null ||
      minutes < earliest ||
      minutes > latest
    ) {
      continue;
    }

    const detailLines = [];

    for (
      let j = i + 1;
      j < lines.length &&
      j <= i + 20;
      j++
    ) {
      if (timeRegex.test(lines[j])) {
        break;
      }

      if (
        /^(More Hot Deals|Tee Details|Course Info|Reviews)$/i.test(
          lines[j]
        )
      ) {
        break;
      }

      detailLines.push(lines[j]);
    }

    const details =
      detailLines.join(" | ");

    if (
      /\b(SOLD|UNAVAILABLE)\b/i.test(
        details
      )
    ) {
      continue;
    }

    const golferMatch =
      details.match(
        /\b(9|18)\s*\/\s*(\d)(?:\s*-\s*(\d))?\b/
      );

    let holes = null;
    let minGolfers = null;
    let maxGolfers = null;

    if (golferMatch) {
      holes =
        Number(golferMatch[1]);

      minGolfers =
        Number(golferMatch[2]);

      maxGolfers =
        Number(
          golferMatch[3] ||
          golferMatch[2]
        );
    }

    if (maxGolfers === null) {
      const range =
        details.match(
          /\b(\d)\s*(?:-|to)\s*(\d)\s*(?:players?|golfers?)\b/i
        );

      if (range) {
        minGolfers =
          Number(range[1]);

        maxGolfers =
          Number(range[2]);
      }
    }

    if (maxGolfers === null) {
      const available =
        details.match(
          /\b(\d)\s*(?:players?|golfers?|spots?)\s*(?:available|open)?\b/i
        );

      if (available) {
        minGolfers = 1;

        maxGolfers =
          Number(
            available[1]
          );
      }
    }

    if (maxGolfers === null) {
      continue;
    }

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

    results.push({
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

  return results.filter(
    tee => {
      const key =
        [
          tee.time,
          tee.pricePerPerson,
          tee.holes,
          tee.minGolfers,
          tee.maxGolfers
        ].join("|");

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    }
  );
}

function loadSeenAlerts() {
  try {
    if (!fs.existsSync(SEEN_FILE)) {
      return {};
    }

    return JSON.parse(
      fs.readFileSync(
        SEEN_FILE,
        "utf8"
      )
    );
  } catch (_) {
    return {};
  }
}

function saveSeenAlerts(seen) {
  fs.writeFileSync(
    SEEN_FILE,
    JSON.stringify(
      seen,
      null,
      2
    ),
    "utf8"
  );
}

function makeAlertKey(tee) {
  return [
    tee.course,
    tee.date,
    tee.time,
    tee.pricePerPerson,
    tee.holes,
    tee.minGolfers,
    tee.maxGolfers
  ].join("|");
}

async function sendNtfy(
  title,
  message,
  clickUrl = ""
) {
  const topic =
    (
      process.env.NTFY_TOPIC ||
      ""
    ).trim();

  if (!topic) {
    console.log(
      "NTFY_TOPIC not configured."
    );

    return false;
  }

  const server =
    (
      process.env.NTFY_SERVER ||
      "https://ntfy.sh"
    ).replace(/\/$/, "");

  const headers = {
    Title: title,
    Priority: "high",
    Tags: "golf"
  };

  if (clickUrl) {
    headers.Click = clickUrl;
  }

  const response =
    await fetch(
      `${server}/${encodeURIComponent(topic)}`,
      {
        method: "POST",
        headers,
        body: message
      }
    );

  if (!response.ok) {
    throw new Error(
      `ntfy HTTP ${response.status}`
    );
  }

  return true;
}

async function sendManualTestAlert() {
  if (
    process.env.GITHUB_EVENT_NAME !==
    "workflow_dispatch"
  ) {
    return;
  }

  if (
    !(process.env.NTFY_TOPIC || "").trim()
  ) {
    return;
  }

  try {
    await sendNtfy(
      "Golf watcher test",

      `Watcher is running.
Date: ${SETTINGS.date}
Golfers: ${SETTINGS.players}
Time: ${SETTINGS.earliest} - ${SETTINGS.latest}
Courses: ${SETTINGS.courses.length}`
    );

    console.log(
      "Test phone notification sent."
    );
  } catch (error) {
    console.log(
      "Test notification failed:",
      error.message
    );
  }
}

async function sendNewMatchAlerts(matches) {
  const seen =
    loadSeenAlerts();

  let alertsSent = 0;

  for (const tee of matches) {
    const key =
      makeAlertKey(tee);

    if (seen[key]) {
      console.log(
        `Already alerted: ${tee.course} ${tee.time}`
      );

      continue;
    }

    const holes =
      tee.holes
        ? `${tee.holes} holes`
        : "Holes not shown";

    const message =
`${tee.course}
${tee.date} at ${tee.time}
${tee.pricePerPerson} per person
${SETTINGS.players} golfers
${holes}

Tap to open GolfNow`;

    try {
      const sent =
        await sendNtfy(
          `Tee time found: ${tee.time}`,
          message,
          tee.bookingUrl
        );

      if (sent) {
        seen[key] =
          new Date().toISOString();

        alertsSent++;

        console.log(
          `Phone alert sent: ${tee.course} ${tee.time}`
        );
      }
    } catch (error) {
      console.log(
        `Phone alert failed: ${error.message}`
      );
    }
  }

  saveSeenAlerts(seen);

  return alertsSent;
}

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
      "Opening GolfNow course page..."
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

    await page.waitForTimeout(5000);

    await dismissPrivacy(page);

    const dateConfirmed =
      await setCourseDateWithArrows(
        page
      );

    if (!dateConfirmed) {
      throw new Error(
        "Could not set requested date."
      );
    }

    console.log(
      `Confirmed date: ${expectedDateText()}`
    );

    const opened =
      await clickViewTeeTimes(
        page,
        course
      );

    if (!opened) {
      throw new Error(
        "Could not open tee times."
      );
    }

    await page.waitForTimeout(3500);

    const validSheet =
      await validateFullTeeSheet(
        page,
        course
      );

    if (!validSheet) {
      throw new Error(
        "Wrong course page."
      );
    }

    const text =
      await getPageText(page);

    await page.screenshot({
      path:
        `${safeName}.png`,

      fullPage: true
    });

    fs.writeFileSync(
      `${safeName}.txt`,
      text,
      "utf8"
    );

    fs.writeFileSync(
      `${safeName}_url.txt`,
      page.url(),
      "utf8"
    );

    const matches =
      parseTeeTimes(text);

    if (!matches.length) {
      console.log(
        `No matching tee times for ${SETTINGS.players} golfers between ${SETTINGS.earliest} and ${SETTINGS.latest}.`
      );
    } else {
      console.log(
        `FOUND ${matches.length} matching tee time(s).`
      );

      for (const tee of matches) {
        console.log(
          `${tee.time} | ${tee.pricePerPerson} | golfers ${tee.minGolfers}-${tee.maxGolfers}`
        );
      }
    }

    return {
      course: course.name,
      bookingUrl: page.url(),
      matches
    };
  } catch (error) {
    console.log(
      "ERROR:",
      error.message
    );

    try {
      const text =
        await getPageText(page);

      fs.writeFileSync(
        `${safeName}.txt`,
        text,
        "utf8"
      );

      fs.writeFileSync(
        `${safeName}_url.txt`,
        page.url(),
        "utf8"
      );

      await page.screenshot({
        path:
          `${safeName}.png`,

        fullPage: true
      });
    } catch (_) {}

    return {
      course: course.name,
      bookingUrl: page.url(),
      matches: []
    };
  } finally {
    await context.close();
  }
}

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
    `Date: ${SETTINGS.date}`
  );

  console.log(
    `Time: ${SETTINGS.earliest} - ${SETTINGS.latest}`
  );

  console.log(
    `Golfers: ${SETTINGS.players}`
  );

  console.log(
    `Courses: ${SETTINGS.courses.length}`
  );

  await sendManualTestAlert();

  const browser =
    await chromium.launch({
      headless: true
    });

  const courseResults = [];

  try {
    for (const course of SETTINGS.courses) {
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
              result.bookingUrl,

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

  if (matches.length === 0) {
    console.log(
      "No qualifying available tee times detected."
    );
  } else {
    for (const tee of matches) {
      console.log("");
      console.log(tee.course);
      console.log(
        `${tee.date} at ${tee.time}`
      );
      console.log(
        `${tee.pricePerPerson} per person`
      );
      console.log(
        `${SETTINGS.players} golfers`
      );
      console.log(
        tee.bookingUrl
      );
    }
  }

  const alertsSent =
    await sendNewMatchAlerts(matches);

  console.log(
    `New phone alerts sent: ${alertsSent}`
  );

  fs.writeFileSync(
    "results.json",

    JSON.stringify(
      {
        checkedAt:
          new Date().toISOString(),

        settings:
          SETTINGS,

        courseResults,

        matches,

        alertsSent
      },

      null,
      2
    ),

    "utf8"
  );

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