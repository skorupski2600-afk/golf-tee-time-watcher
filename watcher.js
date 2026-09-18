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

function timeToMinutes(value) {
  const m = String(value).trim().toUpperCase().match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);
  if (!m) return null;

  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = m[3];

  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  return hour * 60 + minute;
}

function normalizeTime(value) {
  const m = String(value).trim().toUpperCase().match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);

  if (!m) return null;

  return `${Number(m[1])}:${m[2]} ${m[3]}`;
}

function targetParts() {
  const [year, month, day] = SETTINGS.date.split("-").map(Number);

  return {
    year,
    month,
    day
  };
}

function targetDateObject() {
  const {
    year,
    month,
    day
  } = targetParts();

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

  const weekday = d.toLocaleDateString(
    "en-US",
    {
      weekday: "short"
    }
  );

  const month = d.toLocaleDateString(
    "en-US",
    {
      month: "short"
    }
  );

  return `${weekday}, ${month} ${d.getDate()}`;
}

function targetMonthYearText() {
  const d = targetDateObject();

  const month = d.toLocaleDateString(
    "en-US",
    {
      month: "long"
    }
  );

  return `${month}${d.getFullYear()}`;
}

function parseDisplayedDate(text) {
  const patterns = [
    /Showing\s+(?:Hot Deals|Tee Times)\s+for:[\s\S]*?\bon\s+([A-Z][a-z]{2}),\s+([A-Z][a-z]{2})\s+(\d{1,2})/i,

    /\b([A-Z][a-z]{2}),\s+([A-Z][a-z]{2})\s+(\d{1,2})\b/
  ];

  for (const rx of patterns) {
    const m = text.match(rx);

    if (m) {
      return `${m[1]}, ${m[2]} ${Number(m[3])}`;
    }
  }

  return null;
}

async function bodyText(page) {
  return await page
    .locator("body")
    .innerText();
}

async function displayedDate(page) {
  return parseDisplayedDate(
    await bodyText(page)
  );
}

async function isCorrectDate(page) {
  const shown =
    await displayedDate(page);

  const wanted =
    expectedDateText();

  console.log(
    `  GolfNow date shown: ${shown || "not detected"}`
  );

  console.log(
    `  Date wanted:       ${wanted}`
  );

  return shown === wanted;
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
      const button =
        page
          .getByRole(
            "button",
            {
              name
            }
          )
          .first();

      if (
        await button.count() &&
        await button.isVisible()
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

async function waitForCorrectDate(
  page,
  milliseconds = 6000
) {
  const deadline =
    Date.now() + milliseconds;

  while (
    Date.now() < deadline
  ) {
    if (
      await isCorrectDate(page)
    ) {
      return true;
    }

    await page.waitForTimeout(
      750
    );
  }

  return false;
}

async function clickTargetDay(page) {
  const {
    day
  } = targetParts();

  console.log(
    `  Looking for calendar day ${day}...`
  );

  /*
    GolfNow shows the calendar directly
    on the individual course page.

    We deliberately DO NOT click Search.
  */

  const exactDays =
    page.getByText(
      String(day),
      {
        exact: true
      }
    );

  const count =
    await exactDays.count();

  console.log(
    `  Found ${count} exact day-${day} element(s).`
  );

  /*
    Start at the last matching element.

    This helps if the calendar happens to
    contain duplicate numbers from an
    adjacent month.
  */

  for (
    let i = count - 1;
    i >= 0;
    i--
  ) {
    try {
      const dayNode =
        exactDays.nth(i);

      if (
        !(await dayNode.isVisible())
      ) {
        continue;
      }

      const box =
        await dayNode.boundingBox();

      if (!box) {
        continue;
      }

      console.log(
        `  Clicking day ${day}, candidate ${i + 1}...`
      );

      try {
        await dayNode.click({
          force: true,
          timeout: 3000
        });

      } catch (_) {
        /*
          Sometimes the number itself is text
          inside a clickable parent cell.
        */

        await dayNode
          .locator("..")
          .click({
            force: true,
            timeout: 3000
          });
      }

      await page.waitForTimeout(
        1500
      );

      return true;

    } catch (_) {}
  }

  return false;
}

async function clickViewTeeTimes(page) {
  console.log(
    "  Looking for this course's View Tee Times control..."
  );

  const candidates = [
    page.getByRole(
      "button",
      {
        name: /view tee times/i
      }
    ),

    page.getByRole(
      "link",
      {
        name: /view tee times/i
      }
    ),

    page.getByText(
      /view tee times/i,
      {
        exact: true
      }
    )
  ];

  for (
    const locator of candidates
  ) {
    const count =
      Math.min(
        await locator.count(),
        5
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
          timeout: 4000
        });

        await page.waitForTimeout(
          3500
        );

        console.log(
          "  Clicked View Tee Times."
        );

        return true;

      } catch (_) {}
    }
  }

  console.log(
    "  View Tee Times control not found."
  );

  return false;
}

