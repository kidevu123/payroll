"""
NGTeco office.ngteco.com — browser export (Playwright) for the payroll app.

Used by simple_app.fetch_ngteco_automated(). Requires:
  pip install playwright
  playwright install chromium

Set Gunicorn (or your WSGI server) to a long timeout (e.g. 300s) for /fetch_timecard.
"""

from __future__ import annotations

import os
import re
import tempfile
import csv
from io import StringIO
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

# User-required absolute XPaths (validated against live NGTeco layout in this deployment).
XPATH_SHIFT_SCHEDULE_MENU = "/html/body/div[1]/div/div/div[1]/div[1]/div/div[5]/div[5]/div[2]/div/div/div/div/p[5]"
XPATH_SCHEDULE_RPP_TRIGGER = "/html/body/div[1]/div/div/div[2]/div/div[2]/div/div/div[3]/div/div[2]/div/div[2]/div"
XPATH_SCHEDULE_SELECT_ALL = "/html/body/div[1]/div/div/div[2]/div/div[2]/div/div/div[2]/div[1]/div/div/div[1]/div[1]/div/div/span/input"
XPATH_SCHEDULE_PIE = "/html/body/div[1]/div/div/div[2]/div/div[2]/div/div/div[1]/div/div[2]/div[1]/div[2]/div/div/svg"
XPATH_TIMECARD_MENU = "/html/body/div[1]/div/div/div[1]/div[1]/div/div[5]/div[5]/div[2]/div/div/div/div/p[6]"
XPATH_TIMECARD_START = "/html/body/div[1]/div/div/div[2]/div/div[2]/div/div/div[1]/div/div[2]/div[1]/div[2]/div/div/div[1]/div/div/input"
XPATH_TIMECARD_END = "/html/body/div[1]/div/div/div[2]/div/div[2]/div/div/div[1]/div/div[2]/div[1]/div[2]/div/div/div[2]/div/div/input"


def _fmt_us(d: date) -> str:
    return d.strftime("%m/%d/%Y")


def _matches_date_value(value: str, target: date) -> bool:
    """Return True when an input value represents target date across common UI formats."""
    raw = (value or "").strip()
    if not raw:
        return False
    # Keep only the first token in case controls append time/range text.
    token = re.split(r"\s+", raw)[0].strip()
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(token, fmt).date() == target
        except ValueError:
            continue
    return False


def _fill_single_date_input(loc, target: date, us_value: str) -> bool:
    """Fill one date input robustly and verify the final value was accepted by the UI."""
    iso_value = target.isoformat()
    for candidate in (us_value, iso_value):
        try:
            loc.fill(candidate, force=True, timeout=12_000)
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            try:
                loc.clear(timeout=5_000)
                loc.fill(candidate, timeout=12_000)
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                pass
        try:
            current = loc.input_value(timeout=2_000)
            if _matches_date_value(current, target):
                return True
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            pass
        try:
            loc.evaluate(
                """(el, val) => {
                    try { el.removeAttribute('readonly'); } catch (e) {}
                    try { el.focus(); } catch (e) {}
                    el.value = val;
                    for (const ev of ['input', 'change', 'blur']) {
                        el.dispatchEvent(new Event(ev, { bubbles: true }));
                    }
                }""",
                candidate,
            )
            current = loc.input_value(timeout=2_000)
            if _matches_date_value(current, target):
                return True
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            pass
    return False



def _parse_csv_date(value: str) -> date | None:
    token = (value or "").strip()
    if not token:
        return None
    token = re.split(r"\s+", token)[0].strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(token, fmt).date()
        except ValueError:
            continue
    return None


def _filter_csv_text_by_date_range(text: str, d0: date, d1: date) -> str:
    """
    Safety net: if NGTeco UI ignores date inputs, filter returned CSV rows by Date column.
    Keeps unparsable-date rows unchanged to avoid dropping unknown record types.
    """
    try:
        src = StringIO(text)
        reader = csv.DictReader(src)
        if not reader.fieldnames or "Date" not in reader.fieldnames:
            return text
        rows_out = []
        for row in reader:
            row_date = _parse_csv_date(row.get("Date", ""))
            if row_date is None or (d0 <= row_date <= d1):
                rows_out.append(row)
        buf = StringIO()
        writer = csv.DictWriter(buf, fieldnames=reader.fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows_out)
        return buf.getvalue()
    except Exception:
        return text


