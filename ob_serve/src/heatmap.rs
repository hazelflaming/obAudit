use arrow::array::Float64Array;
use arrow::ipc::reader::FileReader;
use axum::{extract::Query, Json};
use std::collections::HashMap;
use std::env;
use std::fs::File;
use std::hash::Hash;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tokio::task;

use crate::types::{HeatmapParams, HeatmapResponse};

pub struct ProcessedFile {
    pub heatmap_bins: Vec<Vec<f64>>,
    pub aggregate_by_time: Vec<HashMap<usize, f64>>,
}

#[derive(Clone, Copy)]
struct BinnerSpec {
    t_min_snapped: f64,
    heatmap_p_min_snapped: f64,
    agg_p_min_snapped: f64,
    min_price_step: f64,
    min_time_step: f64,
    ticks_per_bin: usize,
    ticks_per_t_bin: usize,
    heatmap_p_bins: usize,
    agg_p_bins: usize,
    actual_t_bins: usize,
}

struct CompactAggregate {
    levels_per_side: usize,
    bid_prices: Vec<f64>,
    bid_qtys: Vec<f64>,
    bid_participant_qtys: Vec<f64>,
    ask_prices: Vec<f64>,
    ask_qtys: Vec<f64>,
    ask_participant_qtys: Vec<f64>,
}

struct LoadedFile {
    times: Box<[f64]>,
    prices: Box<[f64]>,
    quantities: Box<[f64]>,
}

enum CachedLoadedFile {
    Loaded(LoadedFile),
    Failed(String),
}

static FILE_A: OnceLock<CachedLoadedFile> = OnceLock::new();
static FILE_B: OnceLock<CachedLoadedFile> = OnceLock::new();
const DEFAULT_QUANTITY_OPACITY_PERCENTILE: f64 = 0.95;

fn sparse_key(price_tick_idx: usize, t_idx: usize, actual_t_bins: usize) -> u64 {
    (price_tick_idx as u64) * actual_t_bins as u64 + t_idx as u64
}

fn split_sparse_key(key: u64, actual_t_bins: usize) -> (usize, usize) {
    let key = key as usize;
    (key / actual_t_bins, key % actual_t_bins)
}

fn update_max_qty<K>(store: &mut HashMap<K, f64>, key: K, qty: f64)
where
    K: Eq + Hash,
{
    store
        .entry(key)
        .and_modify(|v| {
            if qty.abs() > v.abs() {
                *v = qty;
            }
        })
        .or_insert(qty);
}

fn quantize_price_tick(price: f64, min_price_step: f64) -> i64 {
    (price / min_price_step).round() as i64
}

fn quantize_time_tick_offset(t: f64, t_min_snapped: f64, min_time_step: f64) -> i64 {
    ((t - t_min_snapped) / min_time_step).round() as i64
}

fn update_active_level(active: &mut [f64], min_tick: i64, abs_tick: i64, qty: f64) -> Option<usize> {
    let rel_tick = abs_tick - min_tick;
    if rel_tick < 0 {
        return None;
    }

    let tick_idx = rel_tick as usize;
    if tick_idx >= active.len() {
        return None;
    }

    active[tick_idx] = qty;
    Some(tick_idx)
}

fn materialize_heatmap_bin(
    tick_bins: &mut HashMap<u64, f64>,
    active: &[f64],
    t_idx: usize,
    actual_t_bins: usize,
) {
    for (tick_idx, &qty) in active.iter().enumerate() {
        if qty != 0.0 {
            update_max_qty(tick_bins, sparse_key(tick_idx, t_idx, actual_t_bins), qty);
        }
    }
}

fn materialize_aggregate_bin(levels: &mut HashMap<usize, f64>, active: &[f64]) {
    for (tick_idx, &qty) in active.iter().enumerate() {
        if qty != 0.0 {
            update_max_qty(levels, tick_idx, qty);
        }
    }
}

