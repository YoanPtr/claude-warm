#!/usr/bin/env python3
"""Drive one INTERACTIVE Claude Code session (the REPL, not -p) in a pseudo-terminal.

Usage: interactive.py <cwd> <cmd...>
Accepts the folder-trust prompt, sends one message, exits, then prints the first
assistant turn's cache usage from the session transcript as JSON.
"""
import glob, json, os, pty, re, select, sys, time

cwd, cmd = sys.argv[1], sys.argv[2:]
project = os.path.expanduser('~/.claude/projects/' + re.sub(r'[^a-zA-Z0-9]', '-', cwd))
before = set(glob.glob(f'{project}/*.jsonl'))

pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.environ['TERM'] = 'xterm-256color'
    # Run as a top-level terminal session even when the tests themselves run inside Claude Code.
    for k in list(os.environ):
        if k.startswith('CLAUDE_CODE_') or k in ('CLAUDECODE', 'AI_AGENT', 'CLAUDE_PID', 'CLAUDE_EFFORT'):
            del os.environ[k]
    os.execvp(cmd[0], cmd)

screen = b''

def pump(seconds):
    global screen
    end = time.time() + seconds
    while time.time() < end:
        if select.select([fd], [], [], 0.2)[0]:
            try:
                screen += os.read(fd, 65536)
            except OSError:
                return

def send(text):
    try:
        os.write(fd, text.encode())
    except OSError:
        sys.exit('session exited early: ' + screen.decode(errors='replace')[-400:])

pump(6)
if b'trust' in screen:  # default is "No, exit": move down to "Yes, I trust this folder"
    send('\x1b[B'); pump(0.5); send('\r'); pump(3)
send('reply with: ok'); pump(1); send('\r')
pump(25)
send('/exit'); pump(1); send('\r'); pump(3)
try:
    os.kill(pid, 9)
except ProcessLookupError:
    pass

new = sorted(set(glob.glob(f'{project}/*.jsonl')) - before, key=os.path.getmtime)
if not new:
    sys.exit(f'no transcript in {project}')
for line in open(new[-1]):
    d = json.loads(line)
    usage = d.get('message', {}).get('usage') if d.get('type') == 'assistant' else None
    if usage:
        print(json.dumps({'written': usage['cache_creation_input_tokens'], 'read': usage['cache_read_input_tokens']}))
        sys.exit(0)
sys.exit(f'no assistant turn in {new[-1]}')
