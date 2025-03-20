import sys
import os
import subprocess
import threading
import signal

CREATE_NO_WINDOW = 0x08000000

proc = None

def handle_termination(signum, frame):
    if proc and proc.poll() is None:
        try:
            proc.terminate()
        except Exception:
            pass
    sys.exit(0)

def main():
    global proc

    signal.signal(signal.SIGINT, handle_termination)
    signal.signal(signal.SIGTERM, handle_termination)

    proc = subprocess.Popen(
        ["node", "C:/Users/Shuakami/mcp-github/dist/index.js"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=os.environ,
        creationflags=CREATE_NO_WINDOW,
        text=True,
        bufsize=1
    )

    def read_from_node_stdout():
        try:
            for line in proc.stdout:
                if line == "":
                    break
                sys.stdout.write(line)
                sys.stdout.flush()
        except Exception:
            pass

    def read_from_node_stderr():
        try:
            for line in proc.stderr:
                if line == "":
                    break
                sys.stderr.write(line)
                sys.stderr.flush()
        except Exception:
            pass

    def forward_stdin_to_node():
        try:
            for line in sys.stdin:
                proc.stdin.write(line)
                proc.stdin.flush()
        except Exception:
            pass

    t_out = threading.Thread(target=read_from_node_stdout, daemon=True)
    t_err = threading.Thread(target=read_from_node_stderr, daemon=True)
    t_in  = threading.Thread(target=forward_stdin_to_node, daemon=True)

    t_out.start()
    t_err.start()
    t_in.start()

    return_code = None
    try:
        return_code = proc.wait()
    except KeyboardInterrupt:
        handle_termination(None, None)

    sys.exit(return_code if return_code is not None else 0)

if __name__ == "__main__":
    main()