fn collapse_sparse_tick_bins(
    tick_bins: &HashMap<u64, f64>,
    ticks_per_bin: usize,
    actual_p_bins: usize,
    actual_t_bins: usize,
) -> Vec<Vec<f64>> {
    let mut net_bins = vec![vec![0.0_f64; actual_t_bins]; actual_p_bins];

    for (&key, &qty) in tick_bins.iter() {
        let (tick_idx, t_idx) = split_sparse_key(key, actual_t_bins);
        let p_idx = tick_idx / ticks_per_bin;
        if p_idx < actual_p_bins {
            net_bins[p_idx][t_idx] += qty;
        }
    }

    net_bins
}

fn quantity_opacity_scale(
    bins_a: &[Vec<f64>],
    bins_b: Option<&[Vec<f64>]>,
    percentile: f64,
) -> f64 {
    let percentile = percentile.clamp(0.0, 1.0);
    let mut quantities = Vec::new();

    for row in bins_a.iter().chain(bins_b.into_iter().flatten()) {
        quantities.extend(row.iter().copied().map(f64::abs).filter(|qty| *qty > 0.0));
    }

    if quantities.is_empty() {
        return 0.0;
    }

    quantities.sort_unstable_by(f64::total_cmp);
    let idx = ((quantities.len() - 1) as f64 * percentile).floor() as usize;
    quantities[idx]
}

fn debug_arrow_read_failure(label: &str, path: &Path, reason: &str) {
    eprintln!(
        "[debug] failed to read {label} from {}: {reason}",
        path.display()
    );
}

fn resolve_arrow_path(path: &str) -> PathBuf {
    let relative_path = Path::new(path);
    if relative_path.is_absolute() || relative_path.exists() {
        return relative_path.to_path_buf();
    }

    Path::new(env!("CARGO_MANIFEST_DIR")).join(relative_path)
}

fn get_float64_column<'a>(
    label: &str,
    batch: &'a arrow::record_batch::RecordBatch,
    schema: &arrow::datatypes::Schema,
    column_idx: usize,
    column_name: &str,
    path: &Path,
    batch_idx: usize,
) -> Result<&'a Float64Array, String> {
    let column = batch.column(column_idx);
    column
        .as_any()
        .downcast_ref::<Float64Array>()
        .ok_or_else(|| {
            let field = schema.field(column_idx);
            format!(
                "batch {batch_idx} column '{column_name}' is not a Float64 array (schema={:?}, nullable={}, runtime={:?})",
                field.data_type(),
                field.is_nullable(),
                column.data_type(),
            )
        })
        .map_err(|err| {
            debug_arrow_read_failure(label, path, &err);
            err
        })
}

fn insert_best_bid(levels: &mut Vec<(usize, f64)>, tick_idx: usize, qty: f64, limit: usize) {
    if qty <= 0.0 || limit == 0 {
        return;
    }

    let pos = levels
        .iter()
        .position(|&(existing_tick, _)| tick_idx > existing_tick)
        .unwrap_or(levels.len());

    if pos < limit {
        levels.insert(pos, (tick_idx, qty));
        if levels.len() > limit {
            levels.pop();
        }
    } else if levels.len() < limit {
        levels.push((tick_idx, qty));
    }
}

fn insert_best_ask(levels: &mut Vec<(usize, f64)>, tick_idx: usize, qty: f64, limit: usize) {
    if qty >= 0.0 || limit == 0 {
        return;
    }

    let pos = levels
        .iter()
        .position(|&(existing_tick, _)| tick_idx < existing_tick)
        .unwrap_or(levels.len());

    if pos < limit {
        levels.insert(pos, (tick_idx, qty));
        if levels.len() > limit {
            levels.pop();
        }
    } else if levels.len() < limit {
        levels.push((tick_idx, qty));
    }
}

