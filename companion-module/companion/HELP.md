# C2C Console

Controls the Camera2Cloud SRT recording console (OvenMediaEngine behind an SRT relay).

## Setup

- **Console IP / port**: the console host and port (default `3020`).
- **API key**: the console's `API_KEY` (`C2C_API_KEY` in its `.env`).

Inputs (cameras) are discovered from the console automatically. Add or remove them in the console web UI; the module updates its dropdowns, variables and presets within a second.

## Files

Each recording is saved as `<shoot>/<input>/<clip>_T<take>_<date_time>.ts`. The take number auto-increments for every Start on the same shoot, input and clip.

## Actions

- **Start / Stop / Toggle recording**: per input, or _All inputs_ (Start all only starts inputs that have signal). Start and Toggle take an optional clip name, and variables are allowed.
- **Set shoot (project folder)**: e.g. `$(internal:date_y)-$(internal:date_m)-$(internal:date_d)_Promo`. This is refused while anything is recording.
- **Set clip name**: per input or all inputs. Variables are allowed.
- **Set next take number** / **Reset take to T001**.

## Feedbacks

- **Recording (tally)**: per input or any input.
- **Signal state**: live, stalled, no signal or unknown.
- **Console connected**.

## Variables (per input, e.g. `cam1_…`)

`clip`, `next_take`, `next_file`, `recording`, `rec_time`, `rec_take`, `rec_file`, `button_line`, `signal`, `relay`, `resolution`, `fps`, `bitrate_mbps`, `label`, `port`.

Global: `shoot`, `connected`, `inputs`, `recording_count`, `any_recording`, `last_error`.

## Example: daily auto-naming

1. Button **SHOOT = TODAY**: _Set shoot_ to `$(internal:date_y)-$(internal:date_m)-$(internal:date_d)_$(internal:custom_project)`.
2. Per segment button: _Set clip name_ (All inputs) to `$(internal:custom_segment)`.
3. **REC ALL** / **STOP ALL**. Takes count up by themselves: T001, T002, …
