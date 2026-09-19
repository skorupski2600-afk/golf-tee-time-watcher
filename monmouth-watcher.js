const { chromium } = require("playwright");
const fs = require("fs");

const SETTINGS = {
  date: "2026-09-26",
  earliest: "7:00 AM",
  latest: "11:00 AM",
  players: 4,
  holes: 18,

  courses: [
    "Hominy Hill",
    "Charleston North",
    "Charleston South",
    "Shark River"
  ]
};

const START_URL =
  "https://foreupsoftware.com/index.php/booking/20155/3782#/teetimes";

const SEEN_FILE =
  "seen-monmouth-alerts.json";

// ======================================================
// TIME HELPERS
// ======================================================

function timeToMinutes(value) {
  const m = String(value)
    .trim()
    .toUpperCase()
    .match(
      /(\d{1,2}):(\d{2})\s*(AM|PM)/
    );

  if (!m) return null;

  let hour = Number(m[1]);

  const minute =
    Number(m[2]);

  const ampm =
    m[3];

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
  const m = String(value)
    .trim()
    .toUpperCase()
    .match(
      /(\d{1,2}):(\d{2})\s*(AM|PM)/
    );

  if (!m) return null;

  return (
    `${Number(m[1])}:` +
    `${m[2]} ${m[3]}`
  );
}

// ======================================================
// DATE HELPERS
// ======================================================

function parseYmd(ymd) {
  const [y, m, d] =
    ymd
      .split("-")
      .map(Number);

  return {
    y,
    m,
    d
  };
}

function targetDateUtcNoon() {
  const {
    y,
    m,
    d
  } =
    parseYmd(
      SETTINGS.date
    );

  return new Date(
    Date.UTC(
      y,
      m - 1,
      d,
      12,
      0,
      0
    )
  );
}

function easternTodayYmd() {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "America/New_York",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit"
      }
    )
      .formatToParts(
        new Date()
      );

  const map =
    Object.fromEntries(
      parts.map(
        p => [
          p.type,
          p.value
        ]
      )
    );

  return (
    `${map.year}-` +
    `${map.month}-` +
    `${map.day}`
  );
}

function daysFromToday() {
  const today =
    parseYmd(
      easternTodayYmd()
    );

  const target =
    parseYmd(
      SETTINGS.date
    );

  const a =
    Date.UTC(
      today.y,
      today.m - 1,
      today.d,
      12,
      0,
      0
    );

  const b =
    Date.UTC(
      target.y,
      target.m - 1,
      target.d,
      12,
      0,
      0
    );

  return Math.round(
    (b - a) /
    86400000
  );
}

function bookingMode() {
  const days =
    daysFromToday();

  if (days < 0) {
    throw new Error(
      "Target date is in the past."
    );
  }

  if (days < 7) {
    return "Golf Passholder";
  }

  if (days <= 30) {
    return (
      "Resident Advanced Reservations"
    );
  }

  throw new Error(
    "Target date is more than 30 days away."
  );
}

function foreupDateValue() {
  const {
    y,
    m,
    d
  } =
    parseYmd(
      SETTINGS.date
    );

  return (
    `${String(m).padStart(2, "0")}-` +
    `${String(d).padStart(2, "0")}-` +
    `${y}`
  );
}

function prettyDate() {
  return targetDateUtcNoon()
    .toLocaleDateString(
      "en-US",
      {
        timeZone:
          "UTC",

        weekday:
          "short",

        month:
          "short",

        day:
          "numeric",

        year:
          "numeric"
      }
    );
}

// ======================================================
// PAGE HELPERS
// ======================================================

async function pageText(page) {
  return await page
    .locator("body")
    .innerText();
}