fn compact_aggregate_levels(
    primary: &[HashMap<usize, f64>],
    participant: Option<&[HashMap<usize, f64>]>,
    agg_p_min_snapped: f64,
    min_price_step: f64,
    levels_per_side: usize,
) -> CompactAggregate {
    let time_bin_count = primary.len();
    let flat_len = time_bin_count * levels_per_side;
    let mut bid_prices = vec![0.0_f64; flat_len];
    let mut bid_qtys = vec![0.0_f64; flat_len];
    let mut bid_participant_qtys = vec![0.0_f64; flat_len];
    let mut ask_prices = vec![0.0_f64; flat_len];
    let mut ask_qtys = vec![0.0_f64; flat_len];
    let mut ask_participant_qtys = vec![0.0_f64; flat_len];

    for (t_idx, levels) in primary.iter().enumerate() {
        let mut best_bids = Vec::with_capacity(levels_per_side);
        let mut best_asks = Vec::with_capacity(levels_per_side);

        for (&tick_idx, &qty) in levels.iter() {
            insert_best_bid(&mut best_bids, tick_idx, qty, levels_per_side);
            insert_best_ask(&mut best_asks, tick_idx, qty, levels_per_side);
        }

        for (level_idx, &(tick_idx, qty)) in best_bids.iter().enumerate() {
            let flat_idx = t_idx * levels_per_side + level_idx;
            bid_prices[flat_idx] = agg_p_min_snapped + tick_idx as f64 * min_price_step;
            bid_qtys[flat_idx] = qty;
            bid_participant_qtys[flat_idx] = participant
                .and_then(|rows| rows.get(t_idx))
                .and_then(|row| row.get(&tick_idx))
                .copied()
                .filter(|participant_qty| *participant_qty > 0.0)
                .unwrap_or(0.0);
        }

        for (level_idx, &(tick_idx, qty)) in best_asks.iter().enumerate() {
            let flat_idx = t_idx * levels_per_side + level_idx;
            ask_prices[flat_idx] = agg_p_min_snapped + tick_idx as f64 * min_price_step;
            ask_qtys[flat_idx] = -qty;
            ask_participant_qtys[flat_idx] = participant
                .and_then(|rows| rows.get(t_idx))
                .and_then(|row| row.get(&tick_idx))
                .copied()
                .filter(|participant_qty| *participant_qty < 0.0)
                .map(|participant_qty| -participant_qty)
                .unwrap_or(0.0);
        }
    }

    CompactAggregate {
        levels_per_side,
        bid_prices,
        bid_qtys,
        bid_participant_qtys,
        ask_prices,
        ask_qtys,
        ask_participant_qtys,
    }
}

