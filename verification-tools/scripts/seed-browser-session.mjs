#!/usr/bin/env node
/**
 * Seeds an authenticated session into the Playwright MCP browser profile, so an agent can
 * drive an already-logged-in browser without ever being told a password.
 *
 * You run this. It reads the credentials locally, logs in through the real form, and exits.
 * The agent then opens the same Chrome profile and is already authenticated. Neither the
 * password nor any token passes through the conversation.
 *
 * Usage:
 *   node seed-browser-session.mjs --project <key> --persona <key> --url <login-url> [options]
 *
 * Options:
 *   --project <key>        Top-level key in ~/.claude/test-accounts.json (required)
 *   --persona <key>        Persona key under that project (required)
 *   --url <login-url>      Full URL of the login page (required)
 *   --email-selector <s>   Override the auto-detected email field
 *   --password-selector <s>  Override the auto-detected password field
 *   --submit-selector <s>  Override the auto-detected submit button
 *   --session-key <name>   localStorage key that proves a session (default: refreshToken)
 *   --profile <dir>        Browser profile directory (default: the Playwright MCP one)
 *   --timeout <ms>         Navigation/settle timeout (default: 30000)
 *   --headed               Show the browser (default: headless)
 *   --force                Log in again even if a session is already present
 *   --clear-stale-lock     Remove SingletonLock etc. when their owning process is dead
 *
 * Exit codes: 0 seeded (or already valid), 1 usage/config error, 2 profile busy, 3 login failed.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);

const EXIT = { ok: 0, usage: 1, busy: 2, login: 3 };

/** Prints a message to stderr and exits. Never include a secret in `message`. */
const die = (code, message, hint) => {
  process.stderr.write(`\n✗ ${message}\n`);
  if (hint) process.stderr.write(`\n  ${hint}\n`);
  process.stderr.write('\n');
  process.exit(code);
};

const log = (message) => process.stdout.write(`  ${message}\n`);

// ---------------------------------------------------------------- arguments

const parseArgs = (argv) => {
  const flags = new Set(['headed', 'force', 'clear-stale-lock']);
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    if (flags.has(name)) {
      out[name] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) die(EXIT.usage, `--${name} needs a value.`);
    out[name] = next;
    i += 1;
  }
  return out;
};

const args = parseArgs(process.argv.slice(2));

for (const required of ['project', 'persona', 'url']) {
  if (!args[required]) {
    die(
      EXIT.usage,
      `--${required} is required.`,
      'e.g. node seed-browser-session.mjs --project web-frontend --persona worker --url http://localhost:8200/login',
    );
  }
}

const sessionKey = args['session-key'] ?? 'refreshToken';
const timeout = Number(args.timeout ?? 30000);

// ---------------------------------------------------------------- playwright

/**
 * Finds an installed playwright-core. We never download a browser: the profile belongs to
 * real Chrome, so the launch uses `channel: 'chrome'` and only needs the driver library.
 */
const loadChromium = () => {
  const roots = [];
  if (process.env.PLAYWRIGHT_CORE_ROOT) roots.push(process.env.PLAYWRIGHT_CORE_ROOT);
  roots.push(HERE, path.join(HERE, '..'), process.cwd());

  // The Playwright MCP server installs its own copy under the npx cache.
  const npxCache = path.join(os.homedir(), '.npm', '_npx');
  if (fs.existsSync(npxCache)) {
    for (const entry of fs.readdirSync(npxCache)) {
      roots.push(path.join(npxCache, entry));
    }
  }

  for (const root of roots) {
    try {
      return require(require.resolve('playwright-core', { paths: [root] })).chromium;
    } catch {
      /* try the next candidate */
    }
  }

  return die(
    EXIT.usage,
    'Could not find playwright-core.',
    'Install it next to this script:  npm install --no-save playwright-core\n' +
      '  or point at an existing copy: PLAYWRIGHT_CORE_ROOT=/path/containing/node_modules',
  );
};

// ---------------------------------------------------------------- profile

const LOCK_NAMES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

