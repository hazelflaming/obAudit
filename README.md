# obAudit
A [uPlot](https://github.com/leeoniya/uPlot)-based charting widget for orderbook depth exploration.

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

(to add)