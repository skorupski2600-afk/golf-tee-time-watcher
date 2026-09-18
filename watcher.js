const { chromium } = require("playwright");
const fs = require("fs");

// ======================================================
// CHANGE THESE SETTINGS
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
    }
  ]
};

// ======================================================


function timeToMinutes(value) {
  const match = value
    .trim()
    .toUpperCase()
    .match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);

  if (!match) {
    return null;
  }

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


function extractTimes(text) {

  const earliest = timeToMinutes(SETTINGS.earliest);
  const latest = timeToMinutes(SETTINGS.latest);

  const regex =
    /\b(1[0-2]|0?[1-9]):([0-5]\d)\s*(AM|PM)\b/gi;

  const results = [];

  let match;

  while ((match = regex.exec(text)) !== null) {

    const display =
      `${match[1]}:${match[2]} ${match[3].toUpperCase()}`;

    const minutes = timeToMinutes(display);

    if (
      minutes !== null &&
      minutes >= earliest &&
      minutes <= latest
    ) {

      const start = Math.max(0, match.index - 150);
      const end = Math.min(
        text.length,
        match.index + 250
      );

      const context = text
        .substring(start, end)
        .replace(/\s+/g, " ")
        .trim();

      results.push({
        time: display,
        context: context
      });
    }
  }

  // Remove duplicates
  const seen = new Set();

  return results.filter(item => {

    const key = item.time;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}


async function clickPossibleTeeTimeButton(page) {

  const possibleNames = [
    /book tee time/i,
    /book a tee time/i,
    /tee times/i,
    /view tee times/i,
    /find tee times/i
  ];

  for (const name of possibleNames) {

    try {

      const button = page.getByRole("button", {
        name: name
      });

      if (
        await button.count() > 0 &&
        await button.first().isVisible()
      ) {

        console.log(
          "Clicking:",
          await button.first().innerText()
        );

        await button.first().click();

        await page.waitForTimeout(4000);

        return true;
      }

    } catch (error) {}

    try {

      const link = page.getByRole("link", {
        name: name
      });

      if (
        await link.count() > 0 &&
        await link.first().isVisible()
      ) {

        console.log(
          "Clicking:",
          await link.first().innerText()
        );

        await link.first().click();

        await page.waitForTimeout(4000);

        return true;
      }

    } catch (error) {}
  }

  return false;
}


async function trySetDate(page) {

  const date = SETTINGS.date;

  const selectors = [
    'input[type="date"]',
    'input[name*="date" i]',
    'input[id*="date" i]'
  ];

  for (const selector of selectors) {

    try {

      const inputs = page.locator(selector);

      const count = await inputs.count();

      for (let i = 0; i < count; i++) {

        const input = inputs.nth(i);

        if (await input.isVisible()) {

          console.log("Found date field.");

          await input.fill(date);

          await input.dispatchEvent("change");

          await page.waitForTimeout(3000);

          return true;
        }
      }

    } catch (error) {}
  }

  console.log(
    "Automatic date field was not found."
  );

  return false;
}


async function checkCourse(browser, course) {

  console.log("");
  console.log("==================================");
  console.log(course.name);
  console.log("==================================");

  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 1000
    },

    locale: "en-US",

    timezoneId: "America/New_York"
  });


  const page = await context.newPage();


  try {

    console.log("Opening GolfNow...");

    await page.goto(course.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });


    await page.waitForTimeout(5000);


    console.log(
      "Loaded:",
      page.url()
    );


    // Try cookie/privacy buttons
    const cookieButtons = [
      /accept all/i,
      /accept/i,
      /agree/i
    ];

    for (const name of cookieButtons) {

      try {

        const button =
          page.getByRole("button", {
            name: name
          });

        if (
          await button.count() &&
          await button.first().isVisible()
        ) {

          await button.first().click();

          await page.waitForTimeout(1000);

          break;
        }

      } catch (error) {}
    }


    await clickPossibleTeeTimeButton(page);


    await trySetDate(page);


    await page.waitForTimeout(4000);


    const body =
      await page.locator("body").innerText();


    const matches =
      extractTimes(body);


    const safeName =
      course.name
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase();


    await page.screenshot({
      path: `${safeName}.png`,
      fullPage: true
    });


    fs.writeFileSync(
      `${safeName}.txt`,
      body,
      "utf8"
    );


    if (matches.length === 0) {

      console.log(
        "No matching visible tee times found."
      );

    } else {

      console.log("");
      console.log(
        "POSSIBLE TEE TIMES FOUND:"
      );


      for (const match of matches) {

        console.log("");
        console.log(
          "⛳ " +
          course.name +
          " — " +
          match.time
        );

        console.log(
          match.context
        );
      }
    }


    return matches;

  } catch (error) {

    console.log(
      "ERROR:",
      error.message
    );

    return [];

  } finally {

    await context.close();

  }
}


async function main() {

  console.log("");
  console.log("GOLF TEE TIME WATCHER");
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


  const browser =
    await chromium.launch({
      headless: true
    });


  const allMatches = [];


  try {

    for (const course of SETTINGS.courses) {

      const matches =
        await checkCourse(
          browser,
          course
        );


      for (const match of matches) {

        allMatches.push({
          course: course.name,
          ...match
        });
      }
    }

  } finally {

    await browser.close();

  }


  console.log("");
  console.log("==================================");
  console.log("FINAL RESULTS");
  console.log("==================================");


  if (allMatches.length === 0) {

    console.log(
      "No qualifying tee times detected."
    );

  } else {

    for (const result of allMatches) {

      console.log(
        `${result.course}: ${result.time}`
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

        matches:
          allMatches
      },
      null,
      2
    )
  );
}


main().catch(error => {

  console.error(error);

  process.exit(1);

});