fn load_arrow_file(label: &str, path: &str) -> Result<LoadedFile, String> {
    let resolved_path = resolve_arrow_path(path);
    let cwd = env::current_dir()
        .map(|dir| dir.display().to_string())
        .unwrap_or_else(|err| format!("<unknown current dir: {err}>"));
    let file = File::open(&resolved_path).map_err(|err| {
        let reason = format!(
            "{err} (requested path='{path}', resolved path='{}', cwd='{cwd}')",
            resolved_path.display(),
        );
        debug_arrow_read_failure(label, &resolved_path, &reason);
        reason
    })?;
    let reader = FileReader::try_new(file, None).map_err(|err| {
        let reason = format!("failed to open Arrow IPC reader: {err}");
        debug_arrow_read_failure(label, &resolved_path, &reason);
        reason
    })?;
    let schema = reader.schema();

    let col_t = schema.index_of("time").map_err(|err| {
        let reason = format!("missing required 'time' column in schema {schema:?}: {err}");
        debug_arrow_read_failure(label, &resolved_path, &reason);
        reason
    })?;
    let col_p = schema.index_of("price").map_err(|err| {
        let reason = format!("missing required 'price' column in schema {schema:?}: {err}");
        debug_arrow_read_failure(label, &resolved_path, &reason);
        reason
    })?;
    let col_q = schema.index_of("quantity").map_err(|err| {
        let reason = format!("missing required 'quantity' column in schema {schema:?}: {err}");
        debug_arrow_read_failure(label, &resolved_path, &reason);
        reason
    })?;

    let mut times = Vec::new();
    let mut prices = Vec::new();
    let mut quantities = Vec::new();

    for (batch_idx, batch) in reader.enumerate() {
        let batch = batch.map_err(|err| {
            let reason = format!("failed to read Arrow batch {batch_idx}: {err}");
            debug_arrow_read_failure(label, &resolved_path, &reason);
            reason
        })?;
        let batch_times = get_float64_column(
            label,
            &batch,
            schema.as_ref(),
            col_t,
            "time",
            &resolved_path,
            batch_idx,
        )?;
        let batch_prices = get_float64_column(
            label,
            &batch,
            schema.as_ref(),
            col_p,
            "price",
            &resolved_path,
            batch_idx,
        )?;
        let batch_quantities = get_float64_column(
            label,
            &batch,
            schema.as_ref(),
            col_q,
            "quantity",
            &resolved_path,
            batch_idx,
        )?;

        times.extend_from_slice(batch_times.values());
        prices.extend_from_slice(batch_prices.values());
        quantities.extend_from_slice(batch_quantities.values());
    }

    Ok(LoadedFile {
        times: times.into_boxed_slice(),
        prices: prices.into_boxed_slice(),
        quantities: quantities.into_boxed_slice(),
    })
}

fn cached_arrow_file(
    label: &'static str,
    path: &'static str,
    cache: &'static OnceLock<CachedLoadedFile>,
) -> Result<&'static LoadedFile, &'static str> {
    match cache.get_or_init(|| match load_arrow_file(label, path) {
        Ok(file) => CachedLoadedFile::Loaded(file),
        Err(err) => CachedLoadedFile::Failed(err),
    }) {
        CachedLoadedFile::Loaded(file) => Ok(file),
        CachedLoadedFile::Failed(err) => Err(err.as_str()),
    }
}

