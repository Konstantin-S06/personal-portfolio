from chat_sql import RateLimiter


class Clock:
    def __init__(self, t=86400 * 20000 + 100):
        self.t = t

    def __call__(self):
        return self.t


def test_per_minute_then_recovers():
    c = Clock()
    rl = RateLimiter(per_minute=3, per_day=100, global_per_day=100, clock=c)
    assert all(rl.check("a").allowed for _ in range(3))
    d = rl.check("a")
    assert not d.allowed and d.reason == "minute" and 1 <= d.retry_after <= 61
    assert rl.check("b").allowed  # other visitors unaffected
    c.t += 61
    assert rl.check("a").allowed


def test_per_day_limit_and_rollover():
    c = Clock()
    rl = RateLimiter(per_minute=100, per_day=5, global_per_day=100, clock=c)
    for _ in range(5):
        assert rl.check("a").allowed
        c.t += 61
    d = rl.check("a")
    assert not d.allowed and d.reason == "day" and d.retry_after > 0
    c.t = (int(c.t // 86400) + 1) * 86400 + 5  # next UTC day
    assert rl.check("a").allowed


def test_global_cap():
    rl = RateLimiter(per_minute=100, per_day=100, global_per_day=4, clock=Clock())
    for i in range(4):
        assert rl.check(f"v{i}").allowed
    d = rl.check("v99")
    assert not d.allowed and d.reason == "global"


def test_blocked_requests_do_not_consume_quota():
    c = Clock()
    rl = RateLimiter(per_minute=1, per_day=2, global_per_day=100, clock=c)
    assert rl.check("a").allowed
    for _ in range(20):
        assert not rl.check("a").allowed  # blocked by minute window, not counted
    c.t += 61
    assert rl.check("a").allowed  # 2nd allowed request of the day
    c.t += 61
    assert rl.check("a").reason == "day"


def test_memory_bounded_under_visitor_flood():
    c = Clock()
    rl = RateLimiter(per_minute=5, per_day=5, global_per_day=10**9, clock=c, max_visitors=100)
    for i in range(2000):
        rl.check(f"v{i}")
        c.t += 0.01
    assert len(rl._minute) <= 101
    assert len(rl._day_counts) <= 100 * 4 + 1


def test_from_env(monkeypatch):
    monkeypatch.setenv("CHAT_LIMIT_PER_MINUTE", "2")
    monkeypatch.setenv("CHAT_LIMIT_PER_DAY", "garbage")
    rl = RateLimiter.from_env()
    assert rl.per_minute == 2 and rl.per_day == 40
