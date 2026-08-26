"""Regression checks for CS.RIN session-expiry recovery.

Run from backend/: python -m tests.test_csrin_auth
"""

import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import httpx

from app.scraping import csrin


def _response(status: int, location: str = "") -> httpx.Response:
    headers = {"location": location} if location else {}
    return httpx.Response(status, headers=headers, text="<html>forum page</html>")


def test_login_redirect_detection() -> None:
    assert csrin._is_login_redirect(_response(302, "./ucp.php?mode=login&sid=abc"))
    assert csrin._is_login_redirect(_response(303, "https://cs.rin.ru/forum/ucp.php?mode=login"))
    assert csrin._is_login_redirect(_response(302, "ucp.php?mode=login"))
    assert not csrin._is_login_redirect(_response(302, "./index.php"))


async def test_reauthenticates_and_retries_once() -> None:
    redirect = _response(302, "./ucp.php?mode=login")
    success = _response(200)
    fetch = AsyncMock(side_effect=[redirect, success])
    ensure = AsyncMock(return_value=True)
    with patch.object(csrin, "_csrin_fetch", fetch), patch.object(csrin, "_ensure_session", ensure):
        result = await csrin._authenticated_fetch(object(), "https://cs.rin.ru/forum/search.php")
    assert result is success
    assert fetch.await_count == 2
    ensure.assert_awaited_once()


async def test_repeated_login_redirect_is_not_returned_as_an_empty_page() -> None:
    redirect = _response(302, "./ucp.php?mode=login")
    fetch = AsyncMock(side_effect=[redirect, redirect])
    ensure = AsyncMock(return_value=True)
    with patch.object(csrin, "_csrin_fetch", fetch), patch.object(csrin, "_ensure_session", ensure):
        result = await csrin._authenticated_fetch(object(), "https://cs.rin.ru/forum/search.php")
    assert result is None
    assert fetch.await_count == 2
    ensure.assert_awaited_once()


def test_recent_dedupe_keeps_newest_post_per_variant() -> None:
    older = {
        "originalId": "42", "csrinPostId": "100", "csrinOnlineFix": False,
        "csrinReliablePoster": True, "title": "Old build",
    }
    newer = {
        "originalId": "42", "csrinPostId": "101", "csrinOnlineFix": False,
        "csrinReliablePoster": False, "title": "New build",
    }
    online_fix = {
        "originalId": "42", "csrinPostId": "102", "csrinOnlineFix": True,
        "title": "Online-Fix build",
    }
    results = csrin._dedupe_recent_posts([older, newer, online_fix])
    assert {post["title"] for post in results} == {"New build", "Online-Fix build"}


def test_forum_listing_uses_explicit_latest_post_link() -> None:
    html = '''
        <a class="topictitle" href="./viewtopic.php?f=10&amp;t=42">[Update] Test Game</a>
        <a href="./viewtopic.php?f=10&amp;t=42&amp;start=30">3</a>
        <a href="./viewtopic.php?f=10&amp;t=42&amp;p=12345#p12345"><img alt="View the latest post"></a>
    '''
    thread = csrin.parse_search_results(html)[0]
    assert thread["latestPostId"] == "12345"
    assert thread["link"].endswith("viewtopic.php?f=10&t=42&p=12345#p12345")


def test_recent_candidates_keep_the_newest_linked_release() -> None:
    html = '''
        <a name="p100"></a>Posted: Today, 00:00<span class="postbody">Version 1.0.0
        <a href="https://gofile.io/d/old">Gofile</a></span>
        <a name="p101"></a>Posted: Today, 00:00<span class="postbody">Clean Steam Files - Version 1.1.0
        <a href="https://gofile.io/d/newer">Gofile</a></span>
        <a name="p102"></a>Posted: Today, 00:00<span class="postbody">Discussion bump without links</span>
        <a name="p103"></a>Posted: Today, 00:00<span class="postbody">Another discussion bump without links</span>
    '''
    thread = {
        "threadId": "42", "title": "Test Game",
        "link": "https://example.test/thread?p=103#p103",
    }
    candidates = csrin.parse_linked_posts(html, thread, recent_post_limit=10)
    posts = csrin._dedupe_recent_posts(candidates)
    assert len(posts) == 1
    assert posts[0]["csrinPostId"] == "101"
    assert posts[0]["csrinReleaseLabel"] == "Version 1.1.0"
    assert posts[0]["link"] == "https://example.test/thread?p=101#p101"


def test_csf_in_a_signature_does_not_admit_a_precracked_release() -> None:
    html = '''
        <a name="p101"></a>Posted: Today, 00:00<span class="postbody">Version 1.1.0 RUNE emulator
        <a href="https://gofile.io/d/precracked">Gofile</a>_____
        Clean Steam Files (CSF) requires an emulator</span>
    '''
    thread = {"threadId": "42", "title": "Test Game", "link": "https://example.test/thread?p=101#p101"}
    assert csrin.parse_linked_posts(html, thread) == []


def test_based_on_csf_with_a_bundled_emulator_is_not_clean_files() -> None:
    html = '''
        <a name="p101"></a>Posted: Saturday, 04 Jul 2026, 00:57<span class="postbody">Galactic Vault Build 24001643
        Based on GameBounty CSF | Emulator by SOVEREIGN
        <a href="https://pixeldrain.com/u/example">PixelDrain</a></span>
    '''
    thread = {"threadId": "42", "title": "Galactic Vault", "link": "https://example.test/thread?p=101#p101"}
    assert csrin.parse_linked_posts(html, thread) == []