/** Reads the PID out of Chrome's SingletonLock target, which looks like `host-12345`. */
const lockOwnerPidFor = (dir) => {
  try {
    const pid = Number(fs.readlinkSync(path.join(dir, 'SingletonLock')).split('-').pop());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

/** Locates the Playwright MCP Chrome profile, which carries a build-specific hash. */
const findMcpProfile = () => {
  const base = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright-mcp');
  const linuxBase = path.join(os.homedir(), '.cache', 'ms-playwright-mcp');
  const root = fs.existsSync(base) ? base : linuxBase;

  if (!fs.existsSync(root)) {
    die(
      EXIT.usage,
      'No Playwright MCP profile directory found.',
      'Let the agent open a browser once so the profile is created, then re-run. ' +
        'Or pass --profile <dir> explicitly.',
    );
  }

  const profiles = fs
    .readdirSync(root)
    .filter((name) => name.startsWith('mcp-chrome'))
    .map((name) => path.join(root, name));

  if (profiles.length === 0) die(EXIT.usage, `No mcp-chrome* profile inside ${root}.`, 'Pass --profile <dir>.');
  if (profiles.length === 1) return profiles[0];

  /*
   * Several MCP versions leave several profiles behind. The one the agent is actually using
   * is the one Chrome still holds a live lock on; failing that, the one touched most
   * recently. Refusing to choose would be safer but is useless in the common case, so the
   * choice is printed instead.
   */
  const live = profiles.find((dir) => {
    const pid = lockOwnerPidFor(dir);
    return pid !== null && isAlive(pid);
  });

  const chosen =
    live ?? profiles.slice().sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

  const others = profiles.filter((dir) => dir !== chosen);
  log(`picked one of ${profiles.length} profiles: ${path.basename(chosen)} (${live ? 'live lock' : 'most recent'})`);
  log(`  ignoring: ${others.map((dir) => path.basename(dir)).join(', ')} — override with --profile`);

  return chosen;
};

const profileDir = args.profile ?? findMcpProfile();

const guardProfileLock = () => {
  const pid = lockOwnerPidFor(profileDir);
  if (pid === null) return;

  if (isAlive(pid)) {
    die(
      EXIT.busy,
      `That browser profile is in use by a running Chrome (pid ${pid}).`,
      'Chrome allows one process per profile. Ask the agent to close the browser ' +
        '(browser_close), or quit that Chrome window, then re-run.',
    );
  }

  if (!args['clear-stale-lock']) {
    die(
      EXIT.busy,
      `The profile holds a lock from a dead process (pid ${pid}).`,
      'Re-run with --clear-stale-lock to remove it.',
    );
  }

  for (const name of LOCK_NAMES) fs.rmSync(path.join(profileDir, name), { force: true });
  log(`cleared stale lock from dead pid ${pid}`);
};

// ---------------------------------------------------------------- credentials

const loadCredentials = () => {
  const file = path.join(os.homedir(), '.claude', 'test-accounts.json');

  if (!fs.existsSync(file)) {
    die(
      EXIT.usage,
      `No credentials file at ${file}.`,
      'Create it, chmod 600 it, and shape it like:\n' +
        '  { "<project>": { "<persona>": { "email": "you+dev@example.com", "password": "..." } } }',
    );
  }

  const mode = fs.statSync(file).mode & 0o777;
  if (mode & 0o077) log(`warning: ${file} is mode ${mode.toString(8)} — consider chmod 600`);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    die(EXIT.usage, `${file} is not valid JSON.`, error.message);
  }

  const account = parsed?.[args.project]?.[args.persona];
  if (!account?.email || !account?.password) {
    const projects = Object.keys(parsed ?? {});
    const personas = Object.keys(parsed?.[args.project] ?? {});
    die(
      EXIT.usage,
      `No email/password for ${args.project} → ${args.persona}.`,
      `projects: ${projects.join(', ') || '(none)'}\n  personas in "${args.project}": ${personas.join(', ') || '(none)'}`,
    );
  }

  return account;
};

// ---------------------------------------------------------------- login

/**
 * Finds the first selector that resolves to a visible element.
 *
 * Auto-detection is by input type rather than test id, so the script stays project-agnostic:
 * every login form has one email-ish field, one password field and one submit button.
 */
const firstVisible = async (page, selectors) => {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1500 })) return locator;
    } catch {
      /* try the next selector */
    }
  }
  return null;
};

