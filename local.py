"""Local ETL runner, HTTP 206 Range + CORS static data server, and Vite dev launcher."""

from __future__ import annotations

import argparse
import functools
import hashlib
import http.server
import json
import mimetypes
import os
import re
import shutil
import socketserver
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_DIR = ROOT_DIR / "local_data"
DEFAULT_INPUT_DIR = Path(
    r"C:\Users\brett\OneDrive - Augusta University\_Teach\AYs\2026-27\CLSC_4903-7903\AI_REV\discussions\_D2L_Exit_Exam"
)
CHUNK_SIZE = 65536
_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


def parse_byte_range(range_header: str, file_size: int) -> tuple[int, int] | None:
    """Parse an HTTP Range header (closed, open-ended, or suffix) for a given file size.

    Returns (start, end) inclusive, or None if the range is invalid/unsatisfiable.
    """
    if file_size <= 0 or not range_header:
        return None
    spec = range_header.strip()
    if "," in spec:
        spec = spec.split(",", 1)[0].strip()
    m = _RANGE_RE.match(spec)
    if not m:
        return None

    start_str, end_str = m.group(1), m.group(2)
    if not start_str and not end_str:
        return None

    if not start_str:
        # Suffix range: bytes=-N (e.g., Parquet footer reads)
        suffix_len = int(end_str)
        if suffix_len <= 0:
            return None
        start = max(0, file_size - suffix_len)
        end = file_size - 1
        return start, end

    start = int(start_str)
    if start >= file_size:
        return None
    end = int(end_str) if end_str else file_size - 1
    end = min(end, file_size - 1)
    if start > end:
        return None
    return start, end


class RangeCORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP/1.1 static file handler supporting byte-range requests (206), CORS, and throttling."""

    protocol_version = "HTTP/1.1"

    def __init__(
        self,
        *args: Any,
        directory: str | None = None,
        throttle_mbps: float | None = None,
        quiet: bool = False,
        **kwargs: Any,
    ) -> None:
        self.throttle_mbps = throttle_mbps
        self.quiet = quiet
        super().__init__(*args, directory=directory, **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        if not self.quiet:
            super().log_message(format, *args)

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Range, Content-Type, If-None-Match, If-Modified-Since",
        )
        self.send_header(
            "Access-Control-Expose-Headers",
            "Content-Length, Content-Range, Accept-Ranges",
        )
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self) -> None:
        self._serve_request(send_body=False)

    def do_GET(self) -> None:
        self._serve_request(send_body=True)

    def _guess_mime(self, path: Path) -> str:
        if path.suffix == ".parquet":
            return "application/vnd.apache.parquet"
        if path.suffix == ".bin":
            return "application/octet-stream"
        guessed, _ = mimetypes.guess_type(str(path))
        return guessed or "application/octet-stream"

    def _serve_request(self, send_body: bool) -> None:
        fs_path = Path(self.translate_path(self.path))
        if fs_path.is_dir():
            index = fs_path / "index.html"
            if index.is_file():
                fs_path = index
            else:
                listing = sorted(p.name for p in fs_path.iterdir()) if fs_path.exists() else []
                payload = json.dumps({"files": listing}).encode("utf-8")
                self.send_response(200)
                self._send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                if send_body:
                    self.wfile.write(payload)
                return

        if not fs_path.is_file():
            err = b'{"error":"Not Found"}'
            self.send_response(404)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err)))
            self.end_headers()
            if send_body:
                self.wfile.write(err)
            return

        file_size = fs_path.stat().st_size
        mime_type = self._guess_mime(fs_path)
        range_header = self.headers.get("Range")

        if range_header:
            parsed = parse_byte_range(range_header, file_size)
            if parsed is None:
                self.send_response(416)
                self._send_cors_headers()
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return

            start, end = parsed
            length = end - start + 1
            self.send_response(206)
            self._send_cors_headers()
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            self.send_header("Content-Length", str(length))
            self.end_headers()
        else:
            start = 0
            length = file_size
            self.send_response(200)
            self._send_cors_headers()
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(length))
            self.end_headers()

        if not send_body:
            return

        bytes_per_sec = (self.throttle_mbps * 1_000_000.0 / 8.0) if (self.throttle_mbps and self.throttle_mbps > 0) else 0.0
        remaining = length
        try:
            with fs_path.open("rb") as fh:
                fh.seek(start)
                while remaining > 0:
                    chunk = fh.read(min(CHUNK_SIZE, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
                    if bytes_per_sec > 0:
                        time.sleep(len(chunk) / bytes_per_sec)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Expected when browser cancels a shard download via AbortController
            return


class ThreadedRangeServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """Multi-threaded HTTP server allowing concurrent DuckDB-WASM range reads."""

    daemon_threads = True
    allow_reuse_address = True


def create_data_server(
    data_dir: Path,
    host: str = "127.0.0.1",
    port: int = 8000,
    throttle_mbps: float | None = None,
    quiet: bool = False,
) -> ThreadedRangeServer:
    """Instantiate a ThreadedRangeServer serving data_dir."""
    handler = functools.partial(
        RangeCORSRequestHandler,
        directory=str(data_dir),
        throttle_mbps=throttle_mbps,
        quiet=quiet,
    )
    return ThreadedRangeServer((host, port), handler)


def _resolve_venv_python() -> str:
    venv_py = ROOT_DIR / "pipeline" / ".venv" / "Scripts" / "python.exe"
    if venv_py.is_file():
        return str(venv_py)
    posix_py = ROOT_DIR / "pipeline" / ".venv" / "bin" / "python"
    if posix_py.is_file():
        return str(posix_py)
    return sys.executable


def run_etl_subprocess(
    input_dir: Path,
    mappings_dir: Path | None,
    data_dir: Path,
    sample: bool,
) -> None:
    """Run pipeline.build_shards via the project venv Python."""
    py_exe = _resolve_venv_python()
    cmd = [
        py_exe,
        "-m",
        "pipeline.build_shards",
        "--input-dir",
        str(input_dir),
        "--output-dir",
        str(data_dir),
    ]
    if mappings_dir:
        cmd.extend(["--mappings-dir", str(mappings_dir)])
    if sample:
        cmd.extend(["--topics", "BB_01", "CH_01"])

    print(f"[local.py] Running ETL ({'sample: BB_01, CH_01' if sample else 'full corpus'})...")
    subprocess.run(cmd, cwd=str(ROOT_DIR), check=True)


def _sha256_file(path: Path) -> tuple[int, str]:
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as fh:
        while chunk := fh.read(CHUNK_SIZE):
            size += len(chunk)
            h.update(chunk)
    return size, h.hexdigest()


def verify_local_data_server(data_dir: Path, throttle_mbps: float | None = None) -> bool:
    """Start an ephemeral Range+CORS server and verify manifest, sha256, CORS, and HTTP 206 Range reads."""
    manifest_path = data_dir / "manifest.json"
    if not manifest_path.is_file():
        print(f"[CHECK FAIL] Missing manifest.json in {data_dir}")
        return False

    server = create_data_server(data_dir, host="127.0.0.1", port=0, throttle_mbps=throttle_mbps, quiet=True)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{port}"

    try:
        # 1. Verify manifest.json + CORS
        req = urllib.request.Request(f"{base_url}/manifest.json")
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status != 200:
                print(f"[CHECK FAIL] GET /manifest.json returned {resp.status}")
                return False
            if resp.headers.get("Access-Control-Allow-Origin") != "*":
                print("[CHECK FAIL] Missing Access-Control-Allow-Origin: * on /manifest.json")
                return False
            manifest = json.loads(resp.read().decode("utf-8"))

        shards = manifest.get("shards", [])
        if not shards:
            print("[CHECK FAIL] manifest.json contains zero shards")
            return False

        # 2. Verify all asset byte sizes and sha256 checksums
        assets: list[dict[str, Any]] = [manifest["centroids"], manifest["prebuiltCatalog"]]
        for shard in shards:
            assets.extend([shard["parquet"], shard["vectors"], shard["ids"]])

        for asset in assets:
            fpath = data_dir / asset["path"]
            if not fpath.is_file():
                print(f"[CHECK FAIL] Missing asset: {asset['path']}")
                return False
            actual_bytes, actual_sha = _sha256_file(fpath)
            if actual_bytes != asset["bytes"] or actual_sha != asset["sha256"]:
                print(f"[CHECK FAIL] Checksum/size mismatch for {asset['path']}")
                return False

        # 3. Verify HTTP 206 Partial Content (both start range and Parquet suffix footer range)
        first_parquet_rel = shards[0]["parquet"]["path"]
        first_parquet_bytes = (data_dir / first_parquet_rel).read_bytes()
        head_end = min(1023, len(first_parquet_bytes) - 1)
        range_req = urllib.request.Request(
            f"{base_url}/{first_parquet_rel}",
            headers={"Range": f"bytes=0-{head_end}"},
        )
        with urllib.request.urlopen(range_req, timeout=10) as resp:
            if resp.status != 206:
                print(f"[CHECK FAIL] Expected 206 Partial Content, got {resp.status}")
                return False
            if resp.headers.get("Accept-Ranges") != "bytes":
                print("[CHECK FAIL] Missing Accept-Ranges: bytes")
                return False
            expected_cr = f"bytes 0-{head_end}/{len(first_parquet_bytes)}"
            if resp.headers.get("Content-Range") != expected_cr:
                print(f"[CHECK FAIL] Bad Content-Range: {resp.headers.get('Content-Range')} != {expected_cr}")
                return False
            body = resp.read()
            if body != first_parquet_bytes[: head_end + 1]:
                print("[CHECK FAIL] Byte-range payload mismatch on header slice")
                return False

        footer_req = urllib.request.Request(
            f"{base_url}/{first_parquet_rel}",
            headers={"Range": "bytes=-4"},
        )
        with urllib.request.urlopen(footer_req, timeout=10) as resp:
            if resp.status != 206 or resp.read() != b"PAR1":
                print("[CHECK FAIL] Parquet suffix range check did not return PAR1 magic footer")
                return False

        # 4. Verify prebuilt_quizzes.json
        with urllib.request.urlopen(f"{base_url}/prebuilt_quizzes.json", timeout=10) as resp:
            if resp.status != 200:
                print(f"[CHECK FAIL] GET /prebuilt_quizzes.json returned {resp.status}")
                return False
            prebuilt = json.loads(resp.read().decode("utf-8"))
            if not isinstance(prebuilt, list):
                print("[CHECK FAIL] prebuilt_quizzes.json is not a JSON list")
                return False

        print(
            f"[CHECK PASS] Verified {len(shards)} shards, {manifest['totalQuestions']} questions, "
            f"{len(prebuilt)} Pre-Built quizzes, SHA-256 digests, CORS, and HTTP 206 Range reads."
        )
        return True
    finally:
        server.shutdown()
        server.server_close()


def _rmtree_force(path: Path) -> None:
    """Recursively remove a directory tree, clearing Windows read-only attributes (e.g., .git/objects)."""
    if not path.exists():
        return

    def _clear_readonly_and_retry(func: Any, target: str) -> None:
        os.chmod(target, stat.S_IWRITE)
        func(target)

    if sys.version_info >= (3, 12):
        shutil.rmtree(
            path,
            onexc=lambda func, target, _exc: _clear_readonly_and_retry(func, target),
        )
    else:
        shutil.rmtree(
            path,
            onerror=lambda func, target, _exc_info: _clear_readonly_and_retry(func, target),
        )


def publish_data_to_orphan_branch(
    data_dir: Path,
    repo_url: str,
    branch: str = "gh-pages",
    commit_message: str = "Publish MLS OER Parquet & int8 vector shards (CC0 1.0)",
    verify: bool = True,
) -> None:
    """Verify built data shards and force-push an orphan Git branch with zero history bloat."""
    clean_repo = repo_url.strip()
    if not clean_repo:
        raise ValueError("Publish repository URL cannot be empty.")

    git_exe = shutil.which("git")
    if not git_exe:
        raise RuntimeError("git executable was not found on PATH.")

    if verify and not verify_local_data_server(data_dir):
        raise RuntimeError("Integrity check failed; aborting publish.")

    tmp_dir = Path(tempfile.mkdtemp(prefix="mls_oer_publish_"))
    try:
        stage_dir = tmp_dir / "stage"
        shutil.copytree(data_dir, stage_dir, ignore=shutil.ignore_patterns(".git"))
        (stage_dir / ".nojekyll").write_text("", encoding="utf-8")

        subprocess.run([git_exe, "init"], cwd=str(stage_dir), check=True)
        subprocess.run([git_exe, "checkout", "--orphan", branch], cwd=str(stage_dir), check=True)
        subprocess.run([git_exe, "add", "-A"], cwd=str(stage_dir), check=True)

        name_res = subprocess.run(
            [git_exe, "config", "--get", "user.name"],
            cwd=str(stage_dir),
            capture_output=True,
            text=True,
        )
        email_res = subprocess.run(
            [git_exe, "config", "--get", "user.email"],
            cwd=str(stage_dir),
            capture_output=True,
            text=True,
        )
        has_identity = (
            name_res.returncode == 0
            and bool(name_res.stdout.strip())
            and email_res.returncode == 0
            and bool(email_res.stdout.strip())
        )

        commit_cmd = [git_exe]
        if not has_identity:
            commit_cmd.extend(
                [
                    "-c",
                    "user.name=MLS OER Publisher",
                    "-c",
                    "user.email=mls-oer-publisher@users.noreply.github.com",
                ]
            )
        commit_cmd.extend(["commit", "-m", commit_message])
        subprocess.run(commit_cmd, cwd=str(stage_dir), check=True)

        subprocess.run([git_exe, "remote", "add", "origin", clean_repo], cwd=str(stage_dir), check=True)
        subprocess.run([git_exe, "push", "-f", "origin", branch], cwd=str(stage_dir), check=True)
        print(f"[local.py] Published {data_dir} to {clean_repo} ({branch} orphan branch).")
    finally:
        _rmtree_force(tmp_dir)


def _resolve_npm() -> str | None:
    if os.name == "nt":
        return shutil.which("npm.cmd") or shutil.which("npm")
    return shutil.which("npm")


def main() -> None:
    """Run local ETL, smoke verification, and/or static Range+CORS server + Vite SPA."""
    parser = argparse.ArgumentParser(description="Local ETL and Range+CORS test harness for MLS OER.")
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument("--sample", action="store_true", help="Build fast 2-topic sample (BB_01 + CH_01).")
    mode_group.add_argument("--full", action="store_true", help="Build full corpus across all 31 topics.")
    parser.add_argument("--skip-etl", action="store_true", help="Skip ETL and reuse existing --data-dir output.")
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR, help="Path to _D2L_Exit_Exam directory.")
    parser.add_argument("--mappings-dir", type=Path, default=None, help="Directory with *_guideline_mapping.md files.")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR, help="Local data directory to build/serve.")
    parser.add_argument("--port-data", type=int, default=8000, help="Port for Range+CORS data server.")
    parser.add_argument("--port-app", type=int, default=5173, help="Port for Vite dev server.")
    parser.add_argument("--throttle-mbps", type=float, default=None, help="Optional Mbps throttle to test progress bars.")
    parser.add_argument("--data-only", action="store_true", help="Serve data only without launching Vite.")
    parser.add_argument("--check", action="store_true", help="Run automated Range/CORS/SHA-256 checks and exit.")
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Verify --data-dir and force-push it as an orphan branch to --publish-repo, then exit.",
    )
    parser.add_argument(
        "--publish-repo",
        type=str,
        default=None,
        help="Target Git repository URL for --publish (defaults to MLS_OER_DATA_REPO env var).",
    )
    parser.add_argument(
        "--publish-branch",
        type=str,
        default="gh-pages",
        help="Target Git branch name for --publish orphan push (default: gh-pages).",
    )
    parser.add_argument(
        "--allow-sample-publish",
        action="store_true",
        help="Explicitly allow publishing a 2-topic --sample build.",
    )
    args = parser.parse_args()

    if args.publish and args.sample and not args.allow_sample_publish:
        print(
            "[local.py] Refusing to publish a --sample build without --allow-sample-publish.",
            file=sys.stderr,
        )
        sys.exit(2)

    publish_repo = ""
    if args.publish:
        publish_repo = (args.publish_repo or os.environ.get("MLS_OER_DATA_REPO") or "").strip()
        if not publish_repo:
            print(
                "[local.py] Missing target repository URL. Pass --publish-repo <url> or set MLS_OER_DATA_REPO.",
                file=sys.stderr,
            )
            sys.exit(2)

    should_run_etl = (args.sample or args.full) and not args.skip_etl
    if should_run_etl:
        run_etl_subprocess(
            input_dir=args.input_dir,
            mappings_dir=args.mappings_dir,
            data_dir=args.data_dir,
            sample=args.sample,
        )
    elif not (args.data_dir / "manifest.json").is_file():
        print(
            f"[local.py] No manifest.json found in {args.data_dir}. Run with --sample or --full first.",
            file=sys.stderr,
        )
        sys.exit(1)

    if args.check:
        ok = verify_local_data_server(args.data_dir, throttle_mbps=args.throttle_mbps)
        sys.exit(0 if ok else 1)

    if args.publish:
        try:
            publish_data_to_orphan_branch(
                args.data_dir,
                repo_url=publish_repo,
                branch=args.publish_branch,
            )
            sys.exit(0)
        except Exception as exc:
            print(f"[local.py] Publish failed: {exc}", file=sys.stderr)
            sys.exit(1)

    server = create_data_server(
        data_dir=args.data_dir,
        host="127.0.0.1",
        port=args.port_data,
        throttle_mbps=args.throttle_mbps,
        quiet=False,
    )
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    throttle_msg = f" (throttled to {args.throttle_mbps} Mbps)" if args.throttle_mbps else ""
    print(f"[local.py] Data server (HTTP 206 + CORS) listening at http://localhost:{args.port_data}{throttle_msg}")

    vite_proc: subprocess.Popen[bytes] | None = None
    pkg_json = ROOT_DIR / "package.json"
    if not args.data_only and pkg_json.is_file():
        npm_exe = _resolve_npm()
        if npm_exe:
            env = os.environ.copy()
            env["VITE_DATA_BASE_URL"] = f"http://localhost:{args.port_data}"
            print(f"[local.py] Starting Vite dev server at http://localhost:{args.port_app}...")
            vite_proc = subprocess.Popen(
                [npm_exe, "run", "dev", "--", "--port", str(args.port_app)],
                cwd=str(ROOT_DIR),
                env=env,
            )
        else:
            print("[local.py] npm not found on PATH; running in data-only mode.")
    elif not args.data_only:
        print("[local.py] No package.json present yet (Phase 1); running data server only. Press Ctrl+C to stop.")

    try:
        while True:
            if vite_proc is not None and vite_proc.poll() is not None:
                break
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n[local.py] Shutting down...")
    finally:
        if vite_proc is not None and vite_proc.poll() is None:
            vite_proc.terminate()
            try:
                vite_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                vite_proc.kill()
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