def _click_xpath_required(page, xpath: str, label: str, timeout: int = 20_000) -> None:
    loc = page.locator(f"xpath={xpath}").first
    if loc.count() == 0:
        raise RuntimeError(f"Required NGTeco element not found: {label}")
    try:
        loc.scroll_into_view_if_needed(timeout=timeout)
    except Exception:
        pass
    try:
        loc.click(timeout=timeout, force=True)
    except Exception as e:
        raise RuntimeError(f"Failed required NGTeco click: {label}") from e


def _click_schedule_pie(page, dbg: Path) -> None:
    """Click the schedule pie/calculate action using stable fallbacks before the legacy XPath."""
    custom = (os.environ.get("NGTECO_SCHEDULE_PIE_SELECTOR") or "").strip()
    candidates = []
    if custom:
        candidates.append(page.locator(custom).first)
    candidates.extend(
        [
            page.locator(f"xpath={XPATH_SCHEDULE_PIE}").first,
            page.locator('button:has(svg path[d^="M484.15"]):not([disabled])').first,
            page.locator('svg path[d^="M484.15"]').locator("xpath=ancestor::*[self::button or @role='button'][1]").first,
            page.locator('svg path[d^="M484.15"]').locator("xpath=ancestor::*[self::svg][1]").first,
            page.locator("button[title*='chart' i], button[aria-label*='chart' i], button[title*='calculate' i], button[aria-label*='calculate' i]").first,
            page.get_by_role("button", name=re.compile(r"chart|calculate|summary|pie", re.I)).first,
        ]
    )
    for candidate in candidates:
        try:
            if candidate.count() == 0:
                continue
            candidate.wait_for(state="attached", timeout=5_000)
            try:
                candidate.scroll_into_view_if_needed(timeout=5_000)
            except Exception:
                pass
            candidate.click(timeout=20_000, force=True)
            page.wait_for_timeout(1500)
            return
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            continue
    try:
        point = page.evaluate(
            """() => {
                const visibleBox = (el) => {
                    const r = el.getBoundingClientRect();
                    const s = window.getComputedStyle(el);
                    if (!r || r.width < 8 || r.height < 8 || s.visibility === 'hidden' || s.display === 'none') return null;
                    return r;
                };
                const inputs = Array.from(document.querySelectorAll('input[placeholder]'));
                const search = inputs.find((el) => /search\\s+by\\s+person/i.test(el.getAttribute('placeholder') || ''));
                if (!search) return null;
                const sr = visibleBox(search);
                if (!sr) return null;
                const cy = sr.top + sr.height / 2;
                const svgs = Array.from(document.querySelectorAll('svg'))
                    .map((el) => ({ el, r: visibleBox(el) }))
                    .filter((item) => item.r)
                    .filter((item) => {
                        const r = item.r;
                        const cx = r.left + r.width / 2;
                        const sy = r.top + r.height / 2;
                        return cx > sr.right + 4 && cx < sr.right + 90 && Math.abs(sy - cy) < 34;
                    })
                    .sort((a, b) => a.r.left - b.r.left);
                if (!svgs.length) return null;
                const r = svgs[0].r;
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }"""
        )
        if point:
            page.mouse.click(point["x"], point["y"])
            page.wait_for_timeout(1500)
            return
    except (PlaywrightTimeoutError, PlaywrightError, Exception):
        pass
    try:
        page.screenshot(path=str(dbg / "ngteco_schedule_pie_hunt.png"), full_page=True)
    except Exception:
        pass
    raise RuntimeError(
        "Could not find the NGTeco schedule pie/calculate button. "
        f"See {dbg / 'ngteco_schedule_pie_hunt.png'} or set NGTECO_SCHEDULE_PIE_SELECTOR."
    )


def _required_schedule_steps(page, dbg: Path) -> None:
    # Non-negotiable user flow: Shift & schedule -> 50 rows/page -> Select All -> Pie.
    _click_xpath_required(page, XPATH_SHIFT_SCHEDULE_MENU, "Shift & schedule menu")
    try:
        page.wait_for_load_state("networkidle", timeout=90_000)
    except Exception:
        pass
    _click_xpath_required(page, XPATH_SCHEDULE_RPP_TRIGGER, "Schedule records-per-page picker")
    _set_records_per_page(page, "50", dbg)

    sel = page.locator(f"xpath={XPATH_SCHEDULE_SELECT_ALL}").first
    if sel.count() == 0:
        raise RuntimeError("Required NGTeco element not found: Schedule Select All checkbox")
    try:
        sel.check(force=True, timeout=20_000)
    except Exception:
        try:
            sel.click(force=True, timeout=20_000)
        except Exception as e:
            raise RuntimeError("Failed required NGTeco click: Schedule Select All checkbox") from e

    _click_schedule_pie(page, dbg)


