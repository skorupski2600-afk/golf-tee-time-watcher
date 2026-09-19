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
// TIME
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

  if (ampm === "PM" && hour !== 12) {
    hour += 12;
  }

  if (ampm === "AM" && hour === 12) {
    hour = 0;
  }

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
// DATE
// ======================================================

function parseYmd(ymd) {
  const [y, m, d] =
    ymd.split("-").map(Number);

  return { y, m, d };
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
    ).formatToParts(
      new Date()
    );

  const values =
    Object.fromEntries(
      parts.map(
        part => [
          part.type,
          part.value
        ]
      )
    );

  return (
    `${values.year}-` +
    `${values.month}-` +
    `${values.day}`
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
      12
    );

  const b =
    Date.UTC(
      target.y,
      target.m - 1,
      target.d,
      12
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
    return "Resident Advanced Reservations";
  }

  throw new Error(
    "Target date is more than 30 days away."
  );
}

function foreupDateValue() {
  const { y, m, d } =
    parseYmd(
      SETTINGS.date
    );

  return (
    `${String(m).padStart(2, "0")}-` +
    `${String(d).padStart(2, "0")}-` +
    `${y}`
  );
}

// ======================================================
// PAGE HELPERS
// ======================================================

async function bodyText(page) {
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
    const text =
      await bodyText(page);

    fs.writeFileSync(
      `${safe}.txt`,
      text,
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

async function clickVisibleText(
  page,
  text
) {
  const patterns = [
    page.getByRole(
      "button",
      {
        name: text,
        exact: true
      }
    ),

    page.getByRole(
      "link",
      {
        name: text,
        exact: true
      }
    ),

    page.getByText(
      text,
      {
        exact: true
      }
    )
  ];

  for (
    const locator of patterns
  ) {
    const count =
      Math.min(
        await locator.count(),
        10
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
          force: true,
          timeout: 5000
        });

        return true;
      } catch (_) {}
    }
  }

  return false;
}

async function isLoggedIn(page) {
  const text =
    (
      await bodyText(page)
    ).toLowerCase();

  return (
    text.includes(
      "my account"
    ) &&
    text.includes(
      "logout"
    )
  );
}

// ======================================================
// LOGIN
// ======================================================

async function findLoginFields(page) {
  let email =
    page
      .getByPlaceholder(
        "Email"
      )
      .first();

  if (
    !(await email.count())
  ) {
    email =
      page
        .locator(
          'input[type="email"]:visible'
        )
        .first();
  }

  let password =
    page
      .getByPlaceholder(
        "Password"
      )
      .first();

  if (
    !(await password.count())
  ) {
    password =
      page
        .locator(
          'input[type="password"]:visible'
        )
        .first();
  }

  return {
    email,
    password
  };
}

