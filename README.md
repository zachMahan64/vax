# Nancy (emulated DEC VAX-11/780)

Emulates the CIT's VAX-11/780 ("Nancy", 1979; floor 3) using
[Open SIMH](https://github.com/open-simh/simh)'s `vax780` simulator, running
4.3BSD (Berkeley, June 1986)

>Warning: do not run multiple instances of the emulator since it may corrupt the emu's disk

## Build / Set up

The dist files and disk image are too big for git, so they should be 
downloaded and built locally:

```sh
git clone --recurse-submodules <this repo> && cd vax-emu
make -C simh vax780          # build the simulator (~1 min; runs DEC diagnostics)
./scripts/fetch-dist.sh      # download 4.3BSD from TUHS (~32 MB), build 43.tap
./scripts/install.sh         # install onto machine/nancy.dsk (~1 min), pass -f to wipe and reinstall existing disk
./run-vax.sh
```

Based on the Computer History Wiki guide
[Installing 4.3 BSD on SIMH](https://gunkies.org/wiki/Installing_4.3_BSD_on_SIMH)

## Run

```sh
./run-vax.sh
```

- Log in as `root` (no password)
- More terminals: `telnet localhost 2323` (8 emulated DZ11 serial lines, like
  the terminal room hanging off a real 780)
- Shut down: `sync; sync; halt` inside BSD, then **Ctrl-E** and `q` at `sim>`
  If you skip the halt, BSD runs `fsck` on the next boot and recovers

Cool things: `ls /usr/games` and try some out (some don't work due to input issues), `cc` (the
1986 C compiler), `vi` (although I couldn't get it to work again due to input issues), `man`

## Layout

| Thing | Purpose |
|---|---|
| `simh/` | open-simh (git submodule); `BIN/vax780` is the built simulator |
| `dist/` | 4.3BSD distribution from [TUHS](https://www.tuhs.org/Archive/Distributions/UCB/4BSD/4.3BSD/) and `43.tap` (not in git); `boot42.uue` bootstrap (in git) |
| `machine/nancy.dsk` | the installed RA81 hard disk, 456 MB (not in git) |
| `machine/common.ini` | hardware config: 8 MB RAM, RA81 on UDA50, TS11 tape |
| `machine/boot.ini` | normal boot |
| `machine/install{1,2,3}.ini` | automated install (SIMH `send`/`expect`) |
| `machine/smoketest.ini` | non-interactive boot / login / compile / halt check |
| `scripts/fetch-dist.sh` | downloads the distribution, decodes `boot42`, builds the tape |
| `scripts/install.sh` | runs the automated install |
| `scripts/mktape.py` | builds `43.tap` from the distribution files |
