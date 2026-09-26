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
      facilityUrl:
        "https://www.golfnow.com/tee-times/facility/6922-gambler-ridge-golf-club/search"
    },
    {
      name: "Hanover Golf Club",
      facilityUrl:
        "https://www.golfnow.com/tee-times/facility/4790-hanover-golf-club/search"
    },
    {
      name: "Cream Ridge Golf Course",
      facilityUrl:
        "https://www.golfnow.com/tee-times/facility/7806-cream-ridge-golf-course/search"
    },
    {
      name: "Old Bridge Golf Club",
      facilityUrl:
        "https://www.golfnow.com/tee-times/facility/18179-old-bridge-golf-club/search"
    },
    {
      name: "Cedar Creek Golf Course",
      facilityUrl:
        "https://www.golfnow.com/tee-times/facility/8600-cedar-creek-golf-course/search"
    },
    {
      name: "Mercer Oaks West Golf Course",
      facilityUrl:
        "https://www.golfnow.com/tee-times/facility/5467-mercer-oaks-west-golf-course/search"
    },
    {
      name: "Lakewood Country Club",
      facilityUrl:
        "https://www.golfnow.com/tee-times/facility/10619-lakewood-country-club/search"
    }
  ]
};

const SEEN_FILE = "seen-alerts.json";

function targetDateObject() {
  const [year, month, day] =
    SETTINGS.date.split("-").map(Number);

  return new Date(
    year,
    month - 1,
    day,
    12,
    0,
    0
  );
}

function golfNowDateHash() {
  const date =
    targetDateObject();

  const month =
    date.toLocaleDateString(
      "en-US",
      {
        month: "short"
      }
    );

  const day =
    String(date.getDate()).padStart(
      2,
      "0"
    );

  const year =
    date.getFullYear();

  return `#date=${month}+${day}+${year}`;
}

function buildCourseUrl(course) {
  return (
    course.facilityUrl +
    golfNowDateHash()
  );
}

function expectedDateText() {
  return targetDateObject()
    .toLocaleDateString(
      "en-US",
      {
        weekday: "short",
        month: "short",
        day: "numeric"
      }
    );
}

function expectedLongDateText() {
  return targetDateObject()
    .toLocaleDateString(
      "en-US",
      {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
      }
    );
}

function expectedMediumDateText() {
  return targetDateObject()
    .toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric",
        year: "numeric"
      }
    );
}

function timeToMinutes(value) {
  const match =
    String(value)
      .trim()
      .toUpperCase()
      .match(
        /(\d{1,2}):(\d{2})\s*(AM|PM)/
      );

  if (!match) {
    return null;
  }

  let hour =
    Number(match[1]);

  const minute =
    Number(match[2]);

  const ampm =
    match[3];

  if (
    ampm === "PM" &&
    hour !== 12
  ) {
    hour += 12;
  }

  if (
    ampm === "AM" &&
    hour === 12
  ) {
    hour = 0;
  }

  return (
    hour * 60 +
    minute
  );
}

function normalizeTime(value) {
  const match =
    String(value)
      .trim()
      .toUpperCase()
      .match(
        /(\d{1,2}):(\d{2})\s*(AM|PM)/
      );

  if (!match) {
    return null;
  }

  return `${Number(
    match[1]
  )}:${match[2]} ${match[3]}`;
}

async function getPageText(page) {
  return await page
    .locator("body")
    .innerText();
}

async function dismissPrivacy(page) {
  const names = [
    /^continue$/i,
    /^accept all$/i,
    /^accept$/i,
    /^agree$/i
  ];

  for (
    const name of names
  ) {
    try {
      const button =
        page
          .getByRole(
            "button",
            { name }
          )
          .first();

      if (
        (await button.count()) &&
        (await button.isVisible())
      ) {
        await button.click();

        await page.waitForTimeout(
          700
        );

        return;
      }
    } catch (_) {}
  }
}

function targetDateVisible(text) {
  const lower =
    String(text)
      .toLowerCase();

  const shortDate =
    expectedDateText()
      .toLowerCase();

  const longDate =
    expectedLongDateText()
      .toLowerCase();

  const mediumDate =
    expectedMediumDateText()
      .toLowerCase();

  const date =
    targetDateObject();

  const monthLong =
    date.toLocaleDateString(
      "en-US",
      { month: "long" }
    ).toLowerCase();

  const monthShort =
    date.toLocaleDateString(
      "en-US",
      { month: "short" }
    ).toLowerCase();

  const day =
    date.getDate();

  const year =
    date.getFullYear();

  if (
    lower.includes(shortDate) ||
    lower.includes(longDate) ||
    lower.includes(mediumDate)
  ) {
    return true;
  }

  const patterns = [
    new RegExp(
      `${monthShort}\\s+0?${day}\\b`,
      "i"
    ),
    new RegExp(
      `${monthLong}\\s+0?${day}\\b`,
      "i"
    ),
    new RegExp(
      `0?${day}\\s+${monthLong}`,
      "i"
    ),
    new RegExp(
      `${monthShort}\\s+0?${day}\\s+${year}`,
      "i"
    )
  ];

  return patterns.some(
    pattern =>
      pattern.test(text)
  );
}

