const { chromium } = require("playwright");
const fs = require("fs");

const SETTINGS = {
  date: "2026-10-02",
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

function targetDateObject() {
  const [year, month, day] = SETTINGS.date.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function expectedDateText() {
  return targetDateObject().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function expectedLongDateText() {
  return targetDateObject().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function targetMonthYearText() {
  return targetDateObject().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });
}

function targetMonthText() {
  return targetDateObject().toLocaleDateString("en-US", {
    month: "long"
  });
}

function targetDayText() {
  return String(targetDateObject().getDate());
}

function timeToMinutes(value) {
  const match = String(value)
    .trim()
    .toUpperCase()
    .match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);

  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);

  if (match[3] === "PM" && hour !== 12) hour += 12;
  if (match[3] === "AM" && hour === 12) hour = 0;

  return hour * 60 + minute;
}

function normalizeTime(value) {
  const match = String(value)
    .trim()
    .toUpperCase()
    .match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);

  if (!match) return null;

  return `${Number(match[1])}:${match[2]} ${match[3]}`;
}

async function getPageText(page) {
  return await page.locator("body").innerText();
}

async function dismissPrivacy(page) {
  const buttons = [
    /^accept all$/i,
    /^accept$/i,
    /^agree$/i,
    /^continue$/i
  ];

  for (const name of buttons) {
    try {
      const button = page.getByRole("button", { name }).first();

      if (
        (await button.count()) &&
        (await button.isVisible())
      ) {
        await button.click();
        await page.waitForTimeout(500);
        return;
      }
    } catch (_) {}
  }
}

function parseDisplayedDate(text) {
  const match = text.match(
    /Showing\s+(?:Hot Deals|Tee Times)\s+for:[\s\S]*?\bon\s+([A-Z][a-z]{2}),\s+([A-Z][a-z]{2})\s+(\d{1,2})/i
  );

  if (!match) return null;

  return `${match[1]}, ${match[2]} ${Number(match[3])}`;
}

async function getDisplayedDate(page) {
  return parseDisplayedDate(await getPageText(page));
}

async function clickDateInput(page) {
  console.log("Looking for GolfNow date picker...");

  const selectors = [
    'input[type="date"]',
    'input[aria-label*="date" i]',
    'input[placeholder*="date" i]',
    'input[name*="date" i]',
    'button[aria-label*="date" i]',
    'button[title*="date" i]',
    '[role="button"][aria-label*="date" i]'
  ];

  for (const selector of selectors) {
    try {
      const items = page.locator(selector);
      const count = Math.min(await items.count(), 20);

      for (let i = 0; i < count; i++) {
        const item = items.nth(i);

        if (!(await item.isVisible().catch(() => false))) {
          continue;
        }

        console.log(`Found date control using: ${selector}`);

        await item.click({
          force: true,
          timeout: 5000
        });

        await page.waitForTimeout(1000);

        return true;
      }
    } catch (_) {}
  }

  const dateTextCandidates = [
    /^date$/i,
    /select date/i,
    /choose date/i,
    /tee time date/i
  ];

  for (const pattern of dateTextCandidates) {
    try {
      const item = page.getByText(pattern).first();

      if (
        (await item.count()) &&
        (await item.isVisible())
      ) {
        await item.click({ force: true });
        await page.waitForTimeout(1000);
        return true;
      }
    } catch (_) {}
  }

  return false;
}

async function calendarVisible(page) {
  const body = await getPageText(page);

  return (
    body.includes(targetMonthText()) ||
    body.includes(targetMonthYearText()) ||
    /\bSun\b[\s\S]*\bMon\b[\s\S]*\bTue\b/i.test(body)
  );
}

async function findCalendarNextButton(page) {
  const selectors = [
    '[aria-label*="next month" i]',
    '[title*="next month" i]',
    '[aria-label*="next" i]',
    '[title*="next" i]'
  ];

  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = Math.min(await matches.count(), 30);

    for (let i = 0; i < count; i++) {
      const item = matches.nth(i);

      if (!(await item.isVisible().catch(() => false))) {
        continue;
      }

      const box = await item.boundingBox().catch(() => null);

      if (!box) continue;

      if (box.width <= 120 && box.height <= 120) {
        return item;
      }
    }
  }

  const buttons = page.locator('button, [role="button"]');
  const count = Math.min(await buttons.count(), 200);

  const candidates = [];

  for (let i = 0; i < count; i++) {
    try {
      const item = buttons.nth(i);

      if (!(await item.isVisible())) continue;

      const box = await item.boundingBox();
      if (!box) continue;

      const aria = (await item.getAttribute("aria-label")) || "";
      const title = (await item.getAttribute("title")) || "";
      const html = await item.innerHTML().catch(() => "");

      const description =
        `${aria} ${title} ${html}`.toLowerCase();

      if (
        /next|right|chevron-right|arrow-right/.test(description) &&
        box.width <= 120 &&
        box.height <= 120
      ) {
        candidates.push({ item, box });
      }
    } catch (_) {}
  }

  candidates.sort((a, b) => b.box.x - a.box.x);

  return candidates.length ? candidates[0].item : null;
}

