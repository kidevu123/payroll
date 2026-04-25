"""
NGTeco office.ngteco.com — browser export (Playwright) for the payroll app.

Used by simple_app.fetch_ngteco_automated(). Requires:
  pip install playwright
  playwright install chromium

Set Gunicorn (or your WSGI server) to a long timeout (e.g. 300s) for /fetch_timecard.
"""

from __future__ import annotations

import re
import tempfile
from collections.abc import Callable
from datetime import date, datetime
from pathlib import Path
from typing import Optional

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

BASE = "https://office.ngteco.com"
LOGIN_URL = f"{BASE}/user/login"
SCHEDULE_URL = f"{BASE}/att/schedule"
TIMECARD_URL = f"{BASE}/att/timecard/timecard"


def _fmt_us(d: date) -> str:
    return d.strftime("%m/%d/%Y")


def _check_terms(page) -> None:
    candidates = [
        page.get_by_role("checkbox", name=re.compile(r"read and agree|USER AGREEMENT", re.I)),
        page.locator('label:has-text("USER AGREEMENT") input[type="checkbox"]').first,
        page.locator('span:has-text("USER AGREEMENT")')
        .locator("xpath=ancestor::label[1]//input[@type='checkbox']")
        .first,
        page.locator("input[type=checkbox]").first,
    ]
    for loc in candidates:
        try:
            if loc.count() == 0:
                continue
            loc.first.wait_for(state="visible", timeout=8000)
            loc.first.check()
            return
        except (PlaywrightTimeoutError, PlaywrightError):
            continue
    raise RuntimeError("Could not find the NGTeco terms/privacy checkbox — update ngteco_playwright._check_terms")