def _required_timecard_steps(page, d_start: date, d_end: date) -> bool:
    # Non-negotiable user flow: Timecard menu -> start/end exact fields.
    _click_xpath_required(page, XPATH_TIMECARD_MENU, "Timecard menu")
    try:
        page.wait_for_load_state("networkidle", timeout=90_000)
    except Exception:
        pass
    s = page.locator(f"xpath={XPATH_TIMECARD_START}").first
    e = page.locator(f"xpath={XPATH_TIMECARD_END}").first
    if s.count() == 0 or e.count() == 0:
        raise RuntimeError("Required NGTeco date inputs were not found for Timecard")
    return _fill_single_date_input(s, d_start, _fmt_us(d_start)) and _fill_single_date_input(
        e, d_end, _fmt_us(d_end)
    )
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


def _mui_table_pagination_native_select(page, n: str) -> bool:
    """MUI: some builds use a real <select> in TablePagination."""
    for loc in (
        page.locator(".MuiTablePagination-root select.MuiTablePagination-select"),
        page.locator(".MuiTablePagination-root select"),
        page.locator("select.MuiTablePagination-select"),
    ):
        if loc.count() == 0:
            continue
        s = loc.first
        try:
            if not s.is_visible():
                s.wait_for(state="visible", timeout=8000)
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            continue
        try:
            s.select_option(value=n, timeout=12_000)
            return True
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            continue
    return False


def _mui_click_pagination_page_size_option(page, n: str) -> bool:
    """
    MUI TablePagination: open menu is ul[role=listbox] with
    li.MuiTablePagination-menuItem[data-value=…] (not Ant Design).
    Use force=True — sticky footers or bars may intercept the hit target.
    """
    escaped = n.strip()
    selectors = (
        f'li.MuiTablePagination-menuItem[data-value="{escaped}"]',
        f'ul[role="listbox"] li[data-value="{escaped}"]',
        f'[role="listbox"] [role="option"][data-value="{escaped}"]',
    )
    for sel in selectors:
        loc = page.locator(sel)
        cnt = min(loc.count(), 6)
        for i in range(cnt):
            o = loc.nth(i)
            try:
                o.wait_for(state="visible", timeout=5000)
                o.scroll_into_view_if_needed()
                o.click(timeout=10_000, force=True)
                return True
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                continue
    # Last visible listbox (the menu we just opened is usually last)
    try:
        lbx = page.get_by_role("listbox")
        if lbx.count():
            lbx.last.wait_for(state="visible", timeout=5000)
            o = lbx.last.locator(f'[data-value="{escaped}"]')
            if o.count():
                o.first.scroll_into_view_if_needed()
                o.first.click(timeout=10_000, force=True)
                return True
    except (PlaywrightTimeoutError, PlaywrightError, Exception):
        pass
    # Click via DOM when something blocks pointer events
    try:
        did = page.evaluate(
            """
            (v) => {
            const s = String(v);
            const d = document;
            const direct = d.querySelector(
              'li.MuiTablePagination-menuItem[data-value="' + s + '"]'
            );
            if (direct) {
              direct.scrollIntoView({ block: 'center' });
              direct.click();
              return true;
            }
            const boxes = d.querySelectorAll('[role="listbox"]');
            for (let i = boxes.length - 1; i >= 0; i--) {
              const o = boxes[i].querySelector('[data-value="' + s + '"]');
              if (o) { o.scrollIntoView({ block: 'center' }); o.click(); return true; }
            }
            return false;
        }
        """,
            escaped,
        )
        if did:
            return True
    except Exception:
        pass
    return False


