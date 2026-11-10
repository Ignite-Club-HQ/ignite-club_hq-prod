import Wake "../src/nativeWakePolicy";

assert Wake.retry(0, null);
assert Wake.retry(0, ?503);
assert not Wake.retry(0, ?202);
assert not Wake.retry(1, null);
assert not Wake.retry(1, ?503);
assert Wake.retrySeconds == 5;
assert Wake.backupSeconds == 60;
assert Wake.scanLimit == 200;
assert Wake.waiting(true, true, false);
assert not Wake.waiting(true, false, false);
assert not Wake.waiting(true, true, true);
assert not Wake.waiting(false, true, false);