def _login(page, email: str, password: str, dbg: Path) -> None:
    """
    NGTeco login. The site is built with Ant Design / can change; we try many strategies.
    On failure, screenshots are written to dbg (e.g. ngteco_login_email_hunt.png).
    """
    page.set_default_timeout(120_000)
    page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=120_000)
    page.wait_for_timeout(1200)
    try:
        page.wait_for_load_state("networkidle", timeout=30_000)
    except (PlaywrightTimeoutError, PlaywrightError):
        pass
    # Optional debug
    try:
        page.screenshot(path=str(dbg / "ngteco_login_step1.png"), full_page=True)
    except Exception:
        pass

    def _try_fill_user(_root) -> bool:
        """Return True if we found and filled a user/email field in _root (page or Frame)."""
        # Role / label (Ant Design, etc.)
        for getter in (
            lambda: _root.get_by_role(
                "textbox", name=re.compile(r"e-?mail|user|account|log\s*in|phone|name", re.I)
            ),
            lambda: _root.get_by_label(re.compile(r"e-?mail|user|account|log\s*in|mail|phone", re.I)),
        ):
            try:
                loc = getter()
                n = loc.count() if loc else 0
                if n and loc.first.is_visible():
                    loc.first.clear()
                    loc.first.fill(email, timeout=20_000)
                    return True
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                pass
        # Attribute-based (most common in SPAs; order matters: specific before generic)
        user_selectors: tuple[str, ...] = (
            "input[type=\"email\"]",
            "input[autocomplete=\"email\" i]",
            "input[autocomplete=\"username\" i]",
            "input[autocomplete=\"off\" i]",
            "input[name=\"email\" i]",
            "input[name*=\"email\" i]",
            "input[name*=\"userName\" i]",
            "input[name*=\"username\" i]",
            "input[name*=\"user\" i]",
            "input[placeholder*=\"@\"]",
            "input[placeholder*=\"email\" i]",
            "input[placeholder*=\"user\" i]",
            "input[placeholder*=\"log\" i]",
            "#userName",
            "#username",
            "#email",
            "#login_email",
            "input#normal_login_email",
            "input#normal_login_username",
            "input.ant-input",
            "input[class*=\"ant-input\"]",
            "div.ant-pro-form input[type=\"text\"]:first-of-type",
        )
        for sel in user_selectors:
            try:
                loc = _root.locator(sel).first
                if loc.count() == 0:
                    continue
                if not loc.is_visible():
                    loc.wait_for(state="visible", timeout=10_000)
                loc.clear()
                loc.fill(email, timeout=15_000)
                return True
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                continue
        # First visible text field in a form (last resort, after others failed)
        try:
            f = _root.locator("form").first
            if f.count():
                t = f.locator("input[type=\"text\"], input:not([type])").first
                if t.count() and t.is_enabled():
                    t.wait_for(state="visible", timeout=5_000)
                    t.clear()
                    t.fill(email, timeout=15_000)
                    return True
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            pass
        return False

    def _try_fill_password(_root) -> bool:
        for getter in (
            lambda: _root.get_by_label(re.compile(r"pass", re.I)),
        ):
            try:
                loc = getter()
                if loc.count() and loc.first.is_visible():
                    loc.first.clear()
                    loc.first.fill(password, timeout=20_000)
                    return True
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                pass
        for sel in (
            "input[type=\"password\"]",
            "input[autocomplete=\"current-password\" i]",
        ):
            try:
                p = _root.locator(sel).first
                if p.count():
                    p.wait_for(state="visible", timeout=15_000)
                    p.clear()
                    p.fill(password, timeout=15_000)
                    return True
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                continue
        return False

    # Main frame, then iframes (login sometimes embedded in a frame)
    _roots: list = [page]
    _roots.extend(f for f in page.frames if f != page.main_frame)
    email_ok = False
    for root in _roots:
        if _try_fill_user(root):
            email_ok = True
            break
    if not email_ok:
        try:
            page.screenshot(path=str(dbg / "ngteco_login_email_hunt.png"), full_page=True)
        except Exception:
            pass
        raise RuntimeError(
            "Could not find a visible NGTeco email/user field — site layout may have changed, "
            "or the page is blocked for headless browsers. See screenshot "
            f"{dbg / 'ngteco_login_email_hunt.png'}"
        )
    pwd_ok = False
    for root in _roots:
        if _try_fill_password(root):
            pwd_ok = True
            break
    if not pwd_ok:
        try:
            page.screenshot(path=str(dbg / "ngteco_login_password_hunt.png"), full_page=True)
        except Exception:
            pass
        raise RuntimeError(
            "Could not find the password field on NGTeco login. "
            f"See {dbg / 'ngteco_login_password_hunt.png'}"
        )

    _check_terms(page)
    login_btn = page.get_by_role("button", name=re.compile(r"^\s*(Login|Sign\s*in|Log\s*in)\s*$", re.I))
    if login_btn.count() == 0:
        login_btn = page.get_by_role("button", name=re.compile(r"Login|Sign in", re.I))
    if login_btn.count() == 0:
        login_btn = page.locator("button:has-text('Login'), input[type=submit], button[type=submit]")
    if login_btn.count() == 0:
        try:
            page.screenshot(path=str(dbg / "ngteco_login_no_button.png"), full_page=True)
        except Exception:
            pass
        raise RuntimeError("Could not find the Login button")
    login_btn.first.click()
    page.wait_for_function(
        "() => !String(window.location.href).includes('user/login')", timeout=120_000
    )


def _ant_select_choose_n_in_open_overlay(page, n: str) -> bool:
    """
    Ant Design mounts the options list in a body-level portal (e.g. .ant-select-dropdown),
    not as a child of the pagination control.
    """
    page.wait_for_timeout(250)
    # Accessible listbox (some builds)
    try:
        lbx = page.get_by_role("listbox")
        if lbx.count():
            lbx.last.wait_for(state="visible", timeout=6000)
            t = lbx.get_by_text(n, exact=True)
            if t.count():
                t.first.scroll_into_view_if_needed()
                t.first.click()
                return True
    except (PlaywrightTimeoutError, PlaywrightError, Exception):
        pass
    # Class-based portal — usually the *last* dropdown is the one we just opened
    for sel in (
        ".ant-select-dropdown:not(.ant-select-hidden)",
        "div.rc-select-dropdown",
    ):
        d = page.locator(sel)
        if d.count() == 0:
            continue
        last = d.last
        try:
            last.wait_for(state="visible", timeout=8000)
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            continue
        for click_target in (
            last.locator(f"div[title='{n}']"),
            last.locator(".ant-select-item-option, .ant-select-item").filter(
                has_text=re.compile(rf"^\s*{re.escape(n)}\s*$")
            ),
            last.get_by_text(n, exact=True),
        ):
            try:
                c = click_target.first
                if c.count() == 0:
                    continue
                c.wait_for(state="visible", timeout=5000)
                c.scroll_into_view_if_needed()
                c.click()
                return True
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                continue
    return False