async function login(page) {
  if (
    await isLoggedIn(page)
  ) {
    console.log(
      "Already logged in."
    );

    return true;
  }

  const emailValue =
    (
      process.env.MONMOUTH_EMAIL ||
      process.env.MONMOUTH_USERNAME ||
      ""
    ).trim();

  const passwordValue =
    (
      process.env.MONMOUTH_PASSWORD ||
      ""
    ).trim();

  if (
    !emailValue ||
    !passwordValue
  ) {
    throw new Error(
      "MONMOUTH_EMAIL or MONMOUTH_PASSWORD secret is missing."
    );
  }

  let fields =
    await findLoginFields(
      page
    );

  /*
    If the login modal is not already showing,
    attempt to trigger it using one of the
    reservation buttons.
  */

  if (
    !(await fields.email.count()) ||
    !(await fields.password.count())
  ) {
    console.log(
      "Login box not visible yet. Attempting to open it..."
    );

    const mode =
      bookingMode();

    const triggered =
      await clickVisibleText(
        page,
        mode
      );

    if (triggered) {
      await page.waitForTimeout(
        1500
      );
    }

    fields =
      await findLoginFields(
        page
      );
  }

  if (
    !(await fields.email.count()) ||
    !(await fields.password.count())
  ) {
    throw new Error(
      "Could not find ForeUp login fields."
    );
  }

  console.log(
    "Entering ForeUp login..."
  );

  await fields.email.fill(
    emailValue
  );

  await fields.password.fill(
    passwordValue
  );

  const clicked =
    await clickVisibleText(
      page,
      "Log In"
    );

  if (!clicked) {
    throw new Error(
      "Could not find Log In button."
    );
  }

  const deadline =
    Date.now() +
    20000;

  while (
    Date.now() <
    deadline
  ) {
    await page.waitForTimeout(
      750
    );

    if (
      await isLoggedIn(page)
    ) {
      console.log(
        "Login successful."
      );

      return true;
    }

    const text =
      (
        await bodyText(page)
      ).toLowerCase();

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
// BOOKING MODE
// ======================================================

async function chooseBookingMode(
  page,
  mode
) {
  console.log(
    `Wanted booking mode: ${mode}`
  );

  let text =
    await bodyText(page);

  if (
    text
      .toLowerCase()
      .includes(
        `booking as ${mode.toLowerCase()}`
      )
  ) {
    console.log(
      `Already booking as ${mode}.`
    );

    return true;
  }

  /*
    From your screenshot, once logged in
    the tee sheet has a Change button.
  */

  const changeClicked =
    await clickVisibleText(
      page,
      "Change"
    );

  if (changeClicked) {
    console.log(
      "Clicked Change."
    );

    await page.waitForTimeout(
      1500
    );
  }

  text =
    await bodyText(page);

  if (
    !text
      .toLowerCase()
      .includes(
        mode.toLowerCase()
      )
  ) {
    console.log(
      `Booking option "${mode}" is not visible.`
    );

    return false;
  }

  const clicked =
    await clickVisibleText(
      page,
      mode
    );

  if (!clicked) {
    return false;
  }

  await page.waitForTimeout(
    2500
  );

  const after =
    (
      await bodyText(page)
    ).toLowerCase();

  const success =
    after.includes(
      `booking as ${mode.toLowerCase()}`
    );

  console.log(
    success
      ? `Booking mode confirmed: ${mode}`
      : `Could not confirm booking mode: ${mode}`
  );

  return success;
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
    const select =
      selects.nth(i);

    try {
      const options =
        await select
          .locator("option")
          .allTextContents();

      const exact =
        options.find(
          option =>
            option
              .trim()
              .toLowerCase() ===
            course.toLowerCase()
        );

      if (!exact) {
        continue;
      }

      await select.selectOption({
        label:
          exact.trim()
      });

      await page.waitForTimeout(
        2500
      );

      console.log(
        `Facility selected: ${course}`
      );

      return true;

    } catch (_) {}
  }

  console.log(
    `Facility dropdown could not select ${course}.`
  );

  return false;
}

// ======================================================
// DATE
// ======================================================

async function setDate(page) {
  const wanted =
    foreupDateValue();

  console.log(
    `Setting date to ${wanted}`
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
        await input.inputValue();

      const type =
        (
          await input
            .getAttribute(
              "type"
            )
        ) || "";

      const placeholder =
        (
          await input
            .getAttribute(
              "placeholder"
            )
        ) || "";

      const looksLikeDate =
        /^\d{2}-\d{2}-\d{4}$/
          .test(value) ||
        /date/i.test(
          placeholder
        ) ||
        type === "date";

      if (!looksLikeDate) {
        continue;
      }

      if (
        type === "date"
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
        3000
      );

      console.log(
        "Date field updated."
      );

      return true;

    } catch (_) {}
  }

  console.log(
    "Could not find date field."
  );

  return false;
}

// ======================================================
// PLAYERS / HOLES
// ======================================================

async function setPlayersAndHoles(page) {
  /*
    Clicking these is safe: they only filter
    the tee-time list. No reservation is made.
  */

  await clickVisibleText(
    page,
    String(
      SETTINGS.players
    )
  ).catch(() => {});

  await page.waitForTimeout(
    700
  );

  await clickVisibleText(
    page,
    String(
      SETTINGS.holes
    )
  ).catch(() => {});

  await page.waitForTimeout(
    1200
  );
}