async function waitForTargetDate(page) {
  const expectedHash =
    golfNowDateHash()
      .toLowerCase();

  const deadline =
    Date.now() + 20000;

  while (
    Date.now() <
    deadline
  ) {
    const currentUrl =
      page.url();

    const text =
      await getPageText(page)
        .catch(() => "");

    const hashCorrect =
      currentUrl
        .toLowerCase()
        .includes(
          expectedHash
        );

    const dateVisible =
      targetDateVisible(
        text
      );

    if (
      hashCorrect &&
      dateVisible
    ) {
      console.log(
        `Confirmed target date: ${expectedDateText()}`
      );

      return true;
    }

    await page.waitForTimeout(
      750
    );
  }

  console.log(
    `Target URL after load: ${page.url()}`
  );

  console.log(
    `Expected date: ${expectedDateText()}`
  );

  return false;
}

async function waitForTeeTimeInventory(
  page
) {
  const deadline =
    Date.now() + 20000;

  const timeRegex =
    /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i;

  while (
    Date.now() <
    deadline
  ) {
    const text =
      await getPageText(page)
        .catch(() => "");

    if (
      timeRegex.test(text)
    ) {
      console.log(
        "Tee-time inventory loaded."
      );

      return true;
    }

    if (
      /no tee times|no available tee times|no results/i.test(
        text
      )
    ) {
      console.log(
        "GolfNow loaded the requested date but currently shows no tee times."
      );

      return true;
    }

    await page.waitForTimeout(
      750
    );
  }

  console.log(
    "Could not confirm that tee-time inventory loaded."
  );

  return false;
}

async function validateCourse(
  page,
  course
) {
  const text =
    await getPageText(page);

  const lower =
    text.toLowerCase();

  const importantWords =
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
    importantWords.length === 0 ||
    importantWords.some(
      word =>
        lower.includes(
          word
        )
    );

  console.log(
    `Course check: ${
      coursePresent
        ? "PASS"
        : "FAIL"
    }`
  );

  return coursePresent;
}

function normalizePrice(raw) {
  if (!raw) {
    return null;
  }

  const match =
    String(raw).match(
      /\$?\s*(\d+(?:\.\d{1,2})?)/
    );

  if (!match) {
    return null;
  }

  const value =
    Number(match[1]);

  if (
    !Number.isFinite(value)
  ) {
    return null;
  }

  return `$${value.toFixed(2)}`;
}

