const { chromium } = require("playwright");
const fs = require("fs");

// ======================================================
// CHANGE ONLY THESE SETTINGS FOR A NEW SEARCH
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
// TIME HELPERS
// ======================================================

function timeToMinutes(value) {
  const match = String(value)
    .trim()
    .toUpperCase()
    .match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);

  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = match[3];

  if (ampm === "PM" && hour !== 12) {
    hour += 12;
  }

  if (ampm === "AM" && hour === 12) {
    hour = 0;
  }

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

// ======================================================
// DATE HELPERS
// ======================================================

function targetDateParts() {
  const [year, month, day] =
    SETTINGS.date.split("-").map(Number);

  return {
    year,
    month,
    day
  };
}

function targetDateObject() {
  const { year, month, day } =
    targetDateParts();

  return new Date(
    year,
    month - 1,
    day,
    12,
    0,
    0
  );
}

function targetMonthName() {
  return targetDateObject().toLocaleDateString(
    "en-US",
    {
      month: "long"
    }
  );
}

function targetMonthShort() {
  return targetDateObject().toLocaleDateString(
    "en-US",
    {
      month: "short"
    }
  );
}

function targetWeekdayShort() {
  return targetDateObject().toLocaleDateString(
    "en-US",
    {
      weekday: "short"
    }
  );
}

function expectedGolfNowDateText() {
  const { day } =
    targetDateParts();

  return `${targetWeekdayShort()}, ${targetMonthShort()} ${day}`;
}

// ======================================================
// PAGE HELPERS
// ======================================================

async function getPageText(page) {
  return await page
    .locator("body")
    .innerText();
}

async function dismissPrivacy(page) {
  const buttonNames = [
    /^continue$/i,
    /^accept all$/i,
    /^accept$/i,
    /^agree$/i
  ];

  for (const name of buttonNames) {
    try {
      const button =
        page
          .getByRole("button", {
            name
          })
          .first();

      if (
        await button.count() &&
        await button.isVisible()
      ) {
        await button.click();

        await page.waitForTimeout(
          800
        );

        return;
      }
    } catch (_) {}
  }
}

// ======================================================
// READ CURRENT GOLFNOW DATE
// ======================================================

function parseDisplayedGolfNowDate(text) {
  /*
    Handles both:

    Showing Hot Deals for:
    Old Bridge Golf Club on Fri, Sep 18

    AND:

    Showing Tee Times for:
    Course Name on Fri, Sep 18
  */

  const match = text.match(
    /Showing\s+(?:Hot Deals|Tee Times)\s+for:[\s\S]*?\bon\s+([A-Z][a-z]{2}),\s+([A-Z][a-z]{2})\s+(\d{1,2})/i
  );

  if (!match) {
    return null;
  }

  return {
    weekday: match[1],
    month: match[2],
    day: Number(match[3]),
    display:
      `${match[1]}, ${match[2]} ${Number(match[3])}`
  };
}

async function getDisplayedGolfNowDate(page) {
  const text =
    await getPageText(page);

  return parseDisplayedGolfNowDate(
    text
  );
}

async function confirmCorrectDate(page) {
  const displayed =
    await getDisplayedGolfNowDate(page);

  if (!displayed) {
    return false;
  }

  const expected =
    expectedGolfNowDateText();

  console.log(
    `GolfNow currently shows: ${displayed.display}`
  );

  console.log(
    `We need: ${expected}`
  );

  return displayed.display === expected;
}

// ======================================================
// GOLFNOW CALENDAR
// ======================================================