fn bin_arrow_file(file: &LoadedFile, spec: BinnerSpec, track_aggregate: bool) -> ProcessedFile {
    let times = file.times.as_ref();
    let prices = file.prices.as_ref();
    let quantities = file.quantities.as_ref();

    let heatmap_n_price_ticks_total = spec.heatmap_p_bins * spec.ticks_per_bin;
    let mut heatmap_tick_bins = HashMap::<u64, f64>::new();
    let mut aggregate_by_time = if track_aggregate {
        vec![HashMap::new(); spec.actual_t_bins]
    } else {
        Vec::new()
    };
    let heatmap_min_tick = quantize_price_tick(spec.heatmap_p_min_snapped, spec.min_price_step);
    let agg_min_tick = quantize_price_tick(spec.agg_p_min_snapped, spec.min_price_step);
    let ticks_per_t_bin = spec.ticks_per_t_bin as i64;
    let total_time_ticks = (spec.actual_t_bins * spec.ticks_per_t_bin) as i64;
    let mut active_heatmap = vec![0.0_f64; heatmap_n_price_ticks_total];
    let mut active_aggregate = if track_aggregate {
        vec![0.0_f64; spec.agg_p_bins]
    } else {
        Vec::new()
    };
    let mut row_idx = 0usize;

    while row_idx < times.len() {
        let rel_t_tick =
            quantize_time_tick_offset(times[row_idx], spec.t_min_snapped, spec.min_time_step);
        if rel_t_tick >= 0 {
            break;
        }

        let abs_tick = quantize_price_tick(prices[row_idx], spec.min_price_step);
        let qty = quantities[row_idx];
        update_active_level(&mut active_heatmap, heatmap_min_tick, abs_tick, qty);
        if track_aggregate {
            update_active_level(&mut active_aggregate, agg_min_tick, abs_tick, qty);
        }

        row_idx += 1;
    }

    for t_idx in 0..spec.actual_t_bins {
        let bin_start_tick = t_idx as i64 * ticks_per_t_bin;
        let bin_end_tick = bin_start_tick + ticks_per_t_bin;

        while row_idx < times.len() {
            let rel_t_tick =
                quantize_time_tick_offset(times[row_idx], spec.t_min_snapped, spec.min_time_step);
            if rel_t_tick != bin_start_tick {
                break;
            }

            let abs_tick = quantize_price_tick(prices[row_idx], spec.min_price_step);
            let qty = quantities[row_idx];
            update_active_level(&mut active_heatmap, heatmap_min_tick, abs_tick, qty);
            if track_aggregate {
                update_active_level(&mut active_aggregate, agg_min_tick, abs_tick, qty);
            }

            row_idx += 1;
        }

        materialize_heatmap_bin(
            &mut heatmap_tick_bins,
            &active_heatmap,
            t_idx,
            spec.actual_t_bins,
        );
        if track_aggregate {
            materialize_aggregate_bin(&mut aggregate_by_time[t_idx], &active_aggregate);
        }

        while row_idx < times.len() {
            let rel_t_tick =
                quantize_time_tick_offset(times[row_idx], spec.t_min_snapped, spec.min_time_step);
            if rel_t_tick >= bin_end_tick || rel_t_tick >= total_time_ticks {
                break;
            }

            let abs_tick = quantize_price_tick(prices[row_idx], spec.min_price_step);
            let qty = quantities[row_idx];

            if let Some(tick_idx) =
                update_active_level(&mut active_heatmap, heatmap_min_tick, abs_tick, qty)
            {
                if qty != 0.0 {
                    update_max_qty(
                        &mut heatmap_tick_bins,
                        sparse_key(tick_idx, t_idx, spec.actual_t_bins),
                        qty,
                    );
                }
            }

            if track_aggregate {
                if let Some(tick_idx) =
                    update_active_level(&mut active_aggregate, agg_min_tick, abs_tick, qty)
                {
                    if qty != 0.0 {
                        update_max_qty(&mut aggregate_by_time[t_idx], tick_idx, qty);
                    }
                }
            }

            row_idx += 1;
        }
    }

    ProcessedFile {
        heatmap_bins: collapse_sparse_tick_bins(
            &heatmap_tick_bins,
            spec.ticks_per_bin,
            spec.heatmap_p_bins,
            spec.actual_t_bins,
        ),
        aggregate_by_time,
    }
}