async function saveDiagnostic(
  page,
  name
) {
  const safe =
    name
      .replace(
        /[^a-z0-9]/gi,
        "_"
      )
      .toLowerCase();

  try {
    fs.writeFileSync(
      `${safe}.txt`,
      await pageText(page),
      "utf8"
    );

    fs.writeFileSync(
      `${safe}_url.txt`,
      page.url(),
      "utf8"
    );

    await page.screenshot({
      path:
        `${safe}.png`,

      fullPage:
        true
    });

  } catch (_) {}
}

async function clickText(
  page,
  text
) {
  const candidates = [
    page.getByRole(
      "button",
      {
        name:
          text,

        exact:
          true
      }
    ),

    page.getByRole(
      "link",
      {
        name:
          text,

        exact:
          true
      }
    ),

    page.getByText(
      text,
      {
        exact:
          true
      }
    )
  ];

  for (
    const locator of candidates
  ) {
    const count =
      Math.min(
        await locator.count(),
        6
      );

    for (
      let i = 0;
      i < count;
      i++
    ) {
      try {
        const item =
          locator.nth(i);

        if (
          !(await item.isVisible())
        ) {
          continue;
        }

        await item.click({
          force:
            true,

          timeout:
            5000
        });

        return true;

      } catch (_) {}
    }
  }

  return false;
}

// ======================================================
// FACILITY
// ======================================================

async function selectFacility(
  page,
  course
) {
  console.log(
    `Selecting facility: ${course}`
  );

  const selects =
    page.locator(
      "select:visible"
    );

  const count =
    await selects.count();

  for (
    let i = 0;
    i < count;
    i++
  ) {
    const sel =
      selects.nth(i);

    try {
      const options =
        await sel
          .locator("option")
          .allTextContents();

      const found =
        options.some(
          o =>
            o
              .trim()
              .toLowerCase() ===
            course
              .toLowerCase()
        );

      if (!found) {
        continue;
      }

      await sel.selectOption({
        label:
          course
      });

      await page.waitForTimeout(
        2000
      );

      return true;

    } catch (_) {}
  }

  console.log(
    `Could not select facility: ${course}`
  );

  return false;
}

// ======================================================
// BOOKING MODE
// ======================================================

async function chooseBookingMode(
  page,
  mode
) {
  console.log(
    `Booking mode: ${mode}`
  );

  const current =
    (
      await pageText(page)
    )
      .toLowerCase();

  if (
    current.includes(
      `booking as ${mode.toLowerCase()}`
    )
  ) {
    return true;
  }

  if (
    current.includes(
      "booking as"
    ) &&
    current.includes(
      "change"
    )
  ) {
    await clickText(
      page,
      "Change"
    );

    await page.waitForTimeout(
      1200
    );
  }

  const clicked =
    await clickText(
      page,
      mode
    );

  if (!clicked) {
    return false;
  }

  await page.waitForTimeout(
    1500
  );

  return true;
}

// ======================================================
// LOGIN
// ======================================================