async function openGolfNowCalendar(page) {
  console.log(
    "Opening GolfNow calendar..."
  );

  /*
    Sometimes GolfNow already has the calendar open.
    If we can see the month and target day, don't click
    anything unnecessarily.
  */

  const monthText =
    targetMonthName();

  try {
    const visibleMonth =
      page.getByText(
        new RegExp(
          `^${monthText}\\s*2026$`,
          "i"
        )
      );

    const monthCount =
      await visibleMonth.count();

    for (
      let i = 0;
      i < monthCount;
      i++
    ) {
      if (
        await visibleMonth
          .nth(i)
          .isVisible()
      ) {
        console.log(
          "Calendar is already open."
        );

        return true;
      }
    }
  } catch (_) {}

  /*
    Try the compact date control such as SEP 18.
  */

  const controls = [
    page
      .getByText(
        /^[A-Z]{3}\s*\d{1,2}$/
      )
      .first(),

    page
      .locator(
        'input[placeholder*="date" i]'
      )
      .first(),

    page
      .locator(
        '[class*="date" i]'
      )
      .filter({
        hasText:
          /^[A-Z]{3}\s*\d{1,2}$/
      })
      .first()
  ];

  for (const control of controls) {
    try {
      if (
        await control.count() &&
        await control.isVisible()
      ) {
        await control.click({
          force: true
        });

        await page.waitForTimeout(
          1000
        );

        console.log(
          "Calendar opened."
        );

        return true;
      }
    } catch (_) {}
  }

  /*
    The calendar may still exist on the page even if
    no date-control click was necessary.
  */

  const body =
    await getPageText(page);

  if (
    body.includes(targetMonthName()) &&
    body.includes(String(targetDateParts().day))
  ) {
    console.log(
      "Calendar appears to already be visible."
    );

    return true;
  }

  console.log(
    "Could not open GolfNow calendar."
  );

  return false;
}

// ======================================================
// SELECT TARGET CALENDAR DAY
// ======================================================

async function clickTargetCalendarDay(page) {
  const { day } =
    targetDateParts();

  console.log(
    `Looking for calendar day ${day}...`
  );

  /*
    The latest GolfNow test showed calendar days as
    ordinary clickable text/cells, NOT accessible buttons.

    Therefore we find every exact visible "26" and try
    clicking each candidate until the page accepts it.
  */

  const candidates =
    page.getByText(
      String(day),
      {
        exact: true
      }
    );

  const count =
    await candidates.count();

  console.log(
    `Found ${count} exact "${day}" element(s).`
  );

  if (count === 0) {
    return false;
  }

  /*
    Start with the LAST candidate.
    This helps avoid dates shown from an adjacent month
    in some calendar layouts.
  */

  for (
    let i = count - 1;
    i >= 0;
    i--
  ) {
    const candidate =
      candidates.nth(i);

    try {
      if (
        !(await candidate.isVisible())
      ) {
        continue;
      }

      const box =
        await candidate.boundingBox();

      if (!box) {
        continue;
      }

      console.log(
        `Trying visible day ${day}, candidate ${i + 1}...`
      );

      /*
        First try clicking the date itself.
      */

      try {
        await candidate.click({
          force: true,
          timeout: 3000
        });
      } catch (_) {
        /*
          If the text itself isn't clickable,
          try its parent calendar cell.
        */

        try {
          await candidate
            .locator("..")
            .click({
              force: true,
              timeout: 3000
            });
        } catch (_) {
          continue;
        }
      }

      await page.waitForTimeout(
        800
      );

      console.log(
        `Clicked day ${day}.`
      );

      return true;

    } catch (error) {
      console.log(
        `Candidate ${i + 1} failed: ${error.message}`
      );
    }
  }

  return false;
}

// ======================================================
// CLICK SEARCH
// ======================================================

async function clickGolfNowSearch(page) {
  console.log(
    "Looking for GolfNow Search button..."
  );

  const searches =
    page.getByRole(
      "button",
      {
        name: /^search$/i
      }
    );

  const count =
    await searches.count();

  for (
    let i = 0;
    i < count;
    i++
  ) {
    try {
      const search =
        searches.nth(i);

      if (
        await search.isVisible()
      ) {
        console.log(
          "Clicking Search..."
        );

        await search.click({
          force: true
        });

        await page.waitForTimeout(
          4500
        );

        return true;
      }
    } catch (_) {}
  }

  /*
    Some GolfNow versions render Search as text rather
    than a normal accessible button.
  */

  const textSearch =
    page.getByText(
      "Search",
      {
        exact: true
      }
    );

  const textCount =
    await textSearch.count();

  for (
    let i = 0;
    i < textCount;
    i++
  ) {
    try {
      const search =
        textSearch.nth(i);

      if (
        await search.isVisible()
      ) {
        await search.click({
          force: true
        });

        await page.waitForTimeout(
          4500
        );

        return true;
      }
    } catch (_) {}
  }

  console.log(
    "Search button not found."
  );

  return false;
}