def _set_records_per_page(page, n: str, dbg: Path) -> None:
    """
    Ant Design pagination "page size" — open the footer select, then pick *n* in the portal
    overlay (not inside the pagination node).
    """
    page.wait_for_timeout(400)
    try:
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    except Exception:
        pass
    page.wait_for_timeout(500)
    try:
        page.locator(
            ".ant-pagination, .ant-table-pagination, .ant-table-wrapper .ant-pagination"
        ).first.wait_for(state="visible", timeout=120_000)
    except (PlaywrightTimeoutError, PlaywrightError):
        pass
    for pat in (
        re.compile(r"records per page", re.I),
        re.compile(r"per page", re.I),
        re.compile(r"page size", re.I),
        re.compile(r"条\s*/\s*页"),
    ):
        try:
            page.get_by_text(pat).first.wait_for(state="visible", timeout=10_000)
            break
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            continue
    combo = page.get_by_label(re.compile(r"records per page|per page|page size", re.I))
    if combo.count():
        try:
            combo.first.select_option(label=n)
            page.wait_for_timeout(600)
            return
        except PlaywrightError:
            pass

    def _all_trigger_locators() -> list:
        out: list = []
        for item in (
            page.locator(".ant-pagination-options-size-changer .ant-select-selector").first,
            page.locator(".ant-pagination-options .ant-select-selector").first,
            page.locator(".ant-pagination .ant-select-selector").first,
            page.locator(".ant-table-pagination .ant-select-selector").first,
        ):
            if item.count():
                out.append(item)
        pool = page.locator(
            ".ant-pagination-options .ant-select, .ant-pagination-options-size-changer .ant-select, "
            ".ant-pagination .ant-select, .ant-table-pagination .ant-select"
        )
        for i in range(min(pool.count(), 10)):
            out.append(pool.nth(i))
        return out

    for trig in _all_trigger_locators():
        try:
            if trig.count() == 0 or not trig.is_visible():
                continue
            try:
                trig.scroll_into_view_if_needed()
            except Exception:
                pass
            try:
                trig.click(timeout=12_000)
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                trig.click(force=True, timeout=12_000)
            page.wait_for_timeout(400)
            if _ant_select_choose_n_in_open_overlay(page, n):
                page.wait_for_timeout(600)
                return
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            pass
        try:
            page.keyboard.press("Escape")
        except Exception:
            pass
    try:
        page.screenshot(path=str(dbg / "ngteco_records_per_page.png"), full_page=True)
    except Exception:
        pass
    raise RuntimeError(
        "Could not set NGTeco records per page (footer dropdown) — see "
        f"{dbg / 'ngteco_records_per_page.png'}"
    )


def _select_all_table(page) -> None:
    header_cb = page.locator("thead input[type=checkbox], th input[type=checkbox]").first
    header_cb.wait_for(state="visible", timeout=30000)
    if not header_cb.is_checked():
        header_cb.check()


def _click_pie_chart_near_search(page, dbg: Path) -> None:
    search = page.get_by_placeholder(re.compile(r"Search by Person", re.I)).first
    search.wait_for(state="visible", timeout=30000)
    row = search.locator("xpath=ancestor::*[self::div or self::header or self::section][1]")
    for c in (
        row.locator("button").filter(has=page.locator("svg")).first,
        page.locator("button[title*='chart' i], button[aria-label*='chart' i]").first,
        page.get_by_role("button").filter(has=page.locator("svg")).nth(1),
    ):
        try:
            if c.count() and c.is_visible():
                c.click()
                page.wait_for_timeout(1500)
                return
        except PlaywrightError:
            pass
    shot = dbg / "ngteco_pie_hunt.png"
    page.screenshot(path=str(shot), full_page=True)
    raise RuntimeError(f"Could not find NGTeco pie/calc button (see {shot})")


