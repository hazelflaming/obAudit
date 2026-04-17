use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
pub struct HeatmapParams {
    pub t_min:          f64,
    pub t_max:          f64,
    pub n_bins:         usize,
    pub p_min:          f64,
    pub p_max:          f64,
    pub p_bins:         usize,
    pub agg_p_min:      Option<f64>,
    pub agg_p_max:      Option<f64>,
    pub visible_price_bins: Option<usize>,
    pub min_price_step: f64,
    pub min_time_step:  f64,
    pub quantity_opacity_percentile: Option<f64>,
}

#[derive(Serialize)]
pub struct HeatmapResponse {
    pub prices:        Vec<f64>,
    // orderdepth a bins by price then time
    pub mbins_a:       Vec<Vec<f64>>,
    // orderdepth b bins by price then time
    pub mbins_b:       Option<Vec<Vec<f64>>>,
    pub agg_levels_per_side: usize,
    pub agg_bid_prices: Vec<f64>,
    pub agg_bid_qtys: Vec<f64>,
    pub agg_bid_participant_qtys: Vec<f64>,
    pub agg_ask_prices: Vec<f64>,
    pub agg_ask_qtys: Vec<f64>,
    pub agg_ask_participant_qtys: Vec<f64>,
    pub max_quantity:  f64,
    pub t_min:         f64,
    pub t_max:         f64,
    pub p_min:         f64,
    pub p_max:         f64,
    pub actual_p_bins: usize,
    pub actual_t_bins: usize,
}
