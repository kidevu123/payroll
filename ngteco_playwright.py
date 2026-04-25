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
from datetime import date, datetime
from pathlib import Path

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


def _login(page, email: str, password: str) -> None:
    page.goto(LOGIN_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(800)
    email_box = page.locator('input[type="email"], input[name="email" i], input[autocomplete="username"]').first
    email_box.wait_for(state="visible", timeout=30000)
    email_box.fill(email)
    pw = page.locator('input[type="password"]').first
    pw.wait_for(state="visible", timeout=15000)
    pw.fill(password)
    _check_terms(page)
    login_btn = page.get_by_role("button", name=re.compile(r"^\s*Login\s*$", re.I))
    if login_btn.count() == 0:
        login_btn = page.locator("button:has-text('Login')").first
    login_btn.click()
    page.wait_for_function(
        "() => !String(window.location.href).includes('user/login')", timeout=120000
    )


def _set_records_per_page(page, n: str) -> None:
    page.get_by_text(re.compile(r"records per page", re.I)).first.wait_for(
        state="visible", timeout=60000
    )
    combo = page.get_by_label(re.compile(r"records per page", re.I))
    if combo.count():
        try:
            combo.select_option(label=n)
            return
        except PlaywrightError:
            pass
    for sel in (
        page.locator(".ant-pagination-options .ant-select").first,
        page.locator("div.ant-select").filter(has_text=re.compile(r"^(10|20|30|50|100)$")).first,
    ):
        if sel.count() and sel.is_visible():
            sel.click()
            page.wait_for_timeout(200)
            pick = page.locator(
                f".ant-select-item-option:has-text('{n}'), [role='option']:has-text('{n}')"
            ).first
            if pick.count():
                pick.click()
            else:
                page.get_by_text(n, exact=True).last.click()
            return
    raise RuntimeError("Could not set NGTeco records per page (footer dropdown)")


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
    _set_records_per_page(page, "50")
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

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=headless,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        try:
            _login(page, email, password)
            _shift_schedule_flow(page, dbg)
            _timecard_download(page, out_path, d0, d1, dbg)
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