// ======================================================
// TEE TIME PARSER
// ======================================================

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

  const timeRegex =
    /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

  const earliest =
    timeToMinutes(
      SETTINGS.earliest
    );

  const latest =
    timeToMinutes(
      SETTINGS.latest
    );

  const matches = [];

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

    const time =
      normalizeTime(
        lines[i]
      );

    const minutes =
      timeToMinutes(
        time
      );

    if (
      minutes === null ||
      minutes < earliest ||
      minutes > latest
    ) {
      continue;
    }

    const details = [];

    for (
      let j = i + 1;
      j < lines.length &&
      j <= i + 8;
      j++
    ) {
      if (
        timeRegex.test(
          lines[j]
        )
      ) {
        break;
      }

      details.push(
        lines[j]
      );
    }

    const block =
      details.join(" | ");

    /*
      ForeUp tee cards in your screenshot expose
      values like:

      FRONT
      18
      4
    */

    const holeMatch =
      block.match(
        /(?:^|\D)(9|18)(?:\D|$)/
      );

    const holes =
      holeMatch
        ? Number(
            holeMatch[1]
          )
        : null;

    const numbers =
      details
        .map(
          item =>
            item.match(
              /^\d+$/
            )
        )
        .filter(Boolean)
        .map(
          match =>
            Number(
              match[0]
            )
        );

    const playerValues =
      numbers.filter(
        n =>
          n >= 1 &&
          n <= 4
      );

    const spots =
      playerValues.length
        ? playerValues[
            playerValues.length - 1
          ]
        : null;

    if (
      holes !== null &&
      holes !== SETTINGS.holes
    ) {
      continue;
    }

    if (
      spots !== null &&
      spots < SETTINGS.players
    ) {
      continue;
    }

    /*
      Since we intend to select the 4-player
      filter on ForeUp, a returned card can also
      be accepted even if its text extraction
      doesn't expose the icon's numeric value.
    */

    matches.push({
      time,
      holes:
        holes ||
        SETTINGS.holes,
      spots:
        spots ||
        SETTINGS.players,
      context:
        block
    });
  }

  const seen =
    new Set();

  return matches.filter(
    tee => {
      const key =
        `${tee.time}|${tee.holes}|${tee.spots}`;

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

function saveSeen(seen) {
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
      process.env.NTFY_TOPIC ||
      ""
    ).trim();

  if (!topic) {
    console.log(
      "NTFY_TOPIC not configured."
    );

    return false;
  }

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
      `https://ntfy.sh/${encodeURIComponent(topic)}`,
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

async function sendManualTest(mode) {
  if (
    process.env.GITHUB_EVENT_NAME !==
    "workflow_dispatch"
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
Golfers: ${SETTINGS.players}`
    );

    console.log(
      "Monmouth test phone notification sent."
    );
  } catch (error) {
    console.log(
      "Test notification failed:",
      error.message
    );
  }
}

async function sendNewAlerts(matches) {
  const seen =
    loadSeen();

  let count = 0;

  for (const tee of matches) {
    const key =
      [
        tee.course,
        tee.date,
        tee.time,
        tee.holes,
        tee.spots
      ].join("|");

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
Available for ${SETTINGS.players} golfers

Tap to open ForeUp`;

    try {
      const sent =
        await sendNtfy(
          `Monmouth tee time: ${tee.time}`,
          message,
          tee.bookingUrl
        );

      if (sent) {
        seen[key] =
          new Date()
            .toISOString();

        count++;

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

  saveSeen(seen);

  return count;
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
      headless: true
    });

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

  const courseResults = [];

  try {
    console.log(
      "Opening ForeUp..."
    );

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

    /*
      NEW ORDER:
      Login first.
    */

    await login(page);

    await page.waitForTimeout(
      3000
    );

    /*
      Then choose the correct booking mode.
    */

    const modeSet =
      await chooseBookingMode(
        page,
        mode
      );

    if (!modeSet) {
      throw new Error(
        `Could not set booking mode to ${mode}.`
      );
    }

    /*
      Then cycle through the four courses.
    */

    for (
      const course
      of SETTINGS.courses
    ) {
      console.log("");
      console.log(
        "----------------------------------------"
      );
      console.log(course);
      console.log(
        "----------------------------------------"
      );

      try {
        const selected =
          await selectFacility(
            page,
            course
          );

        if (!selected) {
          throw new Error(
            "Could not select facility."
          );
        }

        const dateSet =
          await setDate(page);

        if (!dateSet) {
          throw new Error(
            "Could not set target date."
          );
        }

        await setPlayersAndHoles(
          page
        );

        await page.waitForTimeout(
          2500
        );

        const text =
          await bodyText(page);

        const matches =
          parseTeeTimes(text);

        console.log(
          `Qualifying tee times: ${matches.length}`
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
          matches: []
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
}

main().catch(
  error => {
    console.error(
      "FATAL ERROR:",
      error.message
    );

    process.exit(1);
  }
);