// ======================================================
// SET TARGET DATE
// ======================================================

async function setGolfNowDate(page) {
  /*
    If already correct, stop immediately.
  */

  if (
    await confirmCorrectDate(page)
  ) {
    console.log(
      "Correct date is already loaded."
    );

    return true;
  }

  const calendarOpened =
    await openGolfNowCalendar(page);

  if (!calendarOpened) {
    return false;
  }

  await page.waitForTimeout(
    500
  );

  const dateClicked =
    await clickTargetCalendarDay(page);

  if (!dateClicked) {
    console.log(
      "Could not click requested calendar date."
    );

    return false;
  }

  await page.waitForTimeout(
    700
  );

  await clickGolfNowSearch(page);

  /*
    Give GolfNow extra time to reload its tee sheet.
  */

  await page.waitForTimeout(
    3500
  );

  const success =
    await confirmCorrectDate(page);

  if (success) {
    console.log(
      `SUCCESS: GolfNow changed to ${expectedGolfNowDateText()}.`
    );
  } else {
    console.log(
      `FAILED: GolfNow did not change to ${expectedGolfNowDateText()}.`
    );
  }

  return success;
}

// ======================================================
// PRICE
// ======================================================

function normalizeGolfNowPrice(raw) {
  if (!raw) {
    return null;
  }

  const cleaned =
    raw.replace(
      /[^\d.]/g,
      ""
    );

  if (!cleaned) {
    return null;
  }

  /*
    Normal $79.00 format.
  */

  if (
    cleaned.includes(".")
  ) {
    const value =
      Number(cleaned);

    if (
      Number.isFinite(value)
    ) {
      return `$${value.toFixed(2)}`;
    }

    return null;
  }

  /*
    GolfNow's superscript cents can become:

    $7900

    when extracted as text.
  */

  if (
    cleaned.length >= 3
  ) {
    const cents =
      cleaned.slice(-2);

    const dollars =
      cleaned.slice(0, -2);

    return `$${Number(dollars)}.${cents}`;
  }

  return `$${Number(cleaned).toFixed(2)}`;
}

// ======================================================
// TEE TIME PARSER
// ======================================================