def _mui_table_pagination_open_size_menu_and_choose(page, n: str) -> bool:
    """MUI: click the page-size control inside .MuiTablePagination-root, then pick *n*."""
    roots = page.locator(".MuiTablePagination-root")
    if roots.count() == 0:
        return False
    root = roots.first
    if not root.is_visible():
        try:
            root.wait_for(state="visible", timeout=15_000)
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            return False
    triggers: list = []
    for tr_sel in (
        "div[role='combobox']",
        ".MuiTablePagination-select .MuiSelect-select",
        ".MuiTablePagination-select",
        ".MuiInputBase-root.MuiTablePagination-select",
    ):
        t = root.locator(tr_sel)
        for i in range(min(t.count(), 4)):
            triggers.append(t.nth(i))
    for tr in triggers:
        if tr.count() == 0:
            continue
        if not tr.is_visible():
            try:
                tr.wait_for(state="visible", timeout=3000)
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                continue
        for _attempt in (1, 2):
            try:
                tr.scroll_into_view_if_needed()
                if _attempt == 1:
                    tr.click(timeout=10_000)
                else:
                    tr.click(timeout=10_000, force=True)
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                continue
            page.wait_for_timeout(350)
            if _mui_click_pagination_page_size_option(page, n):
                return True
            try:
                page.keyboard.press("Escape")
            except Exception:
                pass
    return False