function parseTeeTimes(text) {
  const lines =
    text
      .split(/\r?\n/)
      .map(
        line =>
          line
            .replace(
              /\u00a0/g,
              " "
            )
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

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    if (
      !timeRegex.test(
        lines[i]
      )
    ) {
      continue;
    }

    const teeTime =
      normalizeTime(
        lines[i]
      );

    const minutes =
      timeToMinutes(
        teeTime
      );

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
      j <= i + 25;
      j++
    ) {
      if (
        timeRegex.test(
          lines[j]
        )
      ) {
        break;
      }

      if (
        /^(More Hot Deals|Tee Details|Course Info|Reviews)$/i.test(
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
      detailLines.join(
        " | "
      );

    if (
      /\b(SOLD|UNAVAILABLE)\b/i.test(
        details
      )
    ) {
      continue;
    }

    let holes = null;
    let minGolfers = null;
    let maxGolfers = null;

    const golferMatch =
      details.match(
        /\b(9|18)\s*\/\s*(\d)(?:\s*-\s*(\d))?\b/
      );

    if (golferMatch) {
      holes =
        Number(
          golferMatch[1]
        );

      minGolfers =
        Number(
          golferMatch[2]
        );

      maxGolfers =
        Number(
          golferMatch[3] ||
          golferMatch[2]
        );
    }

    if (
      maxGolfers === null
    ) {
      const range =
        details.match(
          /\b(\d)\s*(?:-|to)\s*(\d)\s*(?:players?|golfers?|spots?)\b/i
        );

      if (range) {
        minGolfers =
          Number(
            range[1]
          );

        maxGolfers =
          Number(
            range[2]
          );
      }
    }

    if (
      maxGolfers === null
    ) {
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

    /*
     * If GolfNow explicitly lists player availability,
     * enforce the 4-player requirement.
     *
     * If GolfNow does not expose player-count text in
     * the rendered card, keep the tee time rather than
     * silently throwing it away.
     */
    if (
      maxGolfers !== null
    ) {
      if (
        SETTINGS.players <
          minGolfers ||
        SETTINGS.players >
          maxGolfers
      ) {
        continue;
      }
    }

    const priceMatch =
      details.match(
        /\$\s*\d+(?:\.\d{1,2})?/
      );

    const pricePerPerson =
      normalizePrice(
        priceMatch
          ? priceMatch[0]
          : null
      );

    results.push({
      time:
        teeTime,

      pricePerPerson:
        pricePerPerson ||
        "Price not shown",

      holes,

      minGolfers,

      maxGolfers,

      context:
        details
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

function loadSeenAlerts() {
  try {
    if (
      !fs.existsSync(
        SEEN_FILE
      )
    ) {
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
      process.env
        .NTFY_TOPIC ||
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
      process.env
        .NTFY_SERVER ||
      "https://ntfy.sh"
    ).replace(
      /\/$/,
      ""
    );

  const headers = {
    Title: title,
    Priority: "high",
    Tags: "golf"
  };

  if (clickUrl) {
    headers.Click =
      clickUrl;
  }

  const response =
    await fetch(
      `${server}/${encodeURIComponent(
        topic
      )}`,
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
    process.env
      .GITHUB_EVENT_NAME !==
    "workflow_dispatch"
  ) {
    return;
  }

  if (
    !(
      process.env
        .NTFY_TOPIC ||
      ""
    ).trim()
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

async function sendNewMatchAlerts(
  matches
) {
  const seen =
    loadSeenAlerts();

  let alertsSent = 0;

  for (
    const tee of matches
  ) {
    const key =
      makeAlertKey(tee);

    if (
      seen[key]
    ) {
      console.log(
        `Already alerted: ${tee.course} ${tee.time}`
      );

      continue;
    }

    const golferText =
      tee.maxGolfers !== null
        ? `Available for ${tee.minGolfers}-${tee.maxGolfers} golfers`
        : `${SETTINGS.players}-player availability should be confirmed on GolfNow`;

    const holes =
      tee.holes
        ? `${tee.holes} holes`
        : "Holes not shown";

    const message =
`${tee.course}
${tee.date} at ${tee.time}
${tee.pricePerPerson}
${golferText}
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
          new Date()
            .toISOString();

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
      path:
        `${safeName}.png`,

      fullPage: true
    });
  } catch (_) {}
}

async function checkCourse(
  browser,
  course
) {
  console.log("");
  console.log(
    "========================================"
  );
  console.log(
    course.name
  );
  console.log(
    "========================================"
  );

  const context =
    await browser.newContext({
      viewport: {
        width: 1440,
        height: 1100
      },

      locale:
        "en-US",

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

  const targetUrl =
    buildCourseUrl(
      course
    );

  try {
    console.log(
      "Opening direct GolfNow tee-time URL..."
    );

    console.log(
      targetUrl
    );

    await page.goto(
      targetUrl,
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

    await page.waitForTimeout(
      1500
    );

    const dateConfirmed =
      await waitForTargetDate(
        page
      );

    if (
      !dateConfirmed
    ) {
      throw new Error(
        `GolfNow did not confirm ${expectedDateText()}.`
      );
    }

    const correctCourse =
      await validateCourse(
        page,
        course
      );

    if (
      !correctCourse
    ) {
      throw new Error(
        "Wrong GolfNow facility page loaded."
      );
    }

    const inventoryLoaded =
      await waitForTeeTimeInventory(
        page
      );

    if (
      !inventoryLoaded
    ) {
      throw new Error(
        "Could not confirm tee-time inventory loaded."
      );
    }

    const text =
      await getPageText(
        page
      );

    await saveDebugFiles(
      page,
      safeName
    );

    const matches =
      parseTeeTimes(
        text
      );

    if (
      matches.length === 0
    ) {
      console.log(
        `No matching tee times between ${SETTINGS.earliest} and ${SETTINGS.latest}.`
      );
    } else {
      console.log(
        `FOUND ${matches.length} possible matching tee time(s).`
      );

      for (
        const tee of matches
      ) {
        console.log(
          `${tee.time} | ${tee.pricePerPerson} | golfers ${
            tee.minGolfers !== null
              ? `${tee.minGolfers}-${tee.maxGolfers}`
              : "not shown"
          }`
        );
      }
    }

    return {
      course:
        course.name,

      bookingUrl:
        targetUrl,

      matches,

      error:
        null
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
        targetUrl,

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
    `GolfNow hash: ${golfNowDateHash()}`
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
    failedCourses.length > 0
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
    matches.length === 0
  ) {
    if (
      failedCourses.length === 0
    ) {
      console.log(
        "No qualifying available tee times detected."
      );
    } else {
      console.log(
        "No matches found, but the check was incomplete because one or more courses failed."
      );
    }
  } else {
    for (
      const tee of
      matches
    ) {
      console.log("");
      console.log(
        tee.course
      );

      console.log(
        `${tee.date} at ${tee.time}`
      );

      console.log(
        tee.pricePerPerson
      );

      console.log(
        `${SETTINGS.players} golfers requested`
      );

      console.log(
        tee.bookingUrl
      );
    }
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
          new Date()
            .toISOString(),

        settings:
          SETTINGS,

        golfNowDateHash:
          golfNowDateHash(),

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

main().catch(
  error => {
    console.error(
      "FATAL ERROR:",
      error
    );

    process.exit(1);
  }
);