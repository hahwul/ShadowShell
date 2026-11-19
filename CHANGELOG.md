# Changelog

## Unreleased

### Added

- Default directory for new terminals, in Settings and per preset (a preset's directory wins over the global one, which wins over the home directory).

### Changed

- Terminals run the user's shell: `$SHELL` if it is an absolute path to an executable, else the account's login shell, else the first of zsh, bash and sh. Placeholder shells (`nologin`, `false`, …) and csh/tcsh (which reject the `-i -l` flags used) are skipped.
- Output is sent to the frontend at most once per event-loop tick per terminal instead of once per socket chunk (`seq 1 200000` produced ~13,000 events/s; bulk output now takes 5–20 times fewer events).

### Security

- The relay listened on a predictable TCP port and gave a shell to the first local client that connected. It now binds an OS-assigned port and requires a one-time token, passed to the backend over the relay's stdout pipe.
- `relay.py` was written to a shared temp directory where another local user could replace it. It is now written atomically, mode 0600, to `~/.config/shadowshell`; the temp fallback uses a fresh, uniquely named 0700 directory that is never reused.

### Fixed

- A terminal whose relay could not start (Python 3 missing, or the macOS `python3` stub without the Command Line Tools) only showed `[Process exited with code -1]`. It now shows the error and points to Settings → Python 3 Path, in tabs and in the quick terminal.
- Trailing output was lost when the backend was busy as the shell exited: the relay gave up flushing after 1 s without progress. It now keeps flushing while the backend reads, and gives up after 10 s without progress.
- Settings saved the default directory before checking the Python path, leaving a half-saved state when the path was rejected, and saved the prefilled auto-detected Python path as an explicit setting. Both fields are now checked before either is saved, and an unchanged Python path is left alone.
- The preset editor failed to open (so a broken preset could not even be reset) when a preset stored in localStorage had a non-text field.
- Exit codes: the pane showed the relay's own status, so `exit 3` was reported as 0. The shell's code is shown, and 128+n for a signal.
- The relay dropped the client, and so hung up the shell, when output outpaced the client. It now stops reading the PTY until the client catches up.
- Keystrokes and resizes could arrive out of order; they are now sent one call at a time per terminal. Input and resizes sent before the relay connected were dropped.
- Shells kept running after the page was reloaded (closing the browser tab is best effort).
- An exit reported before the terminal's id was known was dropped, leaving a blank dead terminal.
- Multi-byte UTF-8 characters split across socket reads turned into U+FFFD.
- A child that ignored SIGHUP/SIGTERM made the relay hang on close; `seq 1 1e9 | head` did not stop (SIGPIPE was ignored); a bad working directory or shell is now reported in the terminal, with a fallback to `$HOME` for the directory.
- Closing tabs or panes quickly could close the wrong tab; a split whose target pane closed meanwhile leaked a hidden shell; split ratios were ignored; font size changes only applied to the active tab; switching back to a tab activated its first pane instead of the one last used.
- Quick terminal: it did not restart after `exit`, dropped keystrokes typed while starting, and kept keyboard focus when hidden.
- Preset editor and settings: double clicks saved twice or stacked modals, Cancel during validation still saved, and malformed presets in localStorage crashed the preset bar.
- The backend used APIs missing from Caido's runtime (`unlinkSync`, global `process`) when writing files.

## 0.1.0

Initial release.