async fn run_heatmap(p: HeatmapParams) -> Json<HeatmapResponse> {
    let HeatmapParams {
        t_min,
        t_max,
        n_bins,
        p_min,
        p_max,
        p_bins,
        agg_p_min,
        agg_p_max,
        visible_price_bins,
        min_price_step,
        min_time_step,
        quantity_opacity_percentile,
    } = p;

    let n_price_ticks = ((p_max - p_min) / min_price_step).ceil() as usize;
    let mut ticks_per_bin = 1usize;
    while n_price_ticks.div_ceil(ticks_per_bin) > p_bins {
        ticks_per_bin *= 2;
    }
    let p_step = ticks_per_bin as f64 * min_price_step;
    let p_min_snapped = (p_min / p_step).floor() * p_step;
    let p_max_snapped = (p_max / p_step).ceil() * p_step;
    let actual_p_bins = (((p_max_snapped - p_min_snapped) / p_step).round() as usize).max(1);

    let n_time_ticks = ((t_max - t_min) / min_time_step).ceil() as usize;
    let mut ticks_per_t_bin = 1usize;
    while n_time_ticks.div_ceil(ticks_per_t_bin) > n_bins {
        ticks_per_t_bin *= 2;
    }
    let t_step = ticks_per_t_bin as f64 * min_time_step;
    let t_min_snapped = (t_min / t_step).floor() * t_step;
    let t_max_snapped = (t_max / t_step).ceil() * t_step;
    let actual_t_bins = (((t_max_snapped - t_min_snapped) / t_step).round() as usize).max(1);

    let agg_p_min = agg_p_min.unwrap_or(p_min);
    let agg_p_max = agg_p_max.unwrap_or(p_max);
    let agg_p_min_snapped = (agg_p_min / min_price_step).floor() * min_price_step;
    let agg_p_max_snapped = (agg_p_max / min_price_step).ceil() * min_price_step;
    let agg_p_bins =
        (((agg_p_max_snapped - agg_p_min_snapped) / min_price_step).round() as usize).max(1);
    let levels_per_side = visible_price_bins.unwrap_or(0);
    let track_aggregate = levels_per_side > 0;

    let spec = BinnerSpec {
        t_min_snapped,
        heatmap_p_min_snapped: p_min_snapped,
        agg_p_min_snapped,
        min_price_step,
        min_time_step,
        ticks_per_bin,
        ticks_per_t_bin,
        heatmap_p_bins: actual_p_bins,
        agg_p_bins,
        actual_t_bins,
    };

    let bins_a_handle = task::spawn_blocking(move || {
        cached_arrow_file("orderdepth_market.arrow", "data/orderdepth_market.arrow", &FILE_A)
            .map(|file| bin_arrow_file(file, spec, track_aggregate))
    });
    let bins_b_handle = task::spawn_blocking(move || {
        cached_arrow_file("orderdepth_participant.arrow", "data/orderdepth_participant.arrow", &FILE_B)
            .map(|file| bin_arrow_file(file, spec, track_aggregate))
    });

    let bins_a = bins_a_handle
        .await
        .expect("orderdepth_market task panicked")
        .unwrap_or_else(|err| panic!("{err}"));
    let bins_b = bins_b_handle
        .await
        .expect("orderdepth_participant task panicked")
        .ok();

    let price_labels: Vec<f64> = (0..actual_p_bins)
        .map(|i| p_min_snapped + i as f64 * p_step)
        .collect();

    let max_quantity = quantity_opacity_scale(
        &bins_a.heatmap_bins,
        bins_b.as_ref().map(|bins| bins.heatmap_bins.as_slice()),
        quantity_opacity_percentile.unwrap_or(DEFAULT_QUANTITY_OPACITY_PERCENTILE),
    );

    let compact_aggregate = compact_aggregate_levels(
        &bins_a.aggregate_by_time,
        bins_b.as_ref().map(|bins| bins.aggregate_by_time.as_slice()),
        agg_p_min_snapped,
        min_price_step,
        levels_per_side,
    );

    let mbins_b = bins_b.map(|bins| bins.heatmap_bins);

    Json(HeatmapResponse {
        prices: price_labels,
        mbins_a: bins_a.heatmap_bins,
        mbins_b,
        agg_levels_per_side: compact_aggregate.levels_per_side,
        agg_bid_prices: compact_aggregate.bid_prices,
        agg_bid_qtys: compact_aggregate.bid_qtys,
        agg_bid_participant_qtys: compact_aggregate.bid_participant_qtys,
        agg_ask_prices: compact_aggregate.ask_prices,
        agg_ask_qtys: compact_aggregate.ask_qtys,
        agg_ask_participant_qtys: compact_aggregate.ask_participant_qtys,
        max_quantity,
        t_min: t_min_snapped,
        t_max: t_max_snapped,
        p_min: p_min_snapped - p_step / 2.0,
        p_max: p_max_snapped - p_step / 2.0,
        actual_p_bins,
        actual_t_bins,
    })
}

pub async fn heatmap_get(Query(p): Query<HeatmapParams>) -> Json<HeatmapResponse> {
    run_heatmap(p).await
}

pub async fn heatmap_post(Json(p): Json<HeatmapParams>) -> Json<HeatmapResponse> {
    run_heatmap(p).await
}