function parseTeeTimes(bodyText) {
  const lines =
    bodyText
      .split(/\r?\n/)
      .map(line =>
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

  const teeTimeRegex =
    /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

  const results = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    if (
      !teeTimeRegex.test(
        lines[i]
      )
    ) {
      continue;
    }

    const teeTime =
      normalizeTime(
        lines[i]
      );

    const teeMinutes =
      timeToMinutes(
        teeTime
      );

    /*
      Grab the text belonging to this tee-time card.
    */

    const details = [];

    for (
      let j = i + 1;
      j < lines.length &&
      j <= i + 15;
      j++
    ) {
      if (
        teeTimeRegex.test(
          lines[j]
        )
      ) {
        break;
      }

      if (
        /^More$/i.test(
          lines[j]
        ) ||
        /^More Hot Deals$/i.test(
          lines[j]
        ) ||
        /^Tee Details$/i.test(
          lines[j]
        )
      ) {
        break;
      }

      details.push(
        lines[j]
      );
    }

    const detailText =
      details.join(" | ");

    /*
      Ignore SOLD tee times.
    */

    if (
      /\bSOLD\b/i.test(
        detailText
      )
    ) {
      continue;
    }

    /*
      Must fall within requested time range.
    */

    if (
      teeMinutes === null ||
      teeMinutes < earliest ||
      teeMinutes > latest
    ) {
      continue;
    }

    /*
      GolfNow examples from the actual pages:

      18 / 1-4
      18 / 1-2

      First number = holes.
      Range after slash = golfers allowed.
    */

    const golferMatch =
      detailText.match(
        /\b(9|18)\s*\/\s*(\d)(?:\s*-\s*(\d))?\b/
      );

    if (!golferMatch) {
      continue;
    }

    const holes =
      Number(
        golferMatch[1]
      );

    const minGolfers =
      Number(
        golferMatch[2]
      );

    const maxGolfers =
      Number(
        golferMatch[3] ||
        golferMatch[2]
      );

    /*
      Example:
      Need 4 players.
      A 1-4 slot works.
      A 1-2 slot does not.
    */

    if (
      SETTINGS.players <
        minGolfers ||
      SETTINGS.players >
        maxGolfers
    ) {
      continue;
    }

    /*
      Price.
    */

    const priceMatch =
      detailText.match(
        /\$\s*[\d.,]+/
      );

    const pricePerPerson =
      normalizeGolfNowPrice(
        priceMatch
          ? priceMatch[0]
          : null
      );

    if (!pricePerPerson) {
      /*
        We do not report a time unless we can
        confidently extract its price.
      */

      continue;
    }

    results.push({
      time:
        teeTime,

      pricePerPerson,

      holes,

      minGolfers,

      maxGolfers,

      context:
        detailText
    });
  }

  /*
    Remove duplicates.
  */

  const seen =
    new Set();

  return results.filter(
    result => {
      const key =
        [
          result.time,
          result.pricePerPerson,
          result.holes,
          result.minGolfers,
          result.maxGolfers
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

  try {
    console.log(
      "Opening GolfNow..."
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
      await setGolfNowDate(
        page
      );

    /*
      Save screenshot and text whether it succeeds
      or fails. This lets us diagnose GolfNow changes.
    */

    await page.waitForTimeout(
      2000
    );

    const body =
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
      body,
      "utf8"
    );

    /*
      IMPORTANT:

      Never report tee times unless GolfNow's displayed
      date has been confirmed as the requested date.
    */

    if (!dateConfirmed) {
      console.log(
        "DATE NOT CONFIRMED."
      );

      console.log(
        "Ignoring this course to prevent false alerts."
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
        body
      );

    if (
      matches.length === 0
    ) {
      console.log(
        `No matching tee times for ${SETTINGS.players} golfers from ${SETTINGS.earliest} to ${SETTINGS.latest}.`
      );
    } else {
      console.log("");
      console.log(
        `FOUND ${matches.length} MATCHING TEE TIME(S)`
      );

      for (
        const tee of matches
      ) {
        console.log(
          `⛳ ${tee.time}`
        );

        console.log(
          `   ${tee.pricePerPerson} per person`
        );

        console.log(
          `   ${tee.holes} holes`
        );

        console.log(
          `   Accepts ${tee.minGolfers}-${tee.maxGolfers} golfers`
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

    /*
      Save whatever GolfNow displayed before failure.
    */

    try {
      const body =
        await getPageText(
          page
        );

      fs.writeFileSync(
        `${safeName}.txt`,
        body,
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

  const browser =
    await chromium.launch({
      headless:
        true
    });

  const courseResults =
    [];

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
    [];

  for (
    const result of courseResults
  ) {
    for (
      const tee of result.matches
    ) {
      matches.push({
        course:
          result.course,

        date:
          SETTINGS.date,

        bookingUrl:
          result.url,

        time:
          tee.time,

        pricePerPerson:
          tee.pricePerPerson,

        holes:
          tee.holes,

        minGolfers:
          tee.minGolfers,

        maxGolfers:
          tee.maxGolfers
      });
    }
  }

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
    matches.length === 0
  ) {
    console.log(
      "No qualifying available tee times detected."
    );

  } else {
    for (
      const tee of matches
    ) {
      console.log("");
      console.log(
        `⛳ ${tee.course}`
      );

      console.log(
        `   ${tee.date}`
      );

      console.log(
        `   ${tee.time}`
      );

      console.log(
        `   ${tee.pricePerPerson} per person`
      );

      console.log(
        `   ${tee.holes} holes`
      );

      console.log(
        `   ${tee.minGolfers}-${tee.maxGolfers} golfers`
      );

      console.log(
        `   ${tee.bookingUrl}`
      );
    }
  }

  /*
    Save everything for the GitHub artifact.
  */

  fs.writeFileSync(
    "results.json",

    JSON.stringify(
      {
        checkedAt:
          new Date().toISOString(),

        requestedDate:
          SETTINGS.date,

        earliest:
          SETTINGS.earliest,

        latest:
          SETTINGS.latest,

        players:
          SETTINGS.players,

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