async function moveCalendarToTargetMonth(page) {
  const target = targetMonthYearText();

  for (let attempt = 0; attempt < 15; attempt++) {
    const text = await getPageText(page);

    if (
      text.includes(target) ||
      (
        text.includes(targetMonthText()) &&
        text.includes(String(targetDateObject().getFullYear()))
      )
    ) {
      console.log(`Calendar month confirmed: ${target}`);
      return true;
    }

    const next = await findCalendarNextButton(page);

    if (!next) {
      console.log("Could not find calendar next-month button.");
      return false;
    }

    console.log("Moving calendar forward one month...");

    await next.click({
      force: true,
      timeout: 5000
    });

    await page.waitForTimeout(700);
  }

  return false;
}

async function findExactCalendarDate(page) {
  const target = targetDateObject();

  const possibleFullLabels = [
    expectedLongDateText(),
    `${targetMonthText()} ${target.getDate()}, ${target.getFullYear()}`,
    `${targetMonthText()} ${target.getDate()} ${target.getFullYear()}`,
    SETTINGS.date
  ];

  for (const label of possibleFullLabels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "i");

    const selectors = [
      `button[aria-label*="${label}" i]`,
      `[role="button"][aria-label*="${label}" i]`,
      `[title*="${label}" i]`
    ];

    for (const selector of selectors) {
      try {
        const matches = page.locator(selector);
        const count = Math.min(await matches.count(), 20);

        for (let i = 0; i < count; i++) {
          const item = matches.nth(i);

          if (await item.isVisible().catch(() => false)) {
            return item;
          }
        }
      } catch (_) {}
    }

    try {
      const textMatch = page.getByText(pattern).first();

      if (
        (await textMatch.count()) &&
        (await textMatch.isVisible())
      ) {
        return textMatch;
      }
    } catch (_) {}
  }

  /*
   * Fallback:
   * find all visible buttons whose text is exactly the target day number.
   * Then prefer one whose HTML/attributes reference the target month/year.
   */
  const dayButtons = page.locator(
    'button, [role="button"], td, a'
  );

  const count = Math.min(await dayButtons.count(), 400);

  const candidates = [];

  for (let i = 0; i < count; i++) {
    try {
      const item = dayButtons.nth(i);

      if (!(await item.isVisible())) continue;

      const text = (await item.innerText().catch(() => "")).trim();

      if (text !== targetDayText()) continue;

      const aria = (await item.getAttribute("aria-label")) || "";
      const title = (await item.getAttribute("title")) || "";
      const dataDate = (await item.getAttribute("data-date")) || "";
      const html = await item.innerHTML().catch(() => "");

      const description =
        `${aria} ${title} ${dataDate} ${html}`.toLowerCase();

      let score = 0;

      if (description.includes(targetMonthText().toLowerCase())) {
        score += 100;
      }

      if (description.includes(String(target.getFullYear()))) {
        score += 100;
      }

      if (description.includes(SETTINGS.date)) {
        score += 300;
      }

      const box = await item.boundingBox().catch(() => null);

      if (box) {
        candidates.push({
          item,
          score,
          box
        });
      }
    } catch (_) {}
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 1) {
    return candidates[0].item;
  }

  if (candidates.length && candidates[0].score > 0) {
    return candidates[0].item;
  }

  return null;
}

async function selectTargetDateFromCalendar(page) {
  console.log(
    `Attempting direct calendar selection for ${expectedLongDateText()}...`
  );

  const opened = await clickDateInput(page);

  if (!opened) {
    console.log("Could not open GolfNow date picker.");
    return false;
  }

  if (!(await calendarVisible(page))) {
    console.log("Date picker did not appear.");
    return false;
  }

  const monthReady = await moveCalendarToTargetMonth(page);

  if (!monthReady) {
    return false;
  }

  const targetDateButton =
    await findExactCalendarDate(page);

  if (!targetDateButton) {
    console.log(
      `Could not find ${expectedLongDateText()} inside the calendar.`
    );
    return false;
  }

  console.log(
    `Selecting ${expectedLongDateText()} from calendar...`
  );

  await targetDateButton.click({
    force: true,
    timeout: 5000
  });

  const deadline = Date.now() + 12000;

  while (Date.now() < deadline) {
    await page.waitForTimeout(500);

    const displayed = await getDisplayedDate(page);

    if (displayed === expectedDateText()) {
      console.log(
        `Calendar selection confirmed: ${displayed}`
      );
      return true;
    }

    const body = await getPageText(page);

    if (
      body.includes(expectedDateText()) ||
      body.includes(expectedLongDateText())
    ) {
      console.log(
        `Target date visible after calendar selection: ${expectedDateText()}`
      );
      return true;
    }
  }

  console.log(
    "Calendar date was clicked, but GolfNow did not confirm the target date."
  );

  return false;
}