const EMAIL_SELECTORS = [
  'input[type="email"]',
  'input[name="email"]',
  'input[formcontrolname="email"]',
  'input[autocomplete="username"]',
];
const PASSWORD_SELECTORS = ['input[type="password"]', 'input[formcontrolname="password"]'];
const SUBMIT_SELECTORS = ['button[type="submit"]', 'input[type="submit"]'];

const readSessionKey = (page) =>
  page.evaluate((key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }, sessionKey);

const main = async () => {
  log(`profile      ${profileDir}`);
  log(`login url    ${args.url}`);
  log(`account      ${args.project} → ${args.persona}`);

  guardProfileLock();
  const account = loadCredentials();
  const chromium = loadChromium();

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: !args.headed,
    viewport: { width: 1440, height: 900 },
  });

  let exitCode = EXIT.ok;

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(timeout);

    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout });

    const existing = await readSessionKey(page);

    if (existing && !args.force) {
      log(`already seeded — localStorage["${sessionKey}"] is present, and --force was not given`);
      return;
    }

    /*
     * A live session makes the app redirect straight off the login route, so the form never
     * renders and --force could never log in again. Clearing first is what makes --force mean
     * anything.
     */
    if (existing) {
      await context.clearCookies();
      await page.evaluate(() => {
        try {
          window.localStorage.clear();
          window.sessionStorage.clear();
        } catch {
          /* a locked-down browser can refuse; the reload below still applies */
        }
      });
      log('cleared the existing session because --force was given');
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout });
    }

    const emailCandidates = [args['email-selector'], ...EMAIL_SELECTORS].filter(Boolean);
    const passwordCandidates = [args['password-selector'], ...PASSWORD_SELECTORS].filter(Boolean);

    // A single-page app is still booting at domcontentloaded, so wait for the form itself.
    try {
      await page.waitForSelector(passwordCandidates.join(', '), { state: 'visible', timeout });
    } catch {
      /* fall through to the clearer diagnostic below */
    }

    const emailField = await firstVisible(page, emailCandidates);
    const passwordField = await firstVisible(page, passwordCandidates);

    if (!emailField || !passwordField) {
      exitCode = EXIT.login;
      const landed = new URL(page.url()).pathname;
      const redirected = landed !== new URL(args.url).pathname;
      // Not a die(): the finally block must still close the browser.
      process.stderr.write(
        `\n✗ Could not find the login fields on ${args.url}.\n` +
          (redirected
            ? `\n  The app redirected to ${landed} instead of showing the form, which usually means a session is still active.\n`
            : '\n  Pass --email-selector / --password-selector, or check the URL is the login page.\n') +
          '\n',
      );
      return;
    }

    await emailField.fill(account.email);
    await passwordField.fill(account.password);

    const submit = await firstVisible(page, [args['submit-selector'], ...SUBMIT_SELECTORS].filter(Boolean));
    if (submit) {
      await submit.click();
    } else {
      await passwordField.press('Enter');
    }

    const loginPath = new URL(args.url).pathname;
    try {
      await page.waitForURL((url) => new URL(url).pathname !== loginPath, { timeout });
    } catch {
      log('still on the login page after submitting');
    }

    const token = await readSessionKey(page);
    const landedOn = new URL(page.url()).pathname;

    if (!token && landedOn === loginPath) {
      exitCode = EXIT.login;
      process.stderr.write(
        '\n✗ Login did not take. Still on the login page and no session key was written.\n' +
          '\n  Re-run with --headed to watch it, and check the API host resolves from this machine.\n\n',
      );
      return;
    }

    // Deliberately reports only presence and length. The token itself is never printed.
    log(`landed on    ${landedOn}`);
    log(`session key  ${token ? `"${sessionKey}" set (${token.length} chars)` : `"${sessionKey}" absent`}`);
    if (!token) {
      log(`note: navigation succeeded but "${sessionKey}" is unset — pass --session-key if this app differs`);
    }
    process.stdout.write('\n✓ Profile seeded. The agent can now drive this browser already logged in.\n\n');
  } finally {
    await context.close();
    if (exitCode !== EXIT.ok) process.exit(exitCode);
  }
};

await main();