async function loginIfNeeded(
  page
) {
  const body =
    (
      await pageText(page)
    )
      .toLowerCase();

  if (
    body.includes(
      "my account"
    ) &&
    body.includes(
      "logout"
    )
  ) {
    console.log(
      "Already logged in."
    );

    return true;
  }

  const email =
    (
      process.env
        .MONMOUTH_EMAIL ||

      process.env
        .MONMOUTH_USERNAME ||

      ""
    )
      .trim();

  const password =
    (
      process.env
        .MONMOUTH_PASSWORD ||

      ""
    )
      .trim();

  if (
    !email ||
    !password
  ) {
    throw new Error(
      "Monmouth login secret is missing."
    );
  }

  let emailBox =
    page
      .getByPlaceholder(
        "Email"
      )
      .first();

  if (
    !(await emailBox.count())
  ) {
    emailBox =
      page
        .locator(
          'input[type="email"]:visible'
        )
        .first();
  }

  let passwordBox =
    page
      .getByPlaceholder(
        "Password"
      )
      .first();

  if (
    !(await passwordBox.count())
  ) {
    passwordBox =
      page
        .locator(
          'input[type="password"]:visible'
        )
        .first();
  }

  if (
    !(await emailBox.count()) ||
    !(await passwordBox.count())
  ) {
    throw new Error(
      "Login form was not found."
    );
  }

  await emailBox.fill(
    email
  );

  await passwordBox.fill(
    password
  );

  const clicked =
    await clickText(
      page,
      "Log In"
    );

  if (!clicked) {
    throw new Error(
      "Log In button was not found."
    );
  }

  const deadline =
    Date.now() +
    15000;

  while (
    Date.now() <
    deadline
  ) {
    await page.waitForTimeout(
      700
    );

    const text =
      (
        await pageText(page)
      )
        .toLowerCase();

    if (
      text.includes(
        "my account"
      ) &&
      text.includes(
        "logout"
      )
    ) {
      console.log(
        "Login successful."
      );

      return true;
    }

    if (
      text.includes(
        "captcha"
      ) ||
      text.includes(
        "verify you are human"
      )
    ) {
      throw new Error(
        "Human verification appeared."
      );
    }
  }

  throw new Error(
    "Login did not complete."
  );
}

// ======================================================
// SET DATE
// ======================================================

async function setDate(
  page
) {
  const wanted =
    foreupDateValue();

  console.log(
    `Setting date: ${wanted}`
  );

  const inputs =
    page.locator(
      "input:visible"
    );

  const count =
    await inputs.count();

  for (
    let i = 0;
    i < count;
    i++
  ) {
    const input =
      inputs.nth(i);

    try {
      const value =
        await input
          .inputValue();

      const placeholder =
        (
          await input
            .getAttribute(
              "placeholder"
            )
        ) || "";

      const type =
        (
          await input
            .getAttribute(
              "type"
            )
        ) || "";

      const looksDate =
        /^\d{2}-\d{2}-\d{4}$/
          .test(value) ||

        /date/i
          .test(
            placeholder
          ) ||

        type ===
          "date";

      if (!looksDate) {
        continue;
      }

      if (
        type ===
        "date"
      ) {
        await input.fill(
          SETTINGS.date
        );

      } else {
        await input.fill(
          wanted
        );
      }

      await input
        .press("Enter")
        .catch(() => {});

      await input
        .press("Tab")
        .catch(() => {});

      await page.waitForTimeout(
        2500
      );

      const now =
        await input
          .inputValue();

      if (
        now === wanted ||
        now === SETTINGS.date
      ) {
        return true;
      }

    } catch (_) {}
  }

  return false;
}

// ======================================================
// PARSE TEE TIMES
// ======================================================