async function fallbackArrowNavigation(page) {
  console.log(
    "Calendar selection failed. Trying daily arrows as fallback..."
  );

  const target = targetDateObject();

  for (let safety = 0; safety < 31; safety++) {
    const text = await getPageText(page);
    const currentText = parseDisplayedDate(text);

    if (!currentText) {
      return false;
    }

    if (currentText === expectedDateText()) {
      return true;
    }

    const candidates = page.locator(
      'button, a, [role="button"]'
    );

    const count = Math.min(await candidates.count(), 200);

    let best = null;

    for (let i = 0; i < count; i++) {
      try {
        const item = candidates.nth(i);

        if (!(await item.isVisible())) continue;

        const box = await item.boundingBox();
        if (!box) continue;

        const aria =
          (await item.getAttribute("aria-label")) || "";

        const title =
          (await item.getAttribute("title")) || "";

        const html =
          await item.innerHTML().catch(() => "");

        const description =
          `${aria} ${title} ${html}`.toLowerCase();

        if (
          /next|right|forward|chevron-right|arrow-right/.test(
            description
          ) &&
          box.width <= 120 &&
          box.height <= 120
        ) {
          if (!best || box.x > best.box.x) {
            best = { item, box };
          }
        }
      } catch (_) {}
    }

    if (!best) {
      return false;
    }

    const before = currentText;

    await best.item.click({
      force: true,
      timeout: 5000
    });

    const deadline = Date.now() + 8000;
    let changed = false;

    while (Date.now() < deadline) {
      await page.waitForTimeout(500);

      const after = await getDisplayedDate(page);

      if (after && after !== before) {
        console.log(`${before} -> ${after}`);
        changed = true;
        break;
      }
    }

    if (!changed) {
      return false;
    }
  }

  return false;
}

async function setTargetDate(page) {
  if (await selectTargetDateFromCalendar(page)) {
    return true;
  }

  return await fallbackArrowNavigation(page);
}

async function clickViewTeeTimes(page, course) {
  console.log("Opening full tee-time inventory...");

  const candidates = [
    page.getByRole("button", {
      name: /^view tee times$/i
    }),
    page.getByRole("link", {
      name: /^view tee times$/i
    }),
    page.getByText("View Tee Times", {
      exact: true
    })
  ];

  for (const locator of candidates) {
    const count = Math.min(await locator.count(), 8);

    for (let i = 0; i < count; i++) {
      try {
        const item = locator.nth(i);

        if (!(await item.isVisible())) {
          continue;
        }

        await item.click({
          force: true,
          timeout: 5000
        });

        await page.waitForTimeout(5000);

        const text = await getPageText(page);
        const lower = text.toLowerCase();

        const courseWords =
          course.name
            .toLowerCase()
            .replace(
              /\bgolf\b|\bclub\b|\bcourse\b|\bcountry\b/g,
              ""
            )
            .split(/\s+/)
            .filter(word => word.length >= 4);

        const coursePresent =
          courseWords.length === 0 ||
          courseWords.some(word =>
            lower.includes(word)
          );

        if (!coursePresent) {
          return false;
        }

        return true;
      } catch (_) {}
    }
  }

  return false;
}

async function validateFullTeeSheet(page, course) {
  const text = await getPageText(page);
  const lower = text.toLowerCase();

  const importantCourseWords =
    course.name
      .toLowerCase()
      .replace(
        /\bgolf\b|\bclub\b|\bcourse\b|\bcountry\b/g,
        ""
      )
      .split(/\s+/)
      .filter(word => word.length >= 4);

  const coursePresent =
    importantCourseWords.length === 0 ||
    importantCourseWords.some(word =>
      lower.includes(word)
    );

  const datePresent =
    lower.includes(expectedDateText().toLowerCase()) ||
    lower.includes(expectedLongDateText().toLowerCase()) ||
    lower.includes(SETTINGS.date);

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

  const value = Number(cleaned);

  return Number.isFinite(value)
    ? `$${value.toFixed(2)}`
    : null;
}