def _shift_schedule_flow(page, dbg: Path) -> None:
    page.goto(SCHEDULE_URL, wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle", timeout=120000)
    _set_records_per_page(page, "50", dbg)
    page.wait_for_timeout(500)
    _select_all_table(page)
    _click_pie_chart_near_search(page, dbg)
    page.wait_for_timeout(3000)


def _timecard_download(
    page, out_path: Path, d_start: date, d_end: date, dbg: Path
) -> None:
    page.goto(TIMECARD_URL, wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle", timeout=120000)
    start_s, end_s = _fmt_us(d_start), _fmt_us(d_end)
    filled = False
    for selector in (
        "div.ant-picker-input input",
        ".ant-picker-range input",
        "[class*='DatePicker'] input",
    ):
        loc = page.locator(selector)
        if loc.count() >= 2:
            loc.nth(0).click()
            loc.nth(0).fill(start_s)
            loc.nth(1).click()
            loc.nth(1).fill(end_s)
            filled = True
            break
    if not filled:
        pair = page.locator("main input[type='text'], main input[readonly], form input[readonly]")
        if pair.count() >= 2:
            pair.nth(0).fill(start_s)
            pair.nth(1).fill(end_s)
            filled = True
    if not filled:
        shot = dbg / "ngteco_date_hunt.png"
        page.screenshot(path=str(shot), full_page=True)
        raise RuntimeError(f"Could not set NGTeco date range (see {shot})")
    page.wait_for_timeout(500)
    page.get_by_role("button", name=re.compile(r"Refresh", re.I)).first.click()
    page.wait_for_load_state("networkidle", timeout=120000)
    page.wait_for_timeout(1000)
    with page.expect_download(timeout=180000) as dl:
        d_btn = page.get_by_text("Download", exact=False).first
        d_btn.wait_for(state="visible", timeout=30000)
        d_btn.click()
        page.wait_for_timeout(300)
        csv_item = page.get_by_text("csv", exact=True).or_(
            page.get_by_text("csv with tz", exact=True)
        )
        csv_item.first.wait_for(state="visible", timeout=10000)
        csv_item.first.click()
    dl.value.save_as(str(out_path))


def fetch_ngteco_csv(
    email: str,
    password: str,
    start_date: str | date,
    end_date: str | date,
    *,
    debug_dir: Path | None = None,
    headless: bool = True,
    progress: Optional[Callable[[str, int], None]] = None,
) -> str:
    """
    Return raw CSV text from NGTeco timecard download (Shift & schedule + timecard flow).

    start_date / end_date: YYYY-MM-DD strings (from the Fetch Timecard form) or date objects.
    """
    if isinstance(start_date, str):
        d0 = datetime.strptime(start_date.strip()[:10], "%Y-%m-%d").date()
    else:
        d0 = start_date
    if isinstance(end_date, str):
        d1 = datetime.strptime(end_date.strip()[:10], "%Y-%m-%d").date()
    else:
        d1 = end_date
    if d1 < d0:
        raise ValueError("End date must be on or after start date")

    dbg = debug_dir or Path(tempfile.gettempdir()) / "ngteco_payroll"
    dbg.mkdir(parents=True, exist_ok=True)
    out_path = dbg / f"ngteco_dl_{d0}_{d1}.csv"

    def _report(step: str, pct: int) -> None:
        if not progress:
            return
        try:
            # Reserve 100% for the app worker after we return
            p = int(max(0, min(99, pct)))
            progress(step, p)
        except Exception:
            pass

    _report("Starting…", 1)

    with sync_playwright() as p:
        _report("Launching browser…", 5)
        browser = p.chromium.launch(
            headless=headless,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        try:
            _report("Opening NGTeco login…", 12)
            _login(page, email, password, dbg)
            _report("Signed in; running Shift & schedule…", 40)
            _shift_schedule_flow(page, dbg)
            _report("Loading Timecard and date range…", 68)
            _timecard_download(page, out_path, d0, d1, dbg)
            _report("Download complete", 95)
        except Exception:
            try:
                page.screenshot(path=str(dbg / "ngteco_error.png"), full_page=True)
            except Exception:
                pass
            raise
        finally:
            context.close()
            browser.close()

    text = out_path.read_text(encoding="utf-8", errors="replace")
    if text.startswith("\ufeff"):
        text = text.lstrip("\ufeff")
    return text