def test_csf_with_an_online_fix_patch_is_not_clean_files() -> None:
    html = '''
        <a name="p101"></a>Posted: Today, 00:00<span class="postbody">Clean Steam Files Build 24894107
        My CSF 24894107 + OF-ME Online-Fix applied.
        <a href="https://multiup.io/download/how-to-fish-onlinefix.7z">Mirror</a></span>
    '''
    thread = {"threadId": "42", "title": "How to Fish", "link": "https://example.test/thread?p=101#p101"}
    assert csrin.parse_linked_posts(html, thread) == []


def test_candidates_older_than_one_day_are_rejected() -> None:
    html = '''
        <a name="p101"></a>Posted: Saturday, 04 Jul 2026, 00:57
        <span class="postbody">Clean Steam Files Version 1.1.0
        <a href="https://gofile.io/d/old">Gofile</a></span>
    '''
    thread = {"threadId": "42", "title": "Old Game", "link": "https://example.test/thread?p=101#p101"}
    assert csrin.parse_linked_posts(html, thread) == []


def test_relative_forum_post_timestamps_are_recent() -> None:
    assert csrin._is_recent_post(csrin._post_timestamp("Posted: 22 minutes ago"))
    assert csrin._is_recent_post(csrin._post_timestamp("Posted: an hour ago"))
    assert not csrin._is_recent_post(csrin._post_timestamp("Posted: 2 days ago"))


def test_only_titeuf_maintained_link_notices_are_collected() -> None:
    html = '''
        <a name="p101"></a>Posted: Today, 00:00
        <b class="postauthor">Titeuf</b><span class="postbody">Hi, New version Build 24926363
        <a href="./viewtopic.php?p=3437411#p3437411">Build 24926363</a></span>
        <a name="p102"></a>Posted: Today, 00:00
        <b class="postauthor">SomeoneElse</b><span class="postbody">New version Build 24926364
        <a href="./viewtopic.php?p=3437412#p3437412">Build 24926364</a></span>
    '''
    thread = {"threadId": "42", "title": "Test Game", "link": "https://example.test/thread?p=102#p102"}
    notices = csrin._maintained_link_notices(html, thread, recent_post_limit=10)
    assert len(notices) == 1
    assert notices[0]["postId"] == "101"
    assert notices[0]["references"] == ["3437411"]


def test_maintained_link_chain_stays_in_the_same_thread() -> None:
    content = '''
        <a href="./viewtopic.php?p=2542429#p2542429">Original CSF post</a>
        <a href="./viewtopic.php?t=99&p=999">Different thread</a>
    '''
    assert csrin._same_thread_post_references(content, "42") == ["2542429"]


def test_content_sharing_uses_the_current_subject_date_and_topic_opener() -> None:
    today = datetime.now(timezone.utc).strftime("%d.%m.%Y")
    html = '''
        <a name="p101"></a>Posted: Tuesday, 15 Feb 2022, 00:03
        <b class="postauthor">SCS God</b><span class="postbody">Download Links
        Ranch Simulator: Build, Hunt, Farm | ''' + today + '''
        <a href="https://pixeldrain.com/u/example">Mirror</a></span>
        <a name="p102"></a>Posted: Today, 00:00
        <b class="postauthor">Upload-Crew [Bot]</b>
        <span class="postbody">Uploaded version: August 25, 2026 - 16:55:45 UTC [Build 24926363]</span>
    '''
    thread = {
        "threadId": "42", "forumId": "22", "title": "Ranch Simulator",
        "rawTitle": f"Ranch Simulator [{today}]", "link": "https://example.test/thread?p=102#p102",
    }
    posts = csrin.parse_linked_posts(html, thread, recent_post_limit=10)
    assert len(posts) == 1
    assert posts[0]["csrinPostId"] == "101"
    assert posts[0]["csrinCsf"] is True
    assert posts[0]["csrinReleaseLabel"] == "Build 24926363"
    assert posts[0]["date"].endswith("00:00:00+00:00")


def test_allowlisted_author_posts_are_trusted_csf_candidates() -> None:
    html = '''
        <a name="p101" id="p101"></a>Forum: <a href="./viewforum.php?f=10">Main Forum</a>
        Topic: <a href="./viewtopic.php?f=10&t=42">Test Game</a>
        <b class="postauthor"><a href="./memberlist.php?u=1">Owla</a></b>
        <b>Post subject:</b> <a href="./viewtopic.php?f=10&t=42&p=101#p101">Re: Test Game</a>
        <b>Posted:</b> Today, 00:00
        <td class="postbody">Version 1.2.3 <a href="https://pixeldrain.com/u/example">PixelDrain</a></td>
    '''
    posts = csrin.parse_csf_author_posts(html)
    assert len(posts) == 1
    assert posts[0]["title"] == "Test Game"
    assert posts[0]["csrinCsf"] is True


def main() -> None:
    test_login_redirect_detection()
    asyncio.run(test_reauthenticates_and_retries_once())
    asyncio.run(test_repeated_login_redirect_is_not_returned_as_an_empty_page())
    test_recent_dedupe_keeps_newest_post_per_variant()
    test_forum_listing_uses_explicit_latest_post_link()
    test_recent_candidates_keep_the_newest_linked_release()
    test_csf_in_a_signature_does_not_admit_a_precracked_release()
    test_based_on_csf_with_a_bundled_emulator_is_not_clean_files()
    test_csf_with_an_online_fix_patch_is_not_clean_files()
    test_candidates_older_than_one_day_are_rejected()
    test_relative_forum_post_timestamps_are_recent()
    test_only_titeuf_maintained_link_notices_are_collected()
    test_maintained_link_chain_stays_in_the_same_thread()
    test_content_sharing_uses_the_current_subject_date_and_topic_opener()
    test_allowlisted_author_posts_are_trusted_csf_candidates()
    print("All CS.RIN authentication checks passed.")


if __name__ == "__main__":
    main()