function parseTeeTimes(text) {
  const lines =
    text
      .split(/\r?\n/)
      .map(line =>
        line.replace(/\u00a0/g, " ").trim()
      )
      .filter(Boolean);

  const earliest =
    timeToMinutes(SETTINGS.earliest);

  const latest =
    timeToMinutes(SETTINGS.latest);

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
      if (timeRegex.test(lines[j])) break;

      detailLines.push(lines[j]);
    }

    const details =
      detailLines.join(" | ");

    if (
      /\b(SOLD|UNAVAILABLE)\b/i.test(details)
    ) {
      continue;
    }

    let minGolfers = null;
    let maxGolfers = null;
    let holes = null;

    const golferMatch =
      details.match(
        /\b(9|18)\s*\/\s*(\d)(?:\s*-\s*(\d))?\b/
      );

    if (golferMatch) {
      holes = Number(golferMatch[1]);
      minGolfers = Number(golferMatch[2]);

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
        minGolfers = Number(range[1]);
        maxGolfers = Number(range[2]);
      }
    }

    if (maxGolfers === null) {
      const available =
        details.match(
          /\b(\d)\s*(?:players?|golfers?|spots?)\s*(?:available|open)?\b/i
        );

      if (available) {
        minGolfers = 1;
        maxGolfers = Number(available[1]);
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
      details.match(/\$\s*[\d.,]+/);

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

  const seen = new Set();

  return results.filter(tee => {
    const key = [
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
  });
}

function loadSeenAlerts() {
  try {
    if (!fs.existsSync(SEEN_FILE)) {
      return {};
    }

    return JSON.parse(
      fs.readFileSync(SEEN_FILE, "utf8")
    );
  } catch (_) {
    return {};
  }
}

function saveSeenAlerts(seen) {
  fs.writeFileSync(
    SEEN_FILE,
    JSON.stringify(seen, null, 2),
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
}

async function sendNewMatchAlerts(matches) {
  const seen =
    loadSeenAlerts();

  let alertsSent = 0;

  for (const tee of matches) {
    const key =
      makeAlertKey(tee);

    if (seen[key]) {
      continue;
    }

    const message =
`${tee.course}
${tee.date} at ${tee.time}
${tee.pricePerPerson} per person
${SETTINGS.players} golfers

Tap to open GolfNow`;

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
    }
  }

  saveSeenAlerts(seen);

  return alertsSent;
}

async function saveDebugFiles(
  page,
  safeName
) {
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
      path: `${safeName}.png`,
      fullPage: true
    });
  } catch (_) {}
}

async function checkCourse(browser, course) {
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

    await page.goto(course.url, {
      waitUntil:
        "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    await dismissPrivacy(page);

    const dateSet =
      await setTargetDate(page);

    if (!dateSet) {
      throw new Error(
        "Could not select target date from GolfNow calendar."
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

    const valid =
      await validateFullTeeSheet(
        page,
        course
      );

    if (!valid) {
      throw new Error(
        "Wrong course page."
      );
    }

    const text =
      await getPageText(page);

    await saveDebugFiles(
      page,
      safeName
    );

    const matches =
      parseTeeTimes(text);

    console.log(
      matches.length
        ? `FOUND ${matches.length} matching tee time(s).`
        : `No matching tee times for ${SETTINGS.players} golfers between ${SETTINGS.earliest} and ${SETTINGS.latest}.`
    );

    return {
      course:
        course.name,
      bookingUrl:
        page.url(),
      matches,
      error: null
    };
  } catch (error) {
    console.log(
      "ERROR:",
      error.message
    );

    await saveDebugFiles(
      page,
      safeName
    );

    return {
      course:
        course.name,
      bookingUrl:
        page.url(),
      matches: [],
      error:
        error.message
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
    for (
      const course of
      SETTINGS.courses
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

  const failedCourses =
    courseResults.filter(
      result =>
        result.error
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

  if (
    failedCourses.length
  ) {
    console.log(
      `WARNING: ${failedCourses.length} course(s) could not be checked:`
    );

    for (
      const result of
      failedCourses
    ) {
      console.log(
        `${result.course}: ${result.error}`
      );
    }
  }

  if (
    !matches.length &&
    !failedCourses.length
  ) {
    console.log(
      "No qualifying available tee times detected."
    );
  }

  if (
    !matches.length &&
    failedCourses.length
  ) {
    console.log(
      "No matches found, but the check was incomplete because one or more courses failed."
    );
  }

  for (
    const tee of matches
  ) {
    console.log("");
    console.log(tee.course);
    console.log(
      `${tee.date} at ${tee.time}`
    );
    console.log(
      `${tee.pricePerPerson} per person`
    );
    console.log(
      tee.bookingUrl
    );
  }

  const alertsSent =
    await sendNewMatchAlerts(
      matches
    );

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
        failedCourses,
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

main().catch(error => {
  console.error(
    "FATAL ERROR:",
    error
  );

  process.exit(1);
});