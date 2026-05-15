# obAudit
A [uPlot](https://github.com/leeoniya/uPlot)-based charting widget for orderbook depth exploration.

<img width="2882" height="1520" alt="localhost_5173_" src="https://github.com/user-attachments/assets/e6fdddad-2937-4b36-a60c-84dad4d73d8a" />

Data shown: Binance USDS-M Futures BTCUSDT normalized `incremental_book_L2`, first hour of 2025-05-01 UTC, sourced from [Tardis](https://datasets.tardis.dev/v1/binance-futures/incremental_book_L2/2025/05/01/BTCUSDT.csv.gz).


## Usage 

This repo is currently configured to be deployed from an Amazon SageMaker codespace, deploying it elsewhere will require configuration changes.

Basic Setup:
1. Ensure `Cargo`, `Rust`, and `npm` are installed and can download dependencies
2. Place `orderdepth_market.arrow` and optionally `orderdepth_participant.arrow` in `ob_serve/data`, these should be formatted as described in __Data Format__ below
3. Run `cargo build --release` in the `ob_serve` directory
4. Copy the URL SageMaker provides under the `ports` tab in the terminal into the `dataURl` field in `ob_vis/src/config.ts` on line 203
5. Run `npm ci` to install required packages. This may require adding `AWS_CA_BUNDLE` to the npm list of trusted certificates
6. Run `npm run build && npm run preview` in the `ob_vis` directory
7. Open the URL provided by SageMaker under the `ports` tab in the terminal into the `dataURl` (not the same as __4__)

## Data Format

Each file must use the Arrow IPC file format (Feather/Arrow file), not Parquet or Arrow stream format.

### Required schema
Each file must contain these columns exactly:
| Column     | Arrow type | Meaning |
|------------|------------|---------|
| `time`     | `float64`  | Event timestamp |
| `price`    | `float64`  | Price level |
| `quantity` | `float64`  | Quantity at that price level |

Extra columns are ignored.

### Row semantics

Each row is an order-book level update:

- `time` is when the level state applies, this should be a float representing seconds offset from the `originNs` field in `config.ts`, these should be in non-decreasing time order
- `price` is the price level being updated
- `quantity > 0` means bid-side depth
- `quantity < 0` means ask-side depth
- `quantity == 0` clears that price level

The server treats each row as the full quantity at that price level after the
update, not as a delta to add.

## Features

<p align="center">
  <img width="49%" alt="localhost_5173_ (5)" src="https://github.com/user-attachments/assets/1892a143-1fc7-4eb9-8d69-eb2905a732c2" />
  <img width="49%" alt="localhost_5173_ (6)" src="https://github.com/user-attachments/assets/76050f94-af2f-4457-bf3a-9931b52efd63" />
</p> Intuitive axis-independent zoom selection, panning, hovering, etc.

&nbsp;

<img width="2882" height="1520" alt="localhost_5173_ (7)" src="https://github.com/user-attachments/assets/836bbffc-01ff-462b-99f1-94b11208c138" />
Click-based slice selection (right panel), forward-backward playback with ← →.

&nbsp;

<img width="2307" height="1520" alt="localhost_5173_ (8)" src="https://github.com/user-attachments/assets/407240ab-afa6-44de-8915-d98af28faf24" />
Support/Resistance quantity indicators.

&nbsp;

<img width="2882" height="1520" alt="localhost_5173_ (9)" src="https://github.com/user-attachments/assets/a8c3bdb3-a3fc-401c-8d2a-2f7058d3f087" />
Participant auditing (via second marketbook upload). (This event depicts several participant ask order fills, and subsequent placing of ask orders at the mid, preventing the price from freely climbing above ~94257.)
