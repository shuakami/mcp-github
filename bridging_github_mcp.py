import sys
import os
import subprocess
import signal

CREATE_NO_WINDOW = 0x08000000

proc = None

def handle_termination(signum, frame):
    if proc and proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=1)
        except:
            try:
                proc.kill()
            except:
                pass
    sys.exit(0)

def main():
    global proc

    signal.signal(signal.SIGINT, handle_termination)
    signal.signal(signal.SIGTERM, handle_termination)

    # 获取当前脚本所在目录
    current_dir = os.path.dirname(os.path.abspath(__file__))
    
    try:
        proc = subprocess.Popen(
            f"node {os.path.join(current_dir, 'dist/index.js')}",
            stdin=sys.stdin,
            stdout=sys.stdout,
            stderr=sys.stderr,
            shell=True,
            env=os.environ,
            creationflags=CREATE_NO_WINDOW
        )

        proc.wait()

    except Exception as e:
        sys.stderr.write(f"Error: {str(e)}\n")
    finally:
        if proc and proc.poll() is None:
            handle_termination(None, None)

    sys.exit(proc.returncode if proc else 1)

if __name__ == "__main__":
    main()