async function setCourseDate(page) {
  /*
    If the correct date is already loaded,
    do nothing.
  */

  if (
    await isCorrectDate(page)
  ) {
    console.log(
      "  Correct date already loaded."
    );

    return true;
  }

  /*
    From your GolfNow results, the calendar
    is already rendered directly on the
    individual course page.
  */

  const pageText =
    await bodyText(page);

  const monthYear =
    targetMonthYearText();

  if (
    !pageText
      .replace(/\s+/g, "")
      .includes(
        monthYear.replace(/\s+/g, "")
      )
  ) {
    console.log(
      `  Target month ${monthYear} is not visible on this course page.`
    );

    return false;
  }

  /*
    Select the target day.
  */

  if (
    !(await clickTargetDay(page))
  ) {
    console.log(
      "  Could not click the requested calendar day."
    );

    return false;
  }

  /*
    First see whether GolfNow automatically
    reloads the course's tee times after
    clicking the calendar day.
  */

  if (
    await waitForCorrectDate(
      page,
      4500
    )
  ) {
    console.log(
      "  SUCCESS: date changed on the course page without leaving it."
    );

    return true;
  }

  /*
    If clicking the date only staged the
    selection, use the COURSE-SPECIFIC
    View Tee Times control.

    DO NOT click GolfNow Search.
  */

  if (
    await clickViewTeeTimes(page)
  ) {
    /*
      Safety check.

      If GolfNow somehow sends us to the
      generic tee-time search page again,
      reject it immediately.
    */

    if (
      page.url().includes(
        "/tee-times/search"
      )
    ) {
      console.log(
        "  GolfNow left the course page for generic search."
      );

      console.log(
        "  Rejecting this result to prevent false alerts."
      );

      return false;
    }

    if (
      await waitForCorrectDate(
        page,
        5000
      )
    ) {
      console.log(
        "  SUCCESS: date changed and the course page was preserved."
      );

      return true;
    }
  }

  console.log(
    "  FAILED: requested date was not confirmed on this course page."
  );

  return false;
}

function normalizePrice(raw) {
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
    Normal:
    $79.00
  */

  if (
    cleaned.includes(".")
  ) {
    const n =
      Number(cleaned);

    return Number.isFinite(n)
      ? `$${n.toFixed(2)}`
      : null;
  }

  /*
    GolfNow sometimes exposes superscript
    cents as:

    $8900

    instead of:

    $89.00
  */

  if (
    cleaned.length >= 3
  ) {
    return (
      `$${Number(
        cleaned.slice(
          0,
          -2
        )
      )}.` +
      cleaned.slice(-2)
    );
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

  const timeRx =
    /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

  const matches = [];

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

    const teeTime =
      normalizeTime(
        lines[i]
      );

    const teeMinutes =
      timeToMinutes(
        teeTime
      );

    if (
      teeMinutes === null ||
      teeMinutes < earliest ||
      teeMinutes > latest
    ) {
      continue;
    }

    /*
      Collect the details underneath
      this tee time.
    */

    const details = [];

    for (
      let j = i + 1;
      j < lines.length &&
      j <= i + 16;
      j++
    ) {
      if (
        timeRx.test(
          lines[j]
        )
      ) {
        break;
      }

      if (
        /^(More|More Hot Deals|Tee Details)$/i.test(
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
      Ignore sold tee times.
    */

    if (
      /\bSOLD\b/i.test(
        block
      )
    ) {
      continue;
    }

    /*
      GolfNow examples:

      18 / 1-4
      18 / 1
      18 / 1-2

      First number = holes.
      Range after slash = available
      golfer quantity.
    */

    const playerMatch =
      block.match(
        /\b(9|18)\s*\/\s*(\d)(?:\s*-\s*(\d))?\b/
      );

    if (!playerMatch) {
      continue;
    }

    const holes =
      Number(
        playerMatch[1]
      );

    const minGolfers =
      Number(
        playerMatch[2]
      );

    const maxGolfers =
      Number(
        playerMatch[3] ||
        playerMatch[2]
      );

    /*
      If you need 4 golfers:

      1-4 = valid
      2-4 = valid
      1-2 = invalid
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
      Find GolfNow price.
    */

    const priceMatch =
      block.match(
        /\$\s*[\d.,]+/
      );

    const pricePerPerson =
      normalizePrice(
        priceMatch
          ? priceMatch[0]
          : null
      );

    /*
      Because you specifically want the
      price per person, don't report a
      tee time unless its price was read.
    */

    if (
      !pricePerPerson
    ) {
      continue;
    }

    matches.push({
      time:
        teeTime,

      pricePerPerson,

      holes,

      minGolfers,

      maxGolfers,

      context:
        block
    });
  }

  /*
    Remove duplicates.
  */

  const seen =
    new Set();

  return matches.filter(
    tee => {
      const key =
        `${tee.time}|${tee.pricePerPerson}|${tee.holes}|${tee.maxGolfers}`;

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
      "  Opening course page..."
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
      await setCourseDate(
        page
      );

    await page.waitForTimeout(
      1800
    );

    const text =
      await bodyText(
        page
      );

    /*
      Save screenshot for troubleshooting.
    */

    await page.screenshot({
      path:
        `${safeName}.png`,

      fullPage:
        true
    });

    /*
      Save visible GolfNow text.
    */

    fs.writeFileSync(
      `${safeName}.txt`,
      text,
      "utf8"
    );

    /*
      Never trust results unless the
      requested date was confirmed.
    */

    if (
      !dateConfirmed
    ) {
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
      Extra protection against the Orlando
      problem from the previous version.
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

    if (
      !matches.length
    ) {
      console.log(
        `  No available tee times for ${SETTINGS.players} golfers between ${SETTINGS.earliest} and ${SETTINGS.latest}.`
      );

    } else {
      console.log(
        `  FOUND ${matches.length} qualifying tee time(s):`
      );

      for (
        const tee of matches
      ) {
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
        await bodyText(
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
      headless:
        true
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

  if (
    !matches.length
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

    process.exit(
      1
    );
  }
);
