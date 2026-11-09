"""Credential-free regression of the exact upstream enqueue-error block.

Usage: python3 docs/icp-warning-redaction/test_warning_redaction.py SOURCE_ROOT
Requires the pinned dfinity/ic sources, rustc, and no network or credentials.
This extracts the real failure block, not the complete replica or logger runtime.
"""
import pathlib
import re
import subprocess
import sys
import tempfile

root = pathlib.Path(sys.argv[1])
pool = (root / "rs/https_outcalls/consensus/src/pool_manager.rs").read_text()
adapter = (root / "rs/interfaces/adapter_client/src/lib.rs").read_text()
enum = re.search(r"pub enum SendError<Request> \{.*?\n\}", adapter, re.S)
start = pool.index("if let Err(err) = self")
start = pool.index("warn!(", start)
end = pool.index("\n                } else {", start)
block = pool[start:end].replace("self.", "manager.")
if enum is None:
    raise RuntimeError("Expected upstream SendError definition missing")

harness = r'''
use std::cell::RefCell;
#[derive(Debug)]
ENUM
struct CredentialRequest;
impl std::fmt::Debug for CredentialRequest {
    fn fmt(&self, _: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        panic!("Credential-bearing request must never be formatted");
    }
}
#[derive(Default)]
struct Metrics(RefCell<Vec<&'static str>>);
impl Metrics {
    fn observe_pool_manager_error(&self, value: &'static str) {
        self.0.borrow_mut().push(value);
    }
}
#[derive(Default)]
struct Manager { log: RefCell<Vec<String>>, metrics: Metrics }
macro_rules! warn {
    ($log:expr, $($args:tt)*) => { $log.borrow_mut().push(format!($($args)*)) };
}
fn enqueue_failed(manager: &Manager, err: SendError<CredentialRequest>) {
BLOCK
}
#[test]
fn full_queue_does_not_format_credentials() {
    let manager = Manager::default();
    enqueue_failed(&manager, SendError::Full(CredentialRequest));
    assert_eq!(*manager.log.borrow(), vec!["Failed to add canister http request to queue: adapter_queue_full"]);
    assert_eq!(*manager.metrics.0.borrow(), vec!["adapter_queue_full"]);
}
#[test]
fn broken_connection_preserves_classification() {
    let manager = Manager::default();
    enqueue_failed(&manager, SendError::BrokenConnection);
    assert_eq!(*manager.log.borrow(), vec!["Failed to add canister http request to queue: adapter_connection_broken"]);
    assert_eq!(*manager.metrics.0.borrow(), vec!["adapter_connection_broken"]);
}
'''.replace("ENUM", enum.group()).replace("BLOCK", block)

with tempfile.TemporaryDirectory(prefix="icp-warning-regression-") as tmp:
    src = pathlib.Path(tmp) / "regression.rs"
    exe = pathlib.Path(tmp) / "regression"
    src.write_text(harness)
    subprocess.run(["rustc", "--edition=2021", "--test", str(src), "-o", str(exe)], check=True)
    subprocess.run([str(exe)], check=True)