def _set_records_per_page(page, n: str, dbg: Path) -> None:
    """
    Set footer "rows per page" to *n*.

    NGTeco schedule uses MUI TablePagination: listbox is
    li.MuiTablePagination-menuItem[data-value=…] in a popover, not under Ant
    .ant-select-dropdown. Some themes still use Ant; we try MUI first, then
    the Ant / native fallbacks.
    """
    page.wait_for_timeout(400)
    try:
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    except Exception:
        pass
    page.wait_for_timeout(500)
    try:
        page.locator(
            ".MuiTablePagination-root, .ant-pagination, .ant-table-pagination, "
            ".ant-table-wrapper .ant-pagination"
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
    combo = page.get_by_label(
        re.compile(r"no\.\s*of\s*records|records per page|per page|page size", re.I)
    )
    if combo.count():
        try:
            combo.first.select_option(label=n)
            page.wait_for_timeout(600)
            return
        except PlaywrightError:
            pass

    if _mui_table_pagination_native_select(page, n):
        page.wait_for_timeout(600)
        return
    if _mui_table_pagination_open_size_menu_and_choose(page, n):
        page.wait_for_timeout(600)
        return

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


def _select_all_table(page, dbg: Path) -> None:
    """
    Check the 'select all rows' / header checkbox. NGTeco uses MUI, not a plain
    <table>; the input may be visibility:hidden (PrivateSwitchBase) and not
    under thead/th, so we try several MUI and role-based paths and use force
    when the native input is not 'visible' to Playwright.
    """
    custom = (os.environ.get("NGTECO_SELECT_ALL_SELECTOR") or "").strip()
    if custom:
        try:
            c = page.locator(custom)
            if c.count():
                c.first.wait_for(state="attached", timeout=8_000)
                c.first.scroll_into_view_if_needed()
                c.first.check(timeout=20_000, force=True)
                return
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            pass
    try:
        cb = page.get_by_role("checkbox", name=re.compile(r"^select all rows$", re.I))
        if cb.count():
            cb.first.check(timeout=20_000, force=True)
            return
    except (PlaywrightTimeoutError, PlaywrightError, Exception):
        pass
    page.wait_for_timeout(800)
    for container in (
        ".MuiDataGrid-main",
        ".MuiDataGrid-root",
        ".MuiTableContainer-root",
        "[role='grid']",
        "table",
    ):
        c = page.locator(container)
        if c.count() == 0:
            continue
        try:
            c.first.wait_for(state="visible", timeout=20_000)
            break
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            continue

    selector_groups: list[tuple[str, ...]] = [
        (
            "thead th input[type=checkbox], thead input[type=checkbox], th input[type=checkbox]",
        ),
        (
            ".MuiTableHead-root th input[type=checkbox], "
            ".MuiTableHead-root th .MuiCheckbox-root input, "
            ".MuiTableHead-root .MuiCheckbox-root input, "
            ".MuiTableHead-root .PrivateSwitchBase-input, "
            ".MuiTableHead input[type=checkbox]",
        ),
        (
            ".MuiDataGrid-columnHeaderCheckbox input[type=checkbox], "
            ".MuiDataGrid-columnHeaderCheckbox .MuiCheckbox-root input, "
            ".MuiDataGrid-columnHeader--checkbox input",
        ),
        (
            "[role=columnheader] input[type=checkbox], "
        ),
        (
            "input[aria-label*='select all' i][type=checkbox], "
            "input[aria-label*='all' i][type=checkbox], "
            "input[title*='select all' i][type=checkbox]",
        ),
    ]
    for group in selector_groups:
        for sel in group:
            s = sel.strip()
            if not s:
                continue
            loc = page.locator(s)
            if loc.count() == 0:
                continue
            box = loc.first
            try:
                box.wait_for(state="attached", timeout=5_000)
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                continue
            try:
                box.scroll_into_view_if_needed()
            except Exception:
                pass
            for force in (False, True):
                try:
                    if box.is_checked():
                        return
                    box.check(timeout=20_000, force=force)
                    return
                except (PlaywrightTimeoutError, PlaywrightError, Exception):
                    continue

    for label_re in (
        re.compile(r"select\s*all", re.I),
        re.compile(r"all\s*rows", re.I),
    ):
        try:
            c = page.get_by_role("checkbox", name=label_re)
            if c.count():
                c.first.check(timeout=20_000, force=True)
                return
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            pass
        try:
            c = page.get_by_label(label_re)
            if c.count():
                c.first.check(timeout=20_000, force=True)
                return
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            pass

    for click_wrapped in (
        page.locator(".MuiDataGrid-columnHeaderCheckbox .MuiButtonBase-root").first,
        page.locator(".MuiDataGrid-columnHeaderCheckbox .MuiCheckbox-root").first,
        page.locator(".MuiTableHead-root th .MuiCheckbox-root, .MuiTableHead .MuiCheckbox-root").first,
    ):
        if click_wrapped.count() == 0:
            continue
        try:
            try:
                click_wrapped.wait_for(state="visible", timeout=10_000)
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                click_wrapped.wait_for(state="attached", timeout=5_000)
            click_wrapped.scroll_into_view_if_needed()
            click_wrapped.click(timeout=12_000, force=True)
            page.wait_for_timeout(200)
            return
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            continue

    try:
        page.screenshot(path=str(dbg / "ngteco_select_all_hunt.png"), full_page=True)
    except Exception:
        pass
    raise RuntimeError(
        "Could not find the NGTeco table header 'select all' checkbox — see "
        f"{dbg / 'ngteco_select_all_hunt.png'}. If your grid uses a custom layout, "
        "open DevTools on that checkbox, copy a CSS path or data-testid, and share it."
    )


def _click_pie_chart_near_search(page, dbg: Path) -> None:
    search = page.get_by_placeholder(re.compile(r"Search by Person", re.I)).first
    search.wait_for(state="visible", timeout=30000)
    row = search.locator("xpath=ancestor::*[self::div or self::header or self::section][1]")
    for c in (
        # NGTeco: pie icon — distinct path prefix in toolbar SVG
        page.locator('button:has(svg path[d^="M484.15"]):not([disabled])').first,
        row.locator("button").filter(has=page.locator("svg")).first,
        page.locator("button[title*='chart' i], button[aria-label*='chart' i]").first,
        page.get_by_role("button").filter(has=page.locator("svg")).nth(1),
    ):
        try:
            if c.count() and c.is_visible():
                c.scroll_into_view_if_needed()
                c.click()
                page.wait_for_timeout(1500)
                return
        except (PlaywrightError, PlaywrightTimeoutError):
            pass
    shot = dbg / "ngteco_pie_hunt.png"
    page.screenshot(path=str(shot), full_page=True)
    raise RuntimeError(f"Could not find NGTeco pie/calc button (see {shot})")


def _shift_schedule_flow(page, dbg: Path) -> None:
    page.goto(SCHEDULE_URL, wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle", timeout=120000)
    _required_schedule_steps(page, dbg)
    page.wait_for_timeout(500)
    page.wait_for_timeout(3000)


def _timecard_fill_text_pair(loc0, loc1, start_s: str, end_s: str) -> bool:
    """Try filling two text-like date fields (MUI often uses fill(..., force=True) on read-only input)."""
    try:
        loc0.click(timeout=5000)
    except (PlaywrightTimeoutError, PlaywrightError, Exception):
        pass
    try:
        loc1.click(timeout=5000)
    except (PlaywrightTimeoutError, PlaywrightError, Exception):
        pass
    try:
        d_start = datetime.strptime(start_s, "%m/%d/%Y").date()
        d_end = datetime.strptime(end_s, "%m/%d/%Y").date()
    except ValueError:
        return False

    ok_start = _fill_single_date_input(loc0, d_start, start_s)
    ok_end = _fill_single_date_input(loc1, d_end, end_s)
    return ok_start and ok_end


def _timecard_set_date_range(
    page, d_start: date, d_end: date, start_s: str, end_s: str
) -> bool:
    """
    Timecard may use Ant DatePicker, MUI (X) pickers, or native date inputs. Debug PNG:
    uploads/ngteco_date_hunt.png on the server (e.g. /opt/payroll/uploads/ next to the app).
    """
    s_sel = (os.environ.get("NGTECO_TIMECARD_START_SELECTOR") or "").strip()
    e_sel = (os.environ.get("NGTECO_TIMECARD_END_SELECTOR") or "").strip()
    if s_sel and e_sel:
        try:
            s = page.locator(s_sel).first
            e = page.locator(e_sel).first
            s.wait_for(state="attached", timeout=8_000)
            e.wait_for(state="attached", timeout=8_000)
            return _timecard_fill_text_pair(s, e, start_s, end_s)
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            pass

    # MUI: readonly tel with placeholder mm/dd/yyyy (typical on NGTeco timecard)
    tel_mui = page.locator(
        "input.MuiOutlinedInput-input[placeholder*=\"mm\" i][type=\"tel\"], "
        "input[placeholder=\"mm/dd/yyyy\" i], input[placeholder*=\"dd/yyyy\" i]"
    )
    if tel_mui.count() >= 2:
        if _timecard_fill_text_pair(tel_mui.nth(0), tel_mui.nth(1), start_s, end_s):
            return True

    for selector in (
        "div.ant-picker-input input",
        ".ant-picker-range input",
        "[class*='DatePicker'] input",
    ):
        loc = page.locator(selector)
        if loc.count() >= 2:
            if _timecard_fill_text_pair(loc.nth(0), loc.nth(1), start_s, end_s):
                return True

    h5 = page.locator("input[type=date], input[type=datetime-local]")
    if h5.count() >= 2:
        try:
            h5.nth(0).fill(d_start.isoformat(), force=True, timeout=10_000)
            h5.nth(1).fill(d_end.isoformat(), force=True, timeout=10_000)
            return True
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            pass
    for sel in (
        "input[placeholder*='-'][placeholder*='202' i], "
        "input[placeholder*='/'][placeholder*='/'][placeholder*='/']",
    ):
        one = page.locator(sel)
        if one.count() == 1 and "/" in start_s and "/" in end_s:
            try:
                one.first.fill(f"{start_s} - {end_s}", force=True, timeout=10_000)
                return True
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                pass

    la = page.locator(
        'input[aria-label*="Start" i]:not([type=checkbox]), '
        'input[aria-label*="From" i]:not([type=checkbox])'
    )
    lb = page.locator('input[aria-label*="End" i]:not([type=checkbox])')
    if la.count() and lb.count():
        if _timecard_fill_text_pair(la.first, lb.first, start_s, end_s):
            return True
    mui_aria3 = page.locator('input[aria-label*="date" i]:not([type=checkbox])')
    if mui_aria3.count() >= 2:
        if _timecard_fill_text_pair(mui_aria3.nth(0), mui_aria3.nth(1), start_s, end_s):
            return True

    for start_p, end_p in (
        (
            re.compile(r"start.*date|date.*start|from|begin", re.I),
            re.compile(r"end.*date|date.*end|through", re.I),
        ),
    ):
        try:
            a = page.get_by_label(start_p)
            b = page.get_by_label(end_p)
            if a.count() and b.count():
                if _timecard_fill_text_pair(a.first, b.first, start_s, end_s):
                    return True
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            pass
    for role_names in (
        (re.compile(r"start|from|begin", re.I), re.compile(r"^end$|end date|to$|through", re.I)),
    ):
        try:
            a = page.get_by_role("textbox", name=role_names[0])
            b = page.get_by_role("textbox", name=role_names[1])
            if a.count() and b.count():
                if _timecard_fill_text_pair(a.first, b.first, start_s, end_s):
                    return True
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            pass
    for exact in (("Start date", "End date"), ("From", "To"), ("Start", "End")):
        try:
            a = page.get_by_label(exact[0], exact=True)
            b = page.get_by_label(exact[1], exact=True)
            if a.count() and b.count():
                if _timecard_fill_text_pair(a.first, b.first, start_s, end_s):
                    return True
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            pass
    for pat_s, pat_e in (
        (re.compile(r"start|from|begin", re.I), re.compile(r"end|through|date\s*to", re.I)),
    ):
        try:
            a = page.get_by_label(pat_s)
            b = page.get_by_label(pat_e)
            if a.count() and b.count():
                if _timecard_fill_text_pair(a.first, b.first, start_s, end_s):
                    return True
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            pass

    ro = page.locator(
        "main input[readonly], main input.MuiInputBase-input, .MuiInputBase-input[readonly], "
        "form input[readonly], .MuiInputBase-input.MuiInput-input, "
        "main input.MuiInputBase-input[type='text']"
    )
    n_ro = ro.count()
    if n_ro >= 2:
        for i in range(min(n_ro - 1, 5)):
            u = ro.nth(i)
            v = ro.nth(i + 1)
            try:
                if _timecard_fill_text_pair(u, v, start_s, end_s):
                    return True
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                continue
    mui_t = page.locator(
        "main input.MuiInputBase-input[type='text'], main div.MuiInputBase-root input, "
        "form input.MuiInputBase-input[type='text']"
    )
    if mui_t.count() >= 2 and _timecard_fill_text_pair(mui_t.nth(0), mui_t.nth(1), start_s, end_s):
        return True
    slash_in = page.locator("main input[placeholder*='/']")
    if slash_in.count() >= 2 and _timecard_fill_text_pair(
        slash_in.nth(0), slash_in.nth(1), start_s, end_s
    ):
        return True

    pair = page.locator("main input[type='text'], main input[readonly], form input[readonly]")
    for scope in (pair, page.locator("form input[type='text']")):
        c = min(scope.count(), 8)
        if c >= 2 and _timecard_fill_text_pair(scope.nth(0), scope.nth(1), start_s, end_s):
            return True
    for sel in (
        "input[aria-label*='date' i]:not([type=checkbox])",
        "input[aria-label*='Date' i]:not([type=checkbox])",
    ):
        loc = page.locator(sel)
        if loc.count() >= 2 and _timecard_fill_text_pair(loc.nth(0), loc.nth(1), start_s, end_s):
            return True

    return False


def _timecard_optional_refresh_or_apply(page) -> None:
    """
    Many NGTeco timecard UIs have no 'Refresh' after setting dates; do not block on it.
    Try common action buttons, then no-op.
    """
    for pat in (
        re.compile(r"^Refresh$", re.I),
        re.compile(r"Query|Search|Apply|Load|Run|Update|Generate", re.I),
    ):
        try:
            b = page.get_by_role("button", name=pat)
            if b.count():
                b.first.scroll_into_view_if_needed()
                b.first.click(timeout=5_000)
                try:
                    page.wait_for_load_state("networkidle", timeout=90_000)
                except (PlaywrightTimeoutError, PlaywrightError, Exception):
                    pass
                page.wait_for_timeout(500)
                return
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            continue
    for sel in (
        "button[aria-label*='Refresh' i]",
        "button[aria-label*='Search' i]",
        "button[aria-label*='Query' i]",
    ):
        loc = page.locator(sel)
        if loc.count():
            try:
                loc.first.click(timeout=4_000)
                try:
                    page.wait_for_load_state("networkidle", timeout=90_000)
                except (PlaywrightTimeoutError, PlaywrightError, Exception):
                    pass
                page.wait_for_timeout(500)
                return
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                continue


def _ngteco_js_click_csv_menuitem(page) -> bool:
    """
    Click a *visible* li[role=menuitem] whose text is plain 'csv' (or 'csv with tz').
    Many menuitems in the tree are display:none; .first in Playwright matches hidden ones.
    """
    try:
        return bool(
            page.evaluate(
                """
                () => {
                    const norm = (s) => (s || "").replace(/\\s+/g, " ").trim().toLowerCase();
                    const items = document.querySelectorAll('li[role="menuitem"]');
                    let plain = null, tz = null;
                    for (const el of items) {
                        const st = getComputedStyle(el);
                        if (st.display === "none" || st.visibility === "hidden" ||
                            parseFloat(st.opacity) < 0.01) { continue; }
                        const r = el.getBoundingClientRect();
                        if (r.width < 1 || r.height < 1) { continue; }
                        if (r.top > window.innerHeight + 10 || r.bottom < -10) { continue; }
                        const t = norm(el.textContent);
                        if (t === "csv") { plain = el; break; }
                        if (t.includes("csv") && t.includes("tz")) { tz = tz || el; }
                    }
                    const e = plain || tz;
                    if (!e) { return false; }
                    e.scrollIntoView({ block: "center", inline: "center" });
                    const o = { bubbles: true, cancelable: true, view: window };
                    e.dispatchEvent(new PointerEvent("pointerdown", o));
                    e.dispatchEvent(new PointerEvent("pointerup", o));
                    e.dispatchEvent(new MouseEvent("click", o));
                    if (typeof e.click === "function") e.click();
                    return true;
                }
                """
            )
        )
    except Exception:
        return False


def _ngteco_playwright_click_csv_menuitem(page) -> bool:
    for name_rx in (re.compile(r"^csv$", re.I), re.compile(r"csv with tz", re.I)):
        try:
            items = page.get_by_role("menuitem", name=name_rx)
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            continue
        for i in range(min(items.count(), 50)):
            it = items.nth(i)
            try:
                if it.is_visible():
                    it.scroll_into_view_if_needed()
                    it.click(timeout=4_000, force=True)
                    return True
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                continue
    for container in (
        "div.MuiMenu-paper",
        "div.MuiPopover-paper",
        "ul[role=menu]",
    ):
        c = page.locator(container).last
        if c.count() == 0:
            continue
        for rx in (re.compile(r"^\s*csv\s*$", re.I), re.compile(r"csv with tz", re.I)):
            row = c.locator("li[role=menuitem], [role=menuitem]").filter(has_text=rx)
            if row.count() == 0:
                continue
            try:
                row.first.scroll_into_view_if_needed()
                row.first.click(timeout=4_000, force=True)
                return True
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                continue
    return False


def _ngteco_open_download_and_choose_csv(page, d_btn, dbg: Path) -> None:
    """
    Open the Download popover and click the csv line. Retries with Escape + force
    re-open once. Never use get_by_text('csv').last — it matches hidden nav nodes.
    """
    for attempt in (1, 2):
        d_btn.first.wait_for(state="visible", timeout=30_000)
        d_btn.first.scroll_into_view_if_needed()
        try:
            d_btn.first.click(timeout=12_000, force=attempt == 2)
        except (PlaywrightTimeoutError, PlaywrightError, Exception):
            d_btn.first.click(timeout=12_000, force=True)
        page.wait_for_timeout(500)
        if _ngteco_js_click_csv_menuitem(page):
            return
        if _ngteco_playwright_click_csv_menuitem(page):
            return
        try:
            page.keyboard.press("Escape")
        except Exception:
            pass
        page.wait_for_timeout(300)
    try:
        page.screenshot(path=str(dbg / "ngteco_csv_menu.png"), full_page=True)
    except Exception:
        pass
    raise RuntimeError(
        "Could not open or click the Timecard 'csv' export in the Download menu — see "
        f"{dbg / 'ngteco_csv_menu.png'}"
    )


def _timecard_download(
    page, out_path: Path, d_start: date, d_end: date, dbg: Path
) -> None:
    page.goto(TIMECARD_URL, wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle", timeout=120000)
    page.wait_for_timeout(1000)
    try:
        tc = page.get_by_text("Timecard Management", exact=True)
        if tc.count():
            tc.first.click(timeout=8_000)
            page.wait_for_timeout(500)
            try:
                page.wait_for_load_state("networkidle", timeout=60_000)
            except (PlaywrightTimeoutError, PlaywrightError, Exception):
                pass
    except (PlaywrightTimeoutError, PlaywrightError, Exception):
        pass
    start_s, end_s = _fmt_us(d_start), _fmt_us(d_end)
    filled = _required_timecard_steps(page, d_start, d_end)
    if not filled:
        filled = _timecard_set_date_range(page, d_start, d_end, start_s, end_s)
    if not filled:
        shot = dbg / "ngteco_date_hunt.png"
        try:
            page.screenshot(path=str(shot), full_page=True)
        except Exception:
            pass
        raise RuntimeError(
            "Could not set NGTeco timecard date range. Full-page debug PNG is written as "
            f"uploads/ngteco_date_hunt.png in the app directory on the payroll server (e.g. "
            f"/opt/payroll/uploads/ngteco_date_hunt.png if you use /opt/payroll). "
            f"Optional: set NGTECO_TIMECARD_START_SELECTOR and NGTECO_TIMECARD_END_SELECTOR to CSS "
            f"for the start/end input fields. Underlying: {shot}"
        )
    page.wait_for_timeout(500)
    _timecard_optional_refresh_or_apply(page)
    page.wait_for_timeout(800)
    with page.expect_download(timeout=180000) as dl:
        d_btn = page.get_by_role("button", name=re.compile(r"^Download$", re.I))
        if d_btn.count() == 0:
            d_btn = page.locator("button[aria-label=\"Download\"]")
        if d_btn.count() == 0:
            d_btn = page.get_by_text("Download", exact=False)
        _ngteco_open_download_and_choose_csv(page, d_btn, dbg)
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
    return _filter_csv_text_by_date_range(text, d0, d1)