function parseTeeTimes(
  text
) {
  const lines =
    text
      .split(
        /\r?\n/
      )
      .map(
        s =>
          s
            .replace(
              /\u00a0/g,
              " "
            )
            .trim()
      )
      .filter(Boolean);

  const timeRx =
    /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

  const earliest =
    timeToMinutes(
      SETTINGS.earliest
    );

  const latest =
    timeToMinutes(
      SETTINGS.latest
    );

  const results =
    [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    if (
      !timeRx.test(
        lines[i]
      )
    ) {
      continue;
    }

    const time =
      normalizeTime(
        lines[i]
      );

    const mins =
      timeToMinutes(
        time
      );

    if (
      mins === null ||
      mins < earliest ||
      mins > latest
    ) {
      continue;
    }

    const blockLines =
      [];

    for (
      let j = i + 1;
      j < lines.length &&
      j <= i + 8;
      j++
    ) {
      if (
        timeRx.test(
          lines[j]
        )
      ) {
        break;
      }

      blockLines.push(
        lines[j]
      );
    }

    const upper =
      blockLines.map(
        x =>
          x.toUpperCase()
      );

    const numeric =
      blockLines
        .filter(
          x =>
            /^\d+$/
              .test(x)
        )
        .map(Number);

    const holes =
      numeric.includes(18)
        ? 18
        : numeric.includes(9)
          ? 9
          : null;

    const playerNumbers =
      numeric.filter(
        n =>
          n >= 1 &&
          n <= 4
      );

    const spots =
      playerNumbers.length
        ? playerNumbers[
            playerNumbers.length - 1
          ]
        : null;

    if (
      holes !==
      SETTINGS.holes
    ) {
      continue;
    }

    if (
      spots === null ||
      spots <
        SETTINGS.players
    ) {
      continue;
    }

    results.push({
      time,
      holes,
      spots,

      side:
        upper.includes(
          "FRONT"
        )
          ? "FRONT"
          : upper.includes(
              "BACK"
            )
            ? "BACK"
            : null,

      context:
        blockLines.join(
          " | "
        )
    });
  }

  const seen =
    new Set();

  return results.filter(
    t => {
      const key =
        `${t.time}|` +
        `${t.holes}|` +
        `${t.spots}|` +
        `${t.side || ""}`;

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

// ======================================================
// ALERT HISTORY
// ======================================================

function loadSeen() {
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

function saveSeen(
  seen
) {
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

// ======================================================
// NTFY
// ======================================================

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
    )
      .trim();

  if (!topic) {
    console.log(
      "NTFY_TOPIC not configured."
    );

    return false;
  }

  const headers = {
    Title:
      title,

    Priority:
      "high",

    Tags:
      "golf"
  };

  if (clickUrl) {
    headers.Click =
      clickUrl;
  }

  const response =
    await fetch(
      `https://ntfy.sh/${encodeURIComponent(topic)}`,

      {
        method:
          "POST",

        headers,

        body:
          message
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `ntfy HTTP ${response.status}`
    );
  }

  return true;
}

async function sendManualTest(
  mode
) {
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
      "Monmouth golf watcher test",

      `Watcher is running.
Date: ${SETTINGS.date}
Mode: ${mode}
Time: ${SETTINGS.earliest} - ${SETTINGS.latest}
Golfers: ${SETTINGS.players}
Courses: ${SETTINGS.courses.length}`
    );

    console.log(
      "Monmouth test phone notification sent."
    );

  } catch (error) {
    console.log(
      "Monmouth test notification failed:",
      error.message
    );
  }
}

async function sendNewAlerts(
  matches
) {
  const seen =
    loadSeen();

  let sentCount =
    0;

  for (
    const tee of matches
  ) {
    const key =
      [
        tee.course,
        tee.date,
        tee.time,
        tee.holes,
        tee.spots
      ]
        .join("|");

    if (
      seen[key]
    ) {
      console.log(
        `Already alerted: ${tee.course} ${tee.time}`
      );

      continue;
    }

    const message =
`${tee.course}
${tee.date} at ${tee.time}
${tee.holes} holes
${tee.spots} spot(s) available
Need ${SETTINGS.players} golfers

Tap to open ForeUp`;

    try {
      const ok =
        await sendNtfy(
          `Monmouth tee time: ${tee.time}`,
          message,
          tee.bookingUrl
        );

      if (ok) {
        seen[key] =
          new Date()
            .toISOString();

        sentCount++;

        console.log(
          `Phone alert sent: ${tee.course} ${tee.time}`
        );
      }

    } catch (error) {
      console.log(
        "Phone alert failed:",
        error.message
      );
    }
  }

  saveSeen(seen);

  return sentCount;
}

// ======================================================
// MAIN
// ======================================================

async function main() {
  const mode =
    bookingMode();

  console.log(
    "========================================"
  );

  console.log(
    "MONMOUTH COUNTY TEE TIME WATCHER"
  );

  console.log(
    "========================================"
  );

  console.log(
    `Today ET:  ${easternTodayYmd()}`
  );

  console.log(
    `Target:    ${SETTINGS.date}`
  );

  console.log(
    `Days away: ${daysFromToday()}`
  );

  console.log(
    `Mode:      ${mode}`
  );

  console.log(
    `Time:      ${SETTINGS.earliest} - ${SETTINGS.latest}`
  );

  console.log(
    `Golfers:   ${SETTINGS.players}`
  );

  console.log(
    `Courses:   ${SETTINGS.courses.length}`
  );

  await sendManualTest(
    mode
  );

  const browser =
    await chromium.launch({
      headless:
        true
    });

  const context =
    await browser.newContext({
      viewport: {
        width:
          1440,

        height:
          1000
      },

      locale:
        "en-US",

      timezoneId:
        "America/New_York"
    });

  const page =
    await context.newPage();

  const courseResults =
    [];

  try {
    await page.goto(
      START_URL,
      {
        waitUntil:
          "domcontentloaded",

        timeout:
          60000
      }
    );

    await page.waitForTimeout(
      4000
    );

    await selectFacility(
      page,
      "Hominy Hill"
    )
      .catch(
        () => {}
      );

    if (
      !(
        await chooseBookingMode(
          page,
          mode
        )
      )
    ) {
      throw new Error(
        `Could not choose booking mode: ${mode}`
      );
    }

    await page.waitForTimeout(
      1000
    );

    await loginIfNeeded(
      page
    );

    await page.waitForTimeout(
      3000
    );

    if (
      !(
        await chooseBookingMode(
          page,
          mode
        )
      )
    ) {
      throw new Error(
        `Could not confirm booking mode after login: ${mode}`
      );
    }

    for (
      const course
      of SETTINGS.courses
    ) {
      console.log("");
      console.log(
        "----------------------------------------"
      );
      console.log(
        course
      );
      console.log(
        "----------------------------------------"
      );

      try {
        if (
          !(
            await selectFacility(
              page,
              course
            )
          )
        ) {
          throw new Error(
            "Facility selection failed."
          );
        }

        if (
          !(
            await setDate(
              page
            )
          )
        ) {
          throw new Error(
            "Could not set requested date."
          );
        }

        await page.waitForTimeout(
          3000
        );

        const text =
          await pageText(
            page
          );

        const matches =
          parseTeeTimes(
            text
          );

        console.log(
          `Found ${matches.length} qualifying tee time(s).`
        );

        for (
          const tee
          of matches
        ) {
          console.log(
            `${tee.time} | ${tee.holes} holes | ${tee.spots} spots`
          );
        }

        await saveDiagnostic(
          page,
          `monmouth_${course}`
        );

        courseResults.push({
          course,

          bookingUrl:
            page.url(),

          matches
        });

      } catch (error) {
        console.log(
          `ERROR for ${course}: ${error.message}`
        );

        await saveDiagnostic(
          page,
          `monmouth_${course}_error`
        );

        courseResults.push({
          course,

          bookingUrl:
            page.url(),

          error:
            error.message,

          matches:
            []
        });
      }
    }

  } catch (error) {
    console.log(
      "FATAL PAGE ERROR:",
      error.message
    );

    await saveDiagnostic(
      page,
      "monmouth_fatal"
    );

    throw error;

  } finally {
    await browser.close();
  }

  const matches =
    courseResults
      .flatMap(
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

  const alertsSent =
    await sendNewAlerts(
      matches
    );

  fs.writeFileSync(
    "monmouth-results.json",

    JSON.stringify(
      {
        checkedAt:
          new Date()
            .toISOString(),

        todayET:
          easternTodayYmd(),

        mode,

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

  console.log(
    `Qualifying tee times: ${matches.length}`
  );

  console.log(
    `New phone alerts sent: ${alertsSent}`
  );

  console.log(
    "Saved monmouth-results.json"
  );
}

main()
  .catch(
    error => {
      console.error(
        "FATAL ERROR:",
        error.message
      );

      process.exit(1);
    }